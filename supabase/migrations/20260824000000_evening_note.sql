create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on functions from public, anon, authenticated;

-- Push endpoints are bearer-like URLs that the sender will contact from a trusted
-- network. Keep this allowlist deliberately narrow to prevent the subscription
-- API from becoming an SSRF primitive. Add a host only after verifying that it is
-- an HTTPS origin operated by a browser push service.
create or replace function private.push_endpoint_allowed(p_endpoint text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_endpoint ~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com)/'
$$;

-- PostgreSQL has no built-in base64url decoder. This validates canonical,
-- unpadded browser subscription keys and, for p256dh, the uncompressed point
-- marker. The Edge Function additionally asks WebCrypto to validate the point.
create or replace function private.valid_push_key(
  p_value text,
  p_expected_octets integer,
  p_first_octet integer default null
) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_decoded bytea;
begin
  if char_length(p_value) > 512
    or p_value !~ '^[A-Za-z0-9_-]+$'
    or char_length(p_value) % 4 = 1
  then
    return false;
  end if;

  v_decoded := decode(
    translate(p_value, '-_', '+/') || repeat('=', (4 - char_length(p_value) % 4) % 4),
    'base64'
  );

  return octet_length(v_decoded) = p_expected_octets
    and (p_first_octet is null or get_byte(v_decoded, 0) = p_first_octet);
exception
  when others then
    return false;
end;
$$;

revoke all on function private.push_endpoint_allowed(text) from public, anon, authenticated;
revoke all on function private.valid_push_key(text, integer, integer) from public, anon, authenticated;
grant execute on function private.push_endpoint_allowed(text) to service_role;
grant execute on function private.valid_push_key(text, integer, integer) to service_role;

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  content text not null,
  saved_timezone text not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint entries_content_length check (
    char_length(btrim(content)) between 1 and 10000
  ),
  constraint entries_user_date_key unique (user_id, entry_date)
);

create index entries_user_date_desc_idx
  on public.entries (user_id, entry_date desc);

alter table public.entries enable row level security;
alter table public.entries force row level security;
revoke all on public.entries from public, anon, authenticated;
grant select on public.entries to authenticated;

create policy "Users can read their own entries"
  on public.entries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.save_daily_entry(
  p_content text,
  p_timezone text
) returns setof public.entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_content text := btrim(p_content);
  v_entry_date date;
  v_now timestamptz := statement_timestamp();
  v_rows integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if v_content is null or char_length(v_content) = 0 then
    raise exception 'Entry cannot be empty' using errcode = '22023';
  end if;

  if char_length(v_content) > 10000 then
    raise exception 'Entry is too long' using errcode = '22001';
  end if;

  if p_timezone is null or not exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = p_timezone
  ) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;

  v_entry_date := (v_now at time zone p_timezone)::date;

  return query
  insert into public.entries (
    user_id,
    entry_date,
    content,
    saved_timezone
  ) values (
    v_user_id,
    v_entry_date,
    v_content,
    p_timezone
  )
  on conflict (user_id, entry_date)
  do update set
    content = excluded.content,
    -- The timezone captured on first save is intentionally immutable. Because a
    -- browser timezone is user-controlled, this conservative server-side rule
    -- prevents choosing a new timezone later to reopen an entry whose original
    -- local day has ended. Travel can therefore lock an entry early, never late.
    saved_timezone = public.entries.saved_timezone,
    updated_at = v_now
  where public.entries.entry_date = (v_now at time zone public.entries.saved_timezone)::date
  returning public.entries.*;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Past entries are read-only' using errcode = '22023';
  end if;
end;
$$;

comment on column public.entries.saved_timezone is
  'Immutable timezone captured on first save; used as the conservative edit-window boundary.';
comment on function public.save_daily_entry(text, text) is
  'Creates a local-day entry and permits revisions only while that day remains current in the initially saved timezone.';

revoke all on function public.save_daily_entry(text, text) from public, anon;
grant execute on function public.save_daily_entry(text, text) to authenticated;

create or replace function private.next_reminder_at(
  p_timezone text,
  p_after timestamptz
) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (
    case
      when (p_after at time zone p_timezone)::time < time '19:45'
        then (p_after at time zone p_timezone)::date
      else (p_after at time zone p_timezone)::date + 1
    end + time '19:45'
  ) at time zone p_timezone
$$;

create table private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  timezone text not null,
  enabled boolean not null default true,
  next_due_at timestamptz not null,
  failure_count integer not null default 0,
  last_seen_at timestamptz not null default statement_timestamp(),
  last_test_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint push_subscription_user_installation_key unique (user_id, installation_id),
  constraint push_subscription_endpoint_allowed check (
    char_length(endpoint) between 16 and 4096
    and private.push_endpoint_allowed(endpoint)
  ),
  constraint push_subscription_key_material check (
    private.valid_push_key(p256dh, 65, 4)
    and private.valid_push_key(auth_secret, 16, null)
  )
);

create index push_subscriptions_due_idx
  on private.push_subscriptions (next_due_at)
  where enabled and disabled_at is null;

create table private.push_test_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_test_at timestamptz not null,
  updated_at timestamptz not null default statement_timestamp()
);

create table private.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references private.push_subscriptions(id) on delete cascade,
  local_date date not null,
  timezone_at_schedule text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'sent', 'failed', 'expired', 'cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default statement_timestamp(),
  claim_token uuid,
  claim_expires_at timestamptz,
  provider_status integer,
  error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint notification_delivery_daily_key unique (subscription_id, local_date),
  constraint notification_delivery_error_code_length check (
    error_code is null or char_length(error_code) <= 120
  )
);

create index notification_deliveries_work_idx
  on private.notification_deliveries (next_attempt_at, scheduled_for)
  where status in ('pending', 'processing', 'retry');

grant select, insert, update, delete on private.push_subscriptions to service_role;
grant select, insert, update, delete on private.push_test_rate_limits to service_role;
grant select, insert, update, delete on private.notification_deliveries to service_role;

create or replace function public._internal_upsert_push_subscription(
  p_user_id uuid,
  p_installation_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth_secret text,
  p_timezone text
) returns table (id uuid, next_due_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_other_active integer;
  v_rows integer;
begin
  if p_user_id is null or not exists (select 1 from auth.users where auth.users.id = p_user_id) then
    raise exception 'Unknown user' using errcode = '22023';
  end if;

  if p_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name = p_timezone
  ) then
    raise exception 'Invalid timezone' using errcode = '22023';
  end if;

  if p_endpoint is null or not private.push_endpoint_allowed(p_endpoint) then
    raise exception 'Invalid push endpoint' using errcode = '22023';
  end if;

  if p_p256dh is null
    or p_auth_secret is null
    or not private.valid_push_key(p_p256dh, 65, 4)
    or not private.valid_push_key(p_auth_secret, 16, null)
  then
    raise exception 'Invalid push subscription keys' using errcode = '22023';
  end if;

  -- Serialize registration changes for one user so concurrent requests cannot
  -- race past the ten-active-device cap.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 1745));

  select count(*)::integer into v_other_active
  from private.push_subscriptions
  where user_id = p_user_id
    and enabled
    and disabled_at is null
    and installation_id <> p_installation_id
    and endpoint <> p_endpoint;

  if v_other_active >= 10 then
    raise exception 'Active subscription limit reached' using errcode = '22023';
  end if;

  delete from private.push_subscriptions
  where user_id = p_user_id
    and installation_id = p_installation_id
    and endpoint <> p_endpoint;

  return query
  insert into private.push_subscriptions as subscription (
    user_id,
    installation_id,
    endpoint,
    p256dh,
    auth_secret,
    timezone,
    enabled,
    next_due_at,
    last_seen_at,
    disabled_at
  ) values (
    p_user_id,
    p_installation_id,
    p_endpoint,
    p_p256dh,
    p_auth_secret,
    p_timezone,
    true,
    private.next_reminder_at(p_timezone, v_now),
    v_now,
    null
  )
  on conflict (endpoint)
  do update set
    user_id = excluded.user_id,
    installation_id = excluded.installation_id,
    p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret,
    timezone = excluded.timezone,
    enabled = true,
    disabled_at = null,
    last_seen_at = v_now,
    updated_at = v_now,
    failure_count = 0,
    next_due_at = case
      when subscription.enabled
        and subscription.disabled_at is null
        and subscription.timezone = excluded.timezone
        and subscription.next_due_at >= v_now - interval '15 minutes'
      then subscription.next_due_at
      else private.next_reminder_at(excluded.timezone, v_now)
    end
  -- Never let knowledge of an active endpoint transfer it between accounts.
  -- A disabled endpoint can move only on the same persisted installation.
  where subscription.user_id = excluded.user_id
    or (
      not subscription.enabled
      and subscription.installation_id = excluded.installation_id
    )
  returning subscription.id, subscription.next_due_at;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Subscription ownership conflict' using errcode = '22023';
  end if;
end;
$$;

create or replace function public._internal_disable_push_subscription(
  p_user_id uuid,
  p_installation_id uuid,
  p_endpoint text
) returns boolean
language sql
security definer
set search_path = ''
as $$
  with disabled as materialized (
    update private.push_subscriptions
    set
      enabled = false,
      disabled_at = statement_timestamp(),
      updated_at = statement_timestamp()
    where user_id = p_user_id
      and installation_id = p_installation_id
      and endpoint = p_endpoint
    returning id
  ), cancelled as (
    update private.notification_deliveries as delivery
    set
      status = 'cancelled',
      claim_token = null,
      claim_expires_at = null,
      error_code = 'subscription_disabled',
      updated_at = statement_timestamp()
    from disabled
    where delivery.subscription_id = disabled.id
      and delivery.status in ('pending', 'processing', 'retry')
    returning delivery.id
  )
  select exists(select 1 from disabled)
$$;

create or replace function public._internal_claim_test_subscription(
  p_user_id uuid,
  p_installation_id uuid,
  p_endpoint text
) returns table (
  id uuid,
  endpoint text,
  p256dh text,
  auth_secret text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_subscription private.push_subscriptions%rowtype;
  v_rate_claimed uuid;
begin
  select subscription.* into v_subscription
  from private.push_subscriptions as subscription
  where subscription.user_id = p_user_id
    and subscription.installation_id = p_installation_id
    and subscription.endpoint = p_endpoint
    and subscription.enabled
    and subscription.disabled_at is null
  for update;

  if not found then
    return;
  end if;

  insert into private.push_test_rate_limits as rate_limit (
    user_id,
    last_test_at,
    updated_at
  ) values (
    p_user_id,
    v_now,
    v_now
  )
  on conflict (user_id)
  do update set
    last_test_at = excluded.last_test_at,
    updated_at = excluded.updated_at
  where rate_limit.last_test_at <= v_now - interval '60 seconds'
  returning rate_limit.user_id into v_rate_claimed;

  if v_rate_claimed is null then
    return;
  end if;

  update private.push_subscriptions as subscription
  set
    last_test_at = v_now,
    updated_at = v_now
  where subscription.id = v_subscription.id;

  return query select
    v_subscription.id,
    v_subscription.endpoint,
    v_subscription.p256dh,
    v_subscription.auth_secret;
end;
$$;

create or replace function public._internal_enqueue_due_reminders(
  p_limit integer default 500
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_inserted integer := 0;
begin
  with due as materialized (
    select
      subscription.id,
      subscription.next_due_at,
      subscription.timezone
    from private.push_subscriptions as subscription
    where subscription.enabled
      and subscription.disabled_at is null
      and subscription.next_due_at <= v_now
    order by subscription.next_due_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 500), 1000))
  ), inserted as (
    insert into private.notification_deliveries (
      subscription_id,
      local_date,
      timezone_at_schedule,
      scheduled_for,
      next_attempt_at
    )
    select
      due.id,
      (due.next_due_at at time zone due.timezone)::date,
      due.timezone,
      due.next_due_at,
      v_now
    from due
    where due.next_due_at >= v_now - interval '15 minutes'
    on conflict (subscription_id, local_date) do nothing
    returning 1
  ), advanced as (
    update private.push_subscriptions as subscription
    set
      next_due_at = private.next_reminder_at(
        subscription.timezone,
        greatest(v_now, subscription.next_due_at)
      ),
      updated_at = v_now
    from due
    where subscription.id = due.id
    returning subscription.id
  )
  select count(*)::integer into v_inserted from inserted;

  return v_inserted;
end;
$$;

create or replace function public._internal_claim_deliveries(
  p_limit integer default 100,
  p_lease_seconds integer default 90
) returns table (
  delivery_id uuid,
  claim_token uuid,
  attempts integer,
  scheduled_for timestamptz,
  local_date date,
  endpoint text,
  p256dh text,
  auth_secret text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
begin
  update private.notification_deliveries
  set
    status = 'expired',
    claim_token = null,
    claim_expires_at = null,
    error_code = 'delivery_window_elapsed',
    updated_at = v_now
  where status in ('pending', 'processing', 'retry')
    and scheduled_for + interval '15 minutes' <= v_now;

  update private.notification_deliveries
  set
    status = 'failed',
    claim_token = null,
    claim_expires_at = null,
    error_code = 'retry_limit_reached',
    updated_at = v_now
  where status in ('pending', 'processing', 'retry')
    and attempts >= 3
    and (
      status <> 'processing'
      or claim_expires_at is null
      or claim_expires_at <= v_now
    );

  return query
  with candidates as materialized (
    select delivery.id
    from private.notification_deliveries as delivery
    join private.push_subscriptions as subscription
      on subscription.id = delivery.subscription_id
      and subscription.enabled
      and subscription.disabled_at is null
    where delivery.scheduled_for + interval '15 minutes' > v_now
      and delivery.attempts < 3
      and (
        (delivery.status in ('pending', 'retry') and delivery.next_attempt_at <= v_now)
        or (delivery.status = 'processing' and delivery.claim_expires_at <= v_now)
      )
    order by delivery.next_attempt_at, delivery.scheduled_for
    -- Lock only delivery work. Disablement locks the subscription first and can
    -- then cancel this claim immediately after this short transaction commits;
    -- avoiding a second lock here also avoids a subscription/delivery deadlock.
    for update of delivery skip locked
    limit greatest(1, least(coalesce(p_limit, 8), 25))
  ), claimed as (
    update private.notification_deliveries as delivery
    set
      status = 'processing',
      attempts = delivery.attempts + 1,
      claim_token = gen_random_uuid(),
      claim_expires_at = v_now + make_interval(
        secs => greatest(30, least(coalesce(p_lease_seconds, 45), 120))
      ),
      updated_at = v_now
    from candidates
    where delivery.id = candidates.id
      and exists (
        select 1
        from private.push_subscriptions as current_subscription
        where current_subscription.id = delivery.subscription_id
          and current_subscription.enabled
          and current_subscription.disabled_at is null
      )
    returning delivery.*
  )
  select
    claimed.id,
    claimed.claim_token,
    claimed.attempts,
    claimed.scheduled_for,
    claimed.local_date,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth_secret
  from claimed
  join private.push_subscriptions as subscription
    on subscription.id = claimed.subscription_id
  where subscription.enabled and subscription.disabled_at is null;
end;
$$;

create or replace function public._internal_finish_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_provider_status integer default null,
  p_error_code text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_subscription_id uuid;
  v_delivery private.notification_deliveries%rowtype;
  v_retry_at timestamptz;
begin
  select subscription_id into v_subscription_id
  from private.notification_deliveries
  where id = p_delivery_id;

  if not found then
    return false;
  end if;

  -- Match the disable path's lock order (subscription, then delivery). This
  -- makes a successful return a durable finalization and avoids lock inversion
  -- when an expired endpoint is being disabled concurrently.
  perform 1
  from private.push_subscriptions
  where id = v_subscription_id
  for update;

  if not found then
    return false;
  end if;

  select * into v_delivery
  from private.notification_deliveries
  where id = p_delivery_id
    and claim_token = p_claim_token
    and status = 'processing'
  for update;

  if not found then
    return false;
  end if;

  if p_outcome = 'sent' then
    update private.notification_deliveries
    set
      status = 'sent',
      provider_status = p_provider_status,
      error_code = null,
      sent_at = v_now,
      claim_token = null,
      claim_expires_at = null,
      updated_at = v_now
    where id = p_delivery_id;
  elsif p_outcome = 'expired' then
    update private.notification_deliveries
    set
      status = 'failed',
      provider_status = p_provider_status,
      error_code = left(coalesce(p_error_code, 'subscription_expired'), 120),
      claim_token = null,
      claim_expires_at = null,
      updated_at = v_now
    where id = p_delivery_id;

    update private.push_subscriptions
    set
      enabled = false,
      disabled_at = v_now,
      failure_count = failure_count + 1,
      updated_at = v_now
    where id = v_delivery.subscription_id;

    update private.notification_deliveries
    set
      status = 'cancelled',
      claim_token = null,
      claim_expires_at = null,
      error_code = 'subscription_disabled',
      updated_at = v_now
    where subscription_id = v_delivery.subscription_id
      and id <> p_delivery_id
      and status in ('pending', 'processing', 'retry');
  elsif p_outcome = 'retry' and v_delivery.attempts < 3 then
    v_retry_at := v_now + make_interval(secs => 30 * (2 ^ greatest(0, v_delivery.attempts - 1))::integer);
    if v_retry_at < v_delivery.scheduled_for + interval '15 minutes' then
      update private.notification_deliveries
      set
        status = 'retry',
        provider_status = p_provider_status,
        error_code = left(coalesce(p_error_code, 'transient_push_failure'), 120),
        next_attempt_at = v_retry_at,
        claim_token = null,
        claim_expires_at = null,
        updated_at = v_now
      where id = p_delivery_id;
    else
      update private.notification_deliveries
      set
        status = 'expired',
        provider_status = p_provider_status,
        error_code = 'delivery_window_elapsed',
        claim_token = null,
        claim_expires_at = null,
        updated_at = v_now
      where id = p_delivery_id;
    end if;
  else
    update private.notification_deliveries
    set
      status = case when v_now >= scheduled_for + interval '15 minutes' then 'expired' else 'failed' end,
      provider_status = p_provider_status,
      error_code = left(coalesce(p_error_code, 'push_failed'), 120),
      claim_token = null,
      claim_expires_at = null,
      updated_at = v_now
    where id = p_delivery_id;
  end if;

  return true;
end;
$$;

revoke all on function public._internal_upsert_push_subscription(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public._internal_disable_push_subscription(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public._internal_claim_test_subscription(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public._internal_enqueue_due_reminders(integer) from public, anon, authenticated;
revoke all on function public._internal_claim_deliveries(integer, integer) from public, anon, authenticated;
revoke all on function public._internal_finish_delivery(uuid, uuid, text, integer, text) from public, anon, authenticated;

grant execute on function public._internal_upsert_push_subscription(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public._internal_disable_push_subscription(uuid, uuid, text) to service_role;
grant execute on function public._internal_claim_test_subscription(uuid, uuid, text) to service_role;
grant execute on function public._internal_enqueue_due_reminders(integer) to service_role;
grant execute on function public._internal_claim_deliveries(integer, integer) to service_role;
grant execute on function public._internal_finish_delivery(uuid, uuid, text, integer, text) to service_role;
