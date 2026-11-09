create extension if not exists pgcrypto;

create table plants_catalog (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  name text not null,
  species text,
  sun_requirements text check (sun_requirements in ('full_sun','partial_shade','full_shade')),
  watering_frequency_days int,
  flowering_start_month int check (flowering_start_month between 1 and 12),
  flowering_end_month int check (flowering_end_month between 1 and 12),
  notes text
);

create table care_rules (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references plants_catalog(id) on delete cascade,
  task_type text not null check (task_type in ('seed_start','transplant','prune','fertilize','harvest')),
  timing_type text not null check (timing_type in ('offset_from_planting','recurring')),
  offset_days int,
  recurrence_days int,
  notes text,
  constraint offset_has_days check (timing_type <> 'offset_from_planting' or offset_days is not null),
  constraint recurring_has_days check (timing_type <> 'recurring' or recurrence_days is not null)
);

create table beds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  rows int not null check (rows > 0),
  cols int not null check (cols > 0)
);

create table plantings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  bed_id uuid not null references beds(id) on delete cascade,
  cell_row int not null,
  cell_col int not null,
  plant_id uuid not null references plants_catalog(id),
  planted_date date not null,
  status text not null default 'active' check (status in ('active','removed'))
);

create unique index plantings_one_active_per_cell
  on plantings (bed_id, cell_row, cell_col)
  where status = 'active';

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  planting_id uuid references plantings(id) on delete cascade,
  task_type text not null check (task_type in ('seed_start','transplant','prune','fertilize','harvest')),
  due_date date not null,
  completed_at timestamptz,
  google_calendar_event_id text
);

create table calendar_credentials (
  user_id uuid primary key references auth.users(id),
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  calendar_id text not null
);

alter table plants_catalog enable row level security;
alter table care_rules enable row level security;
alter table beds enable row level security;
alter table plantings enable row level security;
alter table tasks enable row level security;
alter table calendar_credentials enable row level security;

create policy plants_catalog_select on plants_catalog
  for select using (user_id is null or user_id = auth.uid());
create policy plants_catalog_write on plants_catalog
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy care_rules_select on care_rules
  for select using (
    exists (select 1 from plants_catalog p where p.id = plant_id and (p.user_id is null or p.user_id = auth.uid()))
  );
create policy care_rules_write on care_rules
  for all using (
    exists (select 1 from plants_catalog p where p.id = plant_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from plants_catalog p where p.id = plant_id and p.user_id = auth.uid())
  );

create policy beds_all on beds
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy plantings_all on plantings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tasks_all on tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- calendar_credentials holds the Google refresh token: no client access at all.
-- RLS is enabled with no policies (deny-all), and table grants are revoked as a
-- second layer. Edge Functions use the service role, which bypasses RLS.
revoke all on calendar_credentials from anon, authenticated;
