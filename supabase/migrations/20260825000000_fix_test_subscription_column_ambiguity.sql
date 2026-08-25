-- Qualify push subscription columns that collide with RETURNS TABLE output
-- variables in the test-notification claim function.

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

revoke all on function public._internal_claim_test_subscription(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public._internal_claim_test_subscription(uuid, uuid, text)
  to service_role;
