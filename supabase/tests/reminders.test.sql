begin;

select plan(30);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '30000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'reminder@example.test',
  '',
  now(),
  '{}',
  '{}',
  now(),
  now()
);

select is(
  private.next_reminder_at('Europe/Amsterdam', '2026-08-24 17:00:00+00'::timestamptz),
  '2026-08-24 17:45:00+00'::timestamptz,
  'summer reminder resolves to local 19:45'
);

select is(
  private.next_reminder_at('Europe/Amsterdam', '2026-08-24 18:00:00+00'::timestamptz),
  '2026-08-25 17:45:00+00'::timestamptz,
  'registration after 19:45 schedules tomorrow'
);

select is(
  private.next_reminder_at('Europe/Amsterdam', '2026-10-25 18:00:00+00'::timestamptz),
  '2026-10-25 18:45:00+00'::timestamptz,
  'DST fall-back still resolves local 19:45'
);

select throws_ok(
  $$select * from public._internal_upsert_push_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000030',
    'https://fcm.googleapis.com/fcm/send/invalid-zone',
    'BHgKOEf39QDyA76qjvmFAldXrSaBFBVLfoozk-hRWSHf_5MLwYuJ-98VSNFsNpl1Cv4EVi233tZ6x9YY0bRZoUE',
    'BwcHBwcHBwcHBwcHBwcHBw',
    'Mars/Olympus_Mons'
  )$$,
  '22023',
  'Invalid timezone',
  'invalid timezone names are rejected'
);

select throws_ok(
  $$select * from public._internal_upsert_push_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000030',
    'https://127.0.0.1/internal',
    'BHgKOEf39QDyA76qjvmFAldXrSaBFBVLfoozk-hRWSHf_5MLwYuJ-98VSNFsNpl1Cv4EVi233tZ6x9YY0bRZoUE',
    'BwcHBwcHBwcHBwcHBwcHBw',
    'Europe/Amsterdam'
  )$$,
  '22023',
  'Invalid push endpoint',
  'non-browser endpoints are rejected to prevent SSRF'
);

select throws_ok(
  $$select * from public._internal_upsert_push_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000030',
    'https://fcm.googleapis.com/fcm/send/invalid-key',
    'not-a-p256-key',
    'not-an-auth-key',
    'Europe/Amsterdam'
  )$$,
  '22023',
  'Invalid push subscription keys',
  'malformed subscription key material is rejected'
);

select lives_ok(
  $$select * from public._internal_upsert_push_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000030',
    'https://fcm.googleapis.com/fcm/send/one',
    'BHgKOEf39QDyA76qjvmFAldXrSaBFBVLfoozk-hRWSHf_5MLwYuJ-98VSNFsNpl1Cv4EVi233tZ6x9YY0bRZoUE',
    'BwcHBwcHBwcHBwcHBwcHBw',
    'Europe/Amsterdam'
  )$$,
  'a valid subscription can be registered'
);

select lives_ok(
  $$select * from public._internal_upsert_push_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000030',
    'https://fcm.googleapis.com/fcm/send/one',
    'BHgKOEf39QDyA76qjvmFAldXrSaBFBVLfoozk-hRWSHf_5MLwYuJ-98VSNFsNpl1Cv4EVi233tZ6x9YY0bRZoUE',
    'BwcHBwcHBwcHBwcHBwcHBw',
    'Europe/Amsterdam'
  )$$,
  'registration reconciliation is idempotent'
);

select is(
  (select count(*)::integer from private.push_subscriptions),
  1,
  'reconciliation does not duplicate a device'
);

select lives_ok(
  $$select * from public._internal_upsert_push_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000031',
    'https://web.push.apple.com/device/two',
    'BHgKOEf39QDyA76qjvmFAldXrSaBFBVLfoozk-hRWSHf_5MLwYuJ-98VSNFsNpl1Cv4EVi233tZ6x9YY0bRZoUE',
    'BwcHBwcHBwcHBwcHBwcHBw',
    'Europe/Amsterdam'
  )$$,
  'a second device can be registered'
);

select is(
  (select count(*)::integer from public._internal_claim_test_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000030',
    'https://fcm.googleapis.com/fcm/send/one'
  )),
  1,
  'the first test push in a minute is accepted'
);

select is(
  (select count(*)::integer from public._internal_claim_test_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000031',
    'https://web.push.apple.com/device/two'
  )),
  0,
  'the test-push rate limit applies across all devices for a user'
);

select lives_ok(
  $$do $block$
  declare
    i integer;
  begin
    for i in 32..39 loop
      perform public._internal_upsert_push_subscription(
        '30000000-0000-4000-8000-000000000003',
        ('30000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        'https://fcm.googleapis.com/fcm/send/device-' || i::text,
        'BHgKOEf39QDyA76qjvmFAldXrSaBFBVLfoozk-hRWSHf_5MLwYuJ-98VSNFsNpl1Cv4EVi233tZ6x9YY0bRZoUE',
        'BwcHBwcHBwcHBwcHBwcHBw',
        'Europe/Amsterdam'
      );
    end loop;
  end
  $block$;$$,
  'up to ten active devices can be registered'
);

select throws_ok(
  $$select * from public._internal_upsert_push_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000040',
    'https://fcm.googleapis.com/fcm/send/device-40',
    'BHgKOEf39QDyA76qjvmFAldXrSaBFBVLfoozk-hRWSHf_5MLwYuJ-98VSNFsNpl1Cv4EVi233tZ6x9YY0bRZoUE',
    'BwcHBwcHBwcHBwcHBwcHBw',
    'Europe/Amsterdam'
  )$$,
  '22023',
  'Active subscription limit reached',
  'an eleventh active device is rejected'
);

update private.push_subscriptions
set next_due_at = statement_timestamp() - interval '10 seconds'
where installation_id = '30000000-0000-4000-8000-000000000030';

select public._internal_enqueue_due_reminders(100);
select public._internal_enqueue_due_reminders(100);

select is(
  (select count(*)::integer from private.notification_deliveries),
  1,
  'overlapping enqueue passes create one daily delivery'
);

select is(
  (select count(*)::integer from public._internal_claim_deliveries(8, 45)),
  1,
  'an enabled due subscription can be claimed once'
);

select ok(
  public._internal_disable_push_subscription(
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000030',
    'https://fcm.googleapis.com/fcm/send/one'
  ),
  'the owning device can disable its subscription'
);

select is(
  (select status from private.notification_deliveries limit 1),
  'cancelled',
  'disablement cancels an outstanding claimed delivery'
);

select is(
  (select count(*)::integer from public._internal_claim_deliveries(8, 45)),
  0,
  'a cancelled delivery is not reclaimed'
);

update private.push_subscriptions
set next_due_at = statement_timestamp() - interval '10 seconds'
where installation_id = '30000000-0000-4000-8000-000000000031';

select is(
  public._internal_enqueue_due_reminders(100),
  1,
  'another due device is enqueued'
);

create temporary table claimed_retry as
select * from public._internal_claim_deliveries(8, 45);

select is(
  (select count(*)::integer from claimed_retry),
  1,
  'retry test delivery is claimed once'
);

select ok(
  not public._internal_finish_delivery(
    (select delivery_id from claimed_retry),
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'sent',
    201,
    null
  ),
  'a stale claim token cannot finalize a delivery'
);

select ok(
  public._internal_finish_delivery(
    (select delivery_id from claimed_retry),
    (select claim_token from claimed_retry),
    'retry',
    503,
    'transient_push_failure'
  ),
  'a transient provider response schedules a retry'
);

select is(
  (select status from private.notification_deliveries where id = (select delivery_id from claimed_retry)),
  'retry',
  'the retry remains inside the original delivery record'
);

update private.notification_deliveries
set next_attempt_at = statement_timestamp() - interval '1 second'
where id = (select delivery_id from claimed_retry);

create temporary table claimed_retry_second as
select * from public._internal_claim_deliveries(8, 45);

select is(
  (select count(*)::integer from claimed_retry_second),
  1,
  'a due retry can be claimed again'
);

select is(
  (select attempts from claimed_retry_second),
  2,
  'retry attempts are counted atomically'
);

select ok(
  public._internal_finish_delivery(
    (select delivery_id from claimed_retry_second),
    (select claim_token from claimed_retry_second),
    'sent',
    201,
    null
  ),
  'a successful retry is finalized'
);

select is(
  (select status from private.notification_deliveries where id = (select delivery_id from claimed_retry_second)),
  'sent',
  'the final delivery state is sent'
);

select ok(
  not public._internal_finish_delivery(
    (select delivery_id from claimed_retry),
    (select claim_token from claimed_retry),
    'sent',
    201,
    null
  ),
  'a late completion from an expired lease is rejected'
);

select is(
  (select count(*)::integer from public._internal_claim_deliveries(8, 45)),
  0,
  'a sent delivery is never reclaimed'
);

select * from finish();
rollback;
