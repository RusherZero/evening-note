begin;

select plan(11);

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
) values
  (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'first@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'second@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (select count(*)::integer from public.entries),
  0,
  'a new user starts with no entries'
);

select lives_ok(
  $$select * from public.save_daily_entry('  A calm first note.  ', 'Europe/Amsterdam')$$,
  'an authenticated user can save today''s entry'
);

select is(
  (select count(*)::integer from public.entries),
  1,
  'saving creates exactly one row'
);

select is(
  (select content from public.entries limit 1),
  'A calm first note.',
  'entry content is trimmed'
);

select lives_ok(
  $$select * from public.save_daily_entry('An updated note.', 'Europe/Amsterdam')$$,
  'today''s entry can be revised'
);

select is(
  (select count(*)::integer from public.entries),
  1,
  'revising today updates rather than duplicates'
);

select is(
  (select content from public.entries limit 1),
  'An updated note.',
  'the revised content is stored'
);

select throws_ok(
  $$select * from public.save_daily_entry('   ', 'Europe/Amsterdam')$$,
  '22023',
  'Entry cannot be empty',
  'an empty entry is rejected'
);

select throws_ok(
  $$select * from public.save_daily_entry(repeat('x', 10001), 'Europe/Amsterdam')$$,
  '22001',
  'Entry is too long',
  'an entry above the maximum length is rejected'
);

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.entries),
  0,
  'RLS hides another user''s entry'
);

reset role;
update public.entries
set
  entry_date = (statement_timestamp() at time zone 'Pacific/Pago_Pago')::date,
  saved_timezone = 'Pacific/Kiritimati'
where user_id = '10000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select * from public.save_daily_entry('A late revision.', 'Pacific/Pago_Pago')$$,
  '22023',
  'Past entries are read-only',
  'an entry cannot be reopened after its initially saved local day ends'
);

select * from finish();
rollback;
