-- Run after creating these two Supabase Vault secrets:
--   evening_note_project_url       https://YOUR_PROJECT_REF.supabase.co
--   evening_note_automations_key   a dedicated Supabase secret API key

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'evening-note-reminders') then
    perform cron.unschedule('evening-note-reminders');
  end if;
end;
$$;

select cron.schedule(
  'evening-note-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'evening_note_project_url'
    ) || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'evening_note_automations_key'
      )
    ),
    body := '{}'::jsonb,
    -- The sender stops claiming work after 50 seconds. Keep the caller alive
    -- slightly longer so it can durably finalize successful pushes.
    timeout_milliseconds := 60000
  );
  $$
);
