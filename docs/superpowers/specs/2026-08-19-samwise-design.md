# Samwise — Design

Date: 2026-08-19

## Overview

Samwise is a personal garden-organizing app: plan garden bed layouts, track plants
with their care/flowering info, and auto-generate a task schedule (seeding,
transplanting, pruning, fertilizing, harvesting) that syncs to Google Calendar.

## Requirements

- Single user for now; data model must support adding proper multi-user
  access later without a rewrite.
- Responsive web app (desktop + mobile browser), no native/PWA requirement.
- Garden bed layout as a simple grid (rows x cols of cells), not free-form shapes.
- Plant catalog: a seeded library of common plants with default care info,
  plus user-added custom plants.
- Tasks (seed_start, transplant, prune, fertilize, harvest) are auto-generated
  from a plant's care rules once it's planted, editable/deletable afterward.
- Two-way-feeling calendar experience: in-app agenda view AND sync to Google
  Calendar, including background sync (not just at login).

## Non-goals (for this iteration)

- Multi-user support itself (only the groundwork for it).
- Free-form/canvas bed layouts.
- Native mobile app / offline-first PWA.
- Pulling plant data from a third-party plant API.

## Architecture

- **Frontend**: Angular (standalone components, Router, signals for local
  state). Injectable services per domain: `GardenService`,
  `PlantCatalogService`, `TaskService`, `CalendarSyncService`. No separate
  state-management library needed at this scale.
- **Backend**: Supabase.
  - Postgres for all data, Row Level Security on every table keyed by
    `user_id = auth.uid()`.
  - Supabase Auth with Google as the sole OAuth provider (reused later for
    Calendar scope).
  - One Supabase Edge Function handles Google Calendar push, keeping the
    stored Calendar refresh token server-side only.
  - Task generation lives in a Postgres function + trigger, not client code,
    so it happens consistently regardless of which client creates the
    planting.

### Why Supabase over Firebase

The domain (beds → cells → plantings; plants → care rules → generated tasks)
is inherently relational, which Postgres/Supabase models directly (foreign
keys, joins) versus Firestore's document/denormalization approach. RLS is
also a clean, additive path from single-user to multi-user: add a `user_id`
column and policy now, no schema rework later. Supabase Auth's Google OAuth
flow can also surface a Calendar refresh token that the app stores for
background sync; Firebase Auth doesn't manage a Google refresh token for
later reuse, which would require a separate OAuth flow bolted on regardless.

## Data model

All tables carry `user_id` and an RLS policy `user_id = auth.uid()`, except
`plants_catalog` rows seeded as shared reference data (`user_id IS NULL`,
readable by all, writable by none from the client).

- **`plants_catalog`** — `id`, `user_id` (null = seeded/shared plant), `name`,
  `species`, `sun_requirements`, `watering_frequency_days`,
  `flowering_start_month`, `flowering_end_month`, `notes`
- **`care_rules`** — `id`, `plant_id` (FK), `task_type` (enum: `seed_start` /
  `transplant` / `prune` / `fertilize` / `harvest`), `timing_type`
  (`offset_from_planting` / `recurring`), `offset_days`, `recurrence_days`,
  `notes`
- **`beds`** — `id`, `user_id`, `name`, `rows`, `cols`
- **`plantings`** — `id`, `user_id`, `bed_id` (FK), `cell_row`, `cell_col`,
  `plant_id` (FK), `planted_date`, `status` (`active` / `removed`)
- **`tasks`** — `id`, `user_id`, `planting_id` (FK, nullable for manually
  added tasks), `task_type`, `due_date`, `completed_at`,
  `google_calendar_event_id` (nullable)
- **`calendar_credentials`** — `user_id` (PK), `refresh_token`,
  `access_token`, `expires_at`. Captured once when the user opts into
  Calendar sync, since Supabase Auth surfaces the Google refresh token at
  that OAuth exchange but doesn't persist it for later background reuse.

## Task generation & Calendar sync mechanics

- A trigger on `plantings` insert reads the linked plant's `care_rules` and
  inserts matching `tasks` rows: offset rules produce one dated task;
  recurring rules produce a rolling **90-day window** of tasks.
- A scheduled `pg_cron` job tops up the rolling window for active plantings
  and stops generating once a `planting.status = 'removed'`.
- A DB webhook fires the Calendar Edge Function on `tasks`
  insert/update/delete, which creates/updates/deletes the matching Google
  Calendar event and stores the event ID back on the `tasks` row.
- If the stored refresh token is invalid/revoked, that sync call fails
  silently; the Settings page checks connection validity lazily (on visiting
  Settings, not polled) and shows a "Calendar disconnected — reconnect"
  banner if so.
- Manual tasks (no `planting_id`) sync through the same path.

## Screens

1. **Dashboard** — upcoming tasks (next 7 days), quick bed overview
2. **Garden Layout** — list of beds, each rendered as a grid; click a cell to
   assign/remove a planting
3. **Bed editor** — create/rename a bed, set grid dimensions
4. **Plant Catalog** — browse seeded + custom plants, search/filter; add a
   custom plant, or clone a seeded plant to customize its care rules
5. **Plant detail** — care info, flowering window, care-rule list (editable
   only on custom/cloned plants — seeded ones are read-only)
6. **Task Calendar/Agenda** — calendar view of all tasks, filter by type or
   bed, mark complete, add a manual task
7. **Settings** — account info, Connect/Disconnect Google Calendar sync
   (opt-in, separate from sign-in — sign-in only requests basic profile
   access; Calendar scope is requested only when the user clicks "Connect
   Calendar")

## Testing approach

- Angular services/components: unit tests via the Angular CLI's default test
  runner, focused on pure logic (grid cell assignment, task-list filtering,
  form validation) rather than Supabase calls.
- Postgres trigger/function logic (care-rule → task generation): exercised
  via SQL-level tests against a local Supabase instance rather than mocked
  client-side, since the logic lives in the DB.
- Calendar Edge Function: tested against a mocked Google Calendar API
  response; no live Calendar calls in automated tests.

## Suggested build order

Not separate specs — one cohesive app — but implementation should land in
this order since each stage depends on the last: (1) Supabase project +
Auth + schema scaffold, (2) Plant Catalog (seeded data + custom entries),
(3) Bed layout + plantings, (4) task auto-generation trigger, (5) Google
Calendar opt-in + sync.
