-- One task per plant, not per planting.
--
-- Until now each planting got its own tasks, so two lungworts meant every task twice
-- (and two calendar events). Now a generated task belongs to the plant (tasks.plant_id)
-- and lists the plantings it covers (task_plantings):
--
-- * One task per user, plant, task type and day (or month part): a unique index.
-- * Repeating rules ("every 21 days") count from the plant's earliest active planting, so
--   all its plantings share one schedule; a new planting joins it.
-- * Rules counted from the planting day (seed start, harvest after 75 days) and yearly
--   rules give each planting its own dates; plantings whose dates fall together share
--   the task.
-- * Taking a planting out detaches it from its unfinished tasks; a generated task left
--   without plantings goes. Its completed tasks stay with it as history.
--
-- sync_plant_tasks() works out a plant's tasks from its active plantings and brings the
-- tasks in line: on planting, on taking out, and every night (adding only).
-- Existing duplicates are merged below, keeping the unfinished copy.

-- --- The plant, and the plantings a task covers ----------------------------------------

alter table tasks add column plant_id uuid references plants_catalog(id) on delete cascade;
update tasks t set plant_id = p.plant_id from plantings p where p.id = t.planting_id;

create table task_plantings (
  task_id uuid not null references tasks(id) on delete cascade,
  planting_id uuid not null references plantings(id) on delete cascade,
  primary key (task_id, planting_id)
);
create index task_plantings_planting_id on task_plantings (planting_id);

-- Read through the task (your own); written only by the functions below.
alter table task_plantings enable row level security;
create policy task_plantings_select on task_plantings for select
  using (exists (select 1 from tasks t where t.id = task_id and t.user_id = auth.uid()));
revoke all on task_plantings from anon;
revoke insert, update, delete on task_plantings from authenticated;

insert into task_plantings (task_id, planting_id)
select id, planting_id from tasks where planting_id is not null;

-- --- Merge today's duplicates ------------------------------------------------------------
-- Same user, plant, type and day: the unfinished one stays (else the oldest id) and takes
-- over the others' plantings. Deleting the others removes their calendar events (0007).

create temp table task_merge on commit drop as
select id, first_value(id) over (
         partition by user_id, plant_id, task_type, due_date
         order by (completed_at is not null), id) as keeper
from tasks
where plant_id is not null;

insert into task_plantings (task_id, planting_id)
select m.keeper, tp.planting_id
from task_merge m join task_plantings tp on tp.task_id = m.id
where m.id <> m.keeper
on conflict do nothing;

delete from tasks where id in (select id from task_merge where id <> keeper);

create unique index tasks_one_per_plant_day on tasks (user_id, plant_id, task_type, due_date)
  where plant_id is not null;

-- --- Working out a plant's tasks -----------------------------------------------------------

-- Every task (from today on) the plant's rules give for the user's active plantings of it,
-- with the planting each one is for. Repeating rules count from the earliest planting.
create function desired_plant_tasks(p_user uuid, p_plant uuid)
returns table (task_type text, due_date date, due_until date, planting_id uuid)
language sql stable set search_path = public as $$
  with active as (
    select id, planted_date from plantings
     where user_id = p_user and plant_id = p_plant and status = 'active'
  ), first_planted as (
    select min(planted_date) as anchor_date from active
  )
  select r.task_type, d.due_date, d.due_until, a.id
  from active a
  cross join care_rules r
  cross join lateral care_rule_periods(
    r,
    case when r.timing_type = 'recurring' then (select anchor_date from first_planted) else a.planted_date end,
    current_date) d
  where r.plant_id = p_plant
$$;

-- Brings the plant's tasks in line: adds the missing tasks and links. With p_prune, also
-- unlinks plantings from unfinished current tasks they no longer get (a task left without
-- plantings goes, see below): after planting or taking out, when a shared schedule's start
-- may have moved. Completed tasks are history and stay as they are.
create function sync_plant_tasks(p_user uuid, p_plant uuid, p_prune boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into tasks (user_id, plant_id, task_type, due_date, due_until)
  select distinct p_user, p_plant, d.task_type, d.due_date, d.due_until
  from desired_plant_tasks(p_user, p_plant) d
  on conflict (user_id, plant_id, task_type, due_date) where plant_id is not null do nothing;

  insert into task_plantings (task_id, planting_id)
  select t.id, d.planting_id
  from desired_plant_tasks(p_user, p_plant) d
  join tasks t on t.user_id = p_user and t.plant_id = p_plant and t.task_type = d.task_type and t.due_date = d.due_date
  where t.completed_at is null
  on conflict do nothing;

  if p_prune then
    delete from task_plantings tp
     using tasks t
     where tp.task_id = t.id
       and t.user_id = p_user and t.plant_id = p_plant
       and t.completed_at is null
       and coalesce(t.due_until, t.due_date) >= current_date
       and not exists (
         select 1 from desired_plant_tasks(p_user, p_plant) d
          where d.task_type = t.task_type and d.due_date = t.due_date and d.planting_id = tp.planting_id);
  end if;
end $$;

revoke all on function desired_plant_tasks(uuid, uuid) from public, anon, authenticated;
revoke all on function sync_plant_tasks(uuid, uuid, boolean) from public, anon, authenticated;

-- A generated task whose last planting was unlinked or deleted goes too.
create function delete_task_without_plantings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from tasks t
   where t.id = old.task_id and t.plant_id is not null
     and not exists (select 1 from task_plantings where task_id = old.task_id);
  return null;
end $$;

create trigger task_plantings_after_delete_drop_empty_task
  after delete on task_plantings
  for each row execute function delete_task_without_plantings();

-- Planting: the plant's tasks now include it (as in 0004/0012, by the same trigger).
create or replace function generate_tasks_for_planting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' then
    perform sync_plant_tasks(new.user_id, new.plant_id, true);
  end if;
  return new;
end $$;

-- Taking out (as in 0004): unlink the planting from its unfinished tasks, then let the
-- plant's other plantings re-share their schedule.
create or replace function clear_tasks_for_removed_planting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from task_plantings tp
   using tasks t
   where tp.planting_id = new.id and tp.task_id = t.id and t.completed_at is null;
  perform sync_plant_tasks(new.user_id, new.plant_id, true);
  return new;
end $$;

-- Every night (as in 0005/0012, same name: the cron job calls it): the windows move on.
create or replace function top_up_recurring_tasks() returns void
language plpgsql set search_path = public as $$
declare
  pair record;
begin
  for pair in select distinct user_id, plant_id from plantings where status = 'active' loop
    perform sync_plant_tasks(pair.user_id, pair.plant_id, false);
  end loop;
end $$;

revoke execute on function top_up_recurring_tasks() from public, anon, authenticated;

-- --- Calendar: an event lists the task's places, so re-sync when they change -------------

-- A link added or removed changes the event's places and count. Not for a task created in
-- this same transaction: its own insert already syncs it, places included.
create function resync_calendar_on_task_plantings_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
  t_xmin xid;
begin
  select * into t from tasks where id = coalesce(new.task_id, old.task_id);
  if not found then return null; end if;
  select xmin into t_xmin from tasks where id = t.id;
  if t_xmin = pg_current_xact_id()::xid then return null; end if;
  if coalesce(t.due_until, t.due_date) < current_date then return null; end if;
  if not exists (
    select 1 from calendar_credentials where user_id = t.user_id and disconnected_reason is null
  ) then
    return null;
  end if;
  perform queue_calendar_sync(
    t.user_id,
    jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
  );
  return null;
end $$;

create trigger task_plantings_after_change_resync_calendar
  after insert or delete on task_plantings
  for each row execute function resync_calendar_on_task_plantings_change();

-- As in 0012: renaming one of your plants re-syncs its tasks' events.
create or replace function resync_calendar_on_plant_rename() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  if new.user_id is null then return null; end if;
  if new.name is not distinct from old.name and new.name_cs is not distinct from old.name_cs then
    return null;
  end if;
  if not exists (
    select 1 from calendar_credentials where user_id = new.user_id and disconnected_reason is null
  ) then
    return null;
  end if;
  for t in
    select * from tasks
     where plant_id = new.id and user_id = new.user_id and coalesce(due_until, due_date) >= current_date
  loop
    perform queue_calendar_sync(
      new.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
  return null;
end;
$$;

-- As in 0018: renaming a bed re-syncs the events of the tasks of the plants in it.
create or replace function resync_calendar_on_bed_rename() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  if new.name is not distinct from old.name then return null; end if;
  if not exists (
    select 1 from calendar_credentials where user_id = new.user_id and disconnected_reason is null
  ) then
    return null;
  end if;
  for t in
    select * from tasks
     where user_id = new.user_id and coalesce(due_until, due_date) >= current_date
       and id in (
         select tp.task_id from task_plantings tp join plantings p on p.id = tp.planting_id
          where p.bed_id = new.id and p.status = 'active')
  loop
    perform queue_calendar_sync(
      new.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
  return null;
end;
$$;

-- As in 0018: a planting moved within its bed re-syncs its tasks' events.
create or replace function resync_calendar_on_planting_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  if new.status <> 'active'
     or (new.cell_row = old.cell_row and new.cell_col = old.cell_col) then
    return null;
  end if;
  if not exists (
    select 1 from calendar_credentials where user_id = new.user_id and disconnected_reason is null
  ) then
    return null;
  end if;
  for t in
    select * from tasks
     where coalesce(due_until, due_date) >= current_date
       and id in (select task_id from task_plantings where planting_id = new.id)
  loop
    perform queue_calendar_sync(
      new.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
  return null;
end;
$$;

-- As in 0017: the completed tasks that go with a deleted plant.
create or replace function plant_deletion_check(p_plant_id uuid)
returns table (active_beds text[], completed_tasks int)
language sql stable security invoker set search_path = public as $$
  select
    coalesce((select array_agg(distinct b.name order by b.name)
                from plantings pl join beds b on b.id = pl.bed_id
               where pl.plant_id = p_plant_id and pl.status = 'active'), '{}'),
    (select count(*)::int from tasks where plant_id = p_plant_id and completed_at is not null)
$$;

-- --- The old link goes; then every plant's tasks are worked out afresh --------------------

alter table tasks drop column planting_id;

-- Joins plantings of the same plant into shared schedules (e.g. two fertilizing series
-- a few days apart become one), and adds anything missing.
do $$
declare
  pair record;
begin
  for pair in select distinct user_id, plant_id from plantings where status = 'active' loop
    perform sync_plant_tasks(pair.user_id, pair.plant_id, true);
  end loop;
end $$;

-- The merged tasks' events now list more places: re-sync the current ones of connected users.
do $$
declare
  t tasks;
begin
  for t in
    select tk.* from tasks tk
     where tk.plant_id is not null and coalesce(tk.due_until, tk.due_date) >= current_date
       and exists (select 1 from calendar_credentials c where c.user_id = tk.user_id and c.disconnected_reason is null)
  loop
    perform queue_calendar_sync(
      t.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
end $$;
