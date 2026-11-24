# Samwise: notes for coding agents

Samwise is a personal garden organizer: Angular 22 (standalone, zoneless, signals) on
Supabase (Postgres with RLS, Edge Functions on Deno), syncing tasks to Google Calendar.
The README explains the setup; `docs/ROADMAP.md` lists what's done and planned.

## UI

Follow **[docs/DESIGN.md](docs/DESIGN.md)** for every UI change: layout, dialogs, forms,
buttons, chips, texts and accessibility. Reuse the shared components it lists. If you need
a pattern it doesn't cover, add the pattern to DESIGN.md in the same change.

## Data safety

- **Never reset the local database** (`supabase db reset`, `npm run test:sql`,
  `npm run test:all`). It holds the owner's real data, and there is no backup.
- Apply new migrations with `npx supabase migration up`.
- Run SQL tests one file at a time: `npm run db:psql -- -f supabase/tests/sql/<file>`.
  Each one rolls itself back.
- Never commit `supabase/.env` or `supabase/functions/.env`; they hold secrets.

## Checks before committing

- `npm run build`: no errors or warnings.
- `npm run test:app`: Angular unit tests (Karma, headless Chrome).
- `npm run test:functions`: Edge Function tests (needs Deno on the PATH).
- The SQL test for any migration you add or change, run as above.
- Look at UI changes in the browser at 1280 px and 390 px wide.
