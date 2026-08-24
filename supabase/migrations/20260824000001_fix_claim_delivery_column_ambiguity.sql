-- Qualify delivery columns that collide with RETURNS TABLE output variables.
-- Without the aliases, PL/pgSQL treats `scheduled_for` and `attempts` as
-- ambiguous when the worker claims a batch.

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
  update private.notification_deliveries as delivery
  set
    status = 'expired',
    claim_token = null,
    claim_expires_at = null,
    error_code = 'delivery_window_elapsed',
    updated_at = v_now
  where delivery.status in ('pending', 'processing', 'retry')
    and delivery.scheduled_for + interval '15 minutes' <= v_now;

  update private.notification_deliveries as delivery
  set
    status = 'failed',
    claim_token = null,
    claim_expires_at = null,
    error_code = 'retry_limit_reached',
    updated_at = v_now
  where delivery.status in ('pending', 'processing', 'retry')
    and delivery.attempts >= 3
    and (
      delivery.status <> 'processing'
      or delivery.claim_expires_at is null
      or delivery.claim_expires_at <= v_now
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

revoke all on function public._internal_claim_deliveries(integer, integer)
  from public, anon, authenticated;
grant execute on function public._internal_claim_deliveries(integer, integer)
  to service_role;
