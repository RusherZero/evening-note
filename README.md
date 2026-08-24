# Evening Note

Evening Note is an iPhone-first progressive web app for one private daily text entry and a Web Push reminder at 19:45 in each subscribed device’s latest known timezone.

## What is implemented

- Email one-time-code authentication through Supabase Auth.
- One entry per authenticated user and local calendar day, with a read-only history.
- Row-level security and a server-side `save_daily_entry` RPC.
- Installable PWA metadata, Apple touch icon, maskable icon, offline shell, and device-scoped draft recovery.
- User-initiated iPhone Web Push setup, reconciliation, disable-before-sign-out, and test notifications.
- DST-aware reminder scheduling with an idempotent database queue, processing leases, bounded retries, a 15-minute delivery window, and expired-subscription cleanup.
- Supabase Edge Functions for subscription registration, test pushes, and scheduled delivery.
- Unit tests, install-asset checks, and pgTAP database tests.

## Local development

```bash
npm install
npm run dev
```

When public Supabase settings are absent, local development uses preview mode. Preview entries remain only in that browser. Copy `.env.example` to `.env.local` and fill in the public values to exercise real authentication and storage.

```bash
npm test
npm run lint
npm run check:edge-syntax
npm run build
```

## Connect a Supabase project

1. Create a fresh Supabase project, install the Supabase CLI, link this repository, and apply the migration:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

2. Configure custom SMTP (or use a Supabase plan/provider that permits hosted email-template changes). Supabase's default free-tier mail provider rejects custom template updates. Then set the email OTP length to six and replace **Authentication → Email Templates → Magic Link** with the code-only template in `supabase/templates/magic_link.html`, which includes `{{ .Token }}`. The client calls `verifyOtp` with `type: "email"`; the token must remain a six-digit string.

   Until SMTP is connected, `supabase/config.toml` deliberately preserves the hosted project's eight-digit setting and does not activate the custom template. Sign-in is not launch-ready in that temporary state.

3. Generate a VAPID P-256 key pair locally. Do not commit or paste the private key into browser configuration:

   ```bash
   npm run generate:vapid
   ```

4. Create a dedicated Supabase secret API key named `automations`. Hosted Edge Functions receive the `default` and `automations` keys through Supabase's `SUPABASE_SECRET_KEYS` JSON map automatically. Set the app-specific Edge Function secrets, using the deployed HTTPS origin and an operator contact email for the VAPID subject:

   ```bash
   supabase secrets set APP_ORIGIN=https://YOUR_SITE_HOSTNAME
   supabase secrets set VAPID_SUBJECT=mailto:operator@example.com
   supabase secrets set VAPID_PUBLIC_KEY=YOUR_VAPID_PUBLIC_KEY
   supabase secrets set VAPID_PRIVATE_KEY=YOUR_VAPID_PRIVATE_KEY
   ```

   `SUPABASE_SECRET_KEY` and `AUTOMATIONS_SECRET_KEY` remain supported for local development; `SUPABASE_SERVICE_ROLE_KEY` is a legacy fallback.

5. Deploy all three functions:

   ```bash
   supabase functions deploy push-subscription
   supabase functions deploy test-push
   supabase functions deploy send-reminders
   ```

6. Store the project URL and the same automation key in Supabase Vault. `supabase db push` applies the migration, but it does **not** execute the separate Cron file. Run these statements in the SQL editor with the real values, then run the contents of `supabase/cron/schedule.sql` there as a separate step:

   ```sql
   select vault.create_secret(
     'https://YOUR_PROJECT_REF.supabase.co',
     'evening_note_project_url'
   );

   select vault.create_secret(
     'YOUR_AUTOMATIONS_SECRET_KEY',
     'evening_note_automations_key'
   );
   ```

7. Configure the hosted frontend with only these public values:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   - `NEXT_PUBLIC_SITE_URL`
   - `NEXT_PUBLIC_DEMO_MODE=false`

8. Set the Supabase Auth Site URL to the deployed origin. The Edge Functions allow that exact `APP_ORIGIN` plus `http://localhost:3000` for local development.

## Scheduling and privacy behavior

The Cron job invokes `send-reminders` once per minute. PostgreSQL stores timestamps in UTC and calculates each device’s next local 19:45 from its IANA timezone. Every due subscription is enqueued once per local date, then claimed with a short processing lease. Network errors, HTTP 429, and provider 5xx responses retry at most three times inside the original 15-minute window. HTTP 404/410 disables the expired subscription.

Each account may have up to 10 active reminder devices. A test push is limited to once per account per minute. The timezone captured when an entry is first saved is also its conservative edit-window boundary: travel can close that day early, but a caller cannot use another timezone to reopen a past note.

Notification payloads contain only generic copy. Entry text, push endpoints, encryption keys, auth headers, and VAPID secrets are never included in application logs or lock-screen content.

Useful operational checks:

```sql
select j.jobname, r.*
from cron.job_run_details as r
join cron.job as j on j.jobid = r.jobid
where j.jobname = 'evening-note-reminders'
order by r.start_time desc
limit 20;

select status, count(*)
from private.notification_deliveries
where created_at > now() - interval '24 hours'
group by status;
```

## iPhone acceptance check

Use Safari on iOS 16.4 or newer, choose **Share → Add to Home Screen**, then open the installed app. Sign in inside that Home Screen app, enable reminders from Settings, and send a test. Confirm that a cold notification tap opens `/?view=today`. Daily delivery is best-effort around 19:45; connectivity, Focus, and Scheduled Summary can delay the visible alert.

Run database tests against a local Supabase stack with:

```bash
supabase test db
```
