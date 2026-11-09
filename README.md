# Samwise

Personal garden organizer: plan garden beds on a grid, track plants and their
care info, and auto-generate care tasks that sync to Google Calendar.

- Design spec: [docs/superpowers/specs/2026-08-19-samwise-design.md](docs/superpowers/specs/2026-08-19-samwise-design.md)
- Implementation plan: [docs/superpowers/plans/2026-08-19-samwise.md](docs/superpowers/plans/2026-08-19-samwise.md)

## Setup

### 1. Prerequisites

| Tool | Used for |
| --- | --- |
| Node.js (LTS) + npm | Angular app |
| Angular CLI (`npm i -g @angular/cli`) | `ng serve` / `ng test` / `ng build` |
| Supabase CLI | Local stack, migrations, Edge Functions, deploys |
| Docker Desktop (running) | Required by `supabase start` |
| Deno | Edge Function tests (`deno test`) |
| `psql` | SQL-level tests against the local database |

On Windows, `psql` isn't installed by default (install the PostgreSQL
command-line tools), and the plan's test commands use `grep`/`cut`, so run
them in Git Bash.

### 2. Google Cloud project

One OAuth client covers both Google sign-in and the Calendar connection.

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. **APIs & Services → Library:** enable the **Google Calendar API**.
3. **OAuth consent screen:**
   - User type: External.
   - Scopes: `email`, `profile`,
     `https://www.googleapis.com/auth/calendar.app.created`. That last one
     lets Samwise create its own "Samwise" calendar and manage events on it,
     with no access to your other calendars.
   - **Publishing status: In production.** `calendar.app.created` is a
     sensitive scope. While the app is in *Testing*, Google expires refresh tokens
     after 7 days, which silently breaks background sync. For personal use you
     don't need Google's verification; you'll see an "unverified app" warning
     when you sign in, and you can click through it.
4. **Credentials → Create OAuth client ID → Web application.** Authorized
   redirect URIs:

   | URI | Purpose |
   | --- | --- |
   | `http://127.0.0.1:54321/auth/v1/callback` | Sign-in, local Supabase |
   | `https://<project-ref>.supabase.co/auth/v1/callback` | Sign-in, hosted Supabase |
   | `http://localhost:4200/settings` | Calendar connect, local app |
   | `https://<your-domain>/settings` | Calendar connect, production app |

   Production hosting isn't chosen yet. Add the last URI once the domain exists.
5. Keep the **client ID** and **client secret** for the next steps.

### 3. Local development

**Supabase Auth config** in `supabase/config.toml`:

```toml
[auth]
site_url = "http://localhost:4200"
additional_redirect_urls = ["http://localhost:4200"]

[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"

# The tasks webhook authenticates with a shared secret, not a JWT.
[functions.calendar-sync]
verify_jwt = false
```

**Env files** (both are gitignored, so never commit them):

`supabase/.env`, read by `config.toml`:

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<google client id>
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<google client secret>
```

`supabase/functions/.env`, read by Edge Functions:

```
GOOGLE_CLIENT_ID=<google client id>
GOOGLE_CLIENT_SECRET=<google client secret>
GOOGLE_REDIRECT_URI=http://localhost:4200/settings
CALENDAR_SYNC_WEBHOOK_SECRET=<random string, e.g. `openssl rand -hex 32`>
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected into Edge Functions automatically.

**Start the stack:**

```bash
supabase start          # prints API URL, anon key, DB URL
supabase db reset       # applies migrations + seed data
supabase functions serve
```

**Vault secrets for the tasks webhook.** Run these once after each
`db reset`, e.g. via `psql "$DB_URL"`. Postgres runs inside Docker, so the
function URL uses `host.docker.internal`, not `127.0.0.1`:

```sql
select vault.create_secret('http://host.docker.internal:54321/functions/v1/calendar-sync', 'calendar_sync_url');
select vault.create_secret('<same value as CALENDAR_SYNC_WEBHOOK_SECRET>', 'calendar_sync_webhook_secret');
```

**Angular environment** in `src/environments/environment.development.ts`:
set `supabaseAnonKey` to the anon key printed by `supabase start`, and set
`googleClientId` to the Google client ID. The client ID is public; never put
the client secret in the frontend.

```bash
ng serve                # http://localhost:4200
```

### 4. Hosted Supabase (production)

1. Create a Supabase project, then link and push:
   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   supabase functions deploy connect-calendar
   supabase functions deploy disconnect-calendar
   supabase functions deploy calendar-sync --no-verify-jwt
   ```
2. **Database → Extensions:** confirm `pg_cron`, `pg_net` and `supabase_vault`
   are enabled. The migrations create the first two, so this is a check.
3. **Authentication → Providers → Google:** enable it and enter the client
   ID and secret.
4. **Authentication → URL Configuration:** set Site URL to
   `https://<your-domain>` and add it to the redirect allow-list.
5. **Edge Function secrets:**
   ```bash
   supabase secrets set \
     GOOGLE_CLIENT_ID=<id> \
     GOOGLE_CLIENT_SECRET=<secret> \
     GOOGLE_REDIRECT_URI=https://<your-domain>/settings \
     CALENDAR_SYNC_WEBHOOK_SECRET=<new random string>
   ```
6. **Vault secrets.** Run in the SQL editor:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/calendar-sync', 'calendar_sync_url');
   select vault.create_secret('<same value as CALENDAR_SYNC_WEBHOOK_SECRET>', 'calendar_sync_webhook_secret');
   ```
7. **`src/environments/environment.ts`:** fill in the hosted `supabaseUrl`,
   `supabaseAnonKey` and `googleClientId`.

### 5. Frontend hosting

Not decided yet. Any static host works: deploy the output of `ng build` and
configure an SPA fallback so every route serves `index.html`. Once you have
the domain, add it to the Google redirect URIs (step 2) and the Supabase URL
configuration (step 4).

## Security decisions

- **Samwise uses its own calendar.** Connecting creates a "Samwise"
  calendar in your Google account and puts every task there, never in your
  primary calendar. You can hide or recolor it like any other calendar.
  Disconnecting deletes it. If you delete it yourself in Google Calendar,
  Samwise treats that as a disconnect, and Settings offers to reconnect.
- **The Calendar refresh token never reaches the browser.** The client has
  no direct access to `calendar_credentials`.
  - `connect-calendar` writes the row with the service role.
  - `disconnect-calendar` deletes the row and revokes the token with Google.
  - The Settings page asks for status through the
    `has_calendar_connection()` RPC (security definer, returns a boolean only).
- **The tasks webhook authenticates with a shared secret.**
  - `calendar-sync` runs with `verify_jwt = false`.
  - The `tasks` trigger sends an `x-webhook-secret` header read from Vault.
  - The function rejects any request whose header doesn't match
    `CALENDAR_SYNC_WEBHOOK_SECRET`.
- **Per-environment DB settings live in Supabase Vault**
  (`calendar_sync_url`, `calendar_sync_webhook_secret`), not in database
  settings (GUCs).
