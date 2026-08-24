# Evening Note

Evening Note is an iPhone-first progressive web app for one private daily text entry and a Web Push reminder at 19:45 in each subscribed device’s latest known timezone.

## What is implemented

- Verified email-and-password authentication through Supabase Auth, including signup, recovery, and password changes.
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
npm run typecheck
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

2. Apply the password-auth configuration with `supabase config push`. It enables email signup and confirmation, makes the GitHub Pages URL canonical, and allowlists the exact local, Sites, Pages, and password-recovery callbacks. `supabase db push` applies database migrations only; it does not apply Auth configuration.

   In **Authentication → Sign In / Providers → Email**, set the minimum password length to `8`, enable **Confirm email**, and enable **Require current password when updating**. Leave the separate secure-password-change/email-OTP reauthentication option disabled. The application removes OTP sign-in entirely; an existing OTP account can use **Forgot password** to set its first password without changing its user ID or entries.

   Supabase's built-in mailer only sends confirmation and recovery emails to project-team addresses and is limited to two messages per hour. That is sufficient for initial team testing. Configure custom SMTP before allowing public registration.

3. Generate a VAPID P-256 key pair locally. Do not commit or paste the private key into browser configuration:

   ```bash
   npm run generate:vapid
   ```

4. Create a dedicated Supabase secret API key named `automations`. Hosted Edge Functions receive the `default` and `automations` keys through Supabase's `SUPABASE_SECRET_KEYS` JSON map automatically. Set the app-specific Edge Function secrets. `APP_ORIGIN` is the bare browser origin for CORS; `APP_URL` is the full canonical app URL used in notification links and may contain a project path:

   ```bash
   supabase secrets set APP_ORIGIN=https://YOUR_SITE_HOSTNAME
   supabase secrets set APP_URL=https://YOUR_SITE_HOSTNAME/OPTIONAL_BASE_PATH
   supabase secrets set VAPID_SUBJECT=mailto:operator@example.com
   supabase secrets set VAPID_PUBLIC_KEY=YOUR_VAPID_PUBLIC_KEY
   supabase secrets set VAPID_PRIVATE_KEY=YOUR_VAPID_PRIVATE_KEY
   ```

   A comma-separated `APP_ORIGINS` allowlist is available only for a short host migration. Push payloads use one global `APP_URL`, so two installed frontends are not supported as simultaneous canonical notification hosts.

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
   - `NEXT_PUBLIC_BASE_PATH` (empty for a root deployment)
   - `NEXT_PUBLIC_DEMO_MODE=false`

8. Set the Supabase Auth Site URL to the full deployed app URL. The Edge Functions allow the configured bare origins plus `http://localhost:3000` for local development.

## GitHub Pages

This repository includes a conditional static export and a manual GitHub Pages workflow. It keeps the existing Sites build target intact, while the Pages build scopes assets, the manifest, offline cache, service worker, and notification navigation to its configured project path.

Before running the workflow:

1. In the GitHub repository, select **Settings → Pages → Source → GitHub Actions**.
2. Add these GitHub Actions repository variables (they are browser-public values, not private secrets):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   - `NEXT_PUBLIC_SITE_URL` (`https://rusherzero.github.io/evening-note` for the default project URL)
   - `NEXT_PUBLIC_BASE_PATH` (`/evening-note` for the default project URL; `/` for a custom domain root)
3. Merge the workflow into the default branch, then manually run **Deploy Evening Note to GitHub Pages**. It tests, lints, type-checks, validates Edge syntax, builds, audits the configured app scope, and publishes `out/`.
4. Configure the backend for the Pages host, then redeploy the three Edge Functions:

   ```bash
   supabase secrets set APP_ORIGIN=https://rusherzero.github.io
   supabase secrets set APP_URL=https://rusherzero.github.io/evening-note
   ```

   Treat this as a host cutover: disable reminders in the old installed frontend, use Pages as the only canonical notification host, and then enable reminders again in the new installation.

For a local production-equivalent artifact, provide the public environment values and run:

```bash
npm run build:pages
npm run check:pages-build
```

The default project URL is `https://rusherzero.github.io/evening-note/`. GitHub Pages projects on the same account share the `rusherzero.github.io` browser origin, which means another Pages repository on that account could access origin-scoped browser storage. Because Evening Note holds private notes and an auth session, use the default URL for testing only; a dedicated custom domain is a production launch requirement.

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

Use Safari on iOS 16.4 or newer, choose **Share → Add to Home Screen**, then open the installed app. Sign in inside that Home Screen app, enable reminders from Settings, and send a test. Confirm that a cold notification tap opens the deployment's `?view=today` URL inside its app scope. Daily delivery is best-effort around 19:45; connectivity, Focus, and Scheduled Summary can delay the visible alert.

Run database tests against a local Supabase stack with:

```bash
supabase test db
```
