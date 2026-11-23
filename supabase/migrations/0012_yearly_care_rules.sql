-- Yearly care rules for perennials: "every year in July" ("každý rok v červenci").
-- Such a rule creates a task due during the whole month (tasks.due_until = the month's
-- last day), 12 months ahead, and repeats every year. Also four task types perennials
-- need: divide, mulch, winter protection, cut back.

-- --- Task types ----------------------------------------------------------------------

alter table care_rules drop constraint care_rules_task_type_check;
alter table care_rules add constraint care_rules_task_type_check check (task_type in (
  'seed_start', 'transplant', 'prune', 'fertilize', 'harvest',
  'divide', 'mulch', 'winter_protection', 'cut_back'
));
alter table tasks drop constraint tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check check (task_type in (
  'seed_start', 'transplant', 'prune', 'fertilize', 'harvest',
  'divide', 'mulch', 'winter_protection', 'cut_back'
));

-- --- Yearly rules ----------------------------------------------------------------------

alter table care_rules drop constraint care_rules_timing_type_check;
alter table care_rules add constraint care_rules_timing_type_check
  check (timing_type in ('offset_from_planting', 'recurring', 'yearly'));
alter table care_rules
  add column month int constraint care_rules_month_range check (month between 1 and 12),
  add constraint yearly_has_month check (timing_type <> 'yearly' or month is not null);

-- A task with due_until is due during a period (a yearly rule's month): from due_date
-- (the 1st) to due_until (the last day), and overdue only after due_until.
alter table tasks
  add column due_until date,
  add constraint tasks_due_period check (due_until is null or due_until >= due_date);

-- Yearly tasks are created further ahead than the others (90 days): the whole coming year.
create or replace function yearly_window_end() returns date
language sql stable
as $$ select current_date + 365 $$;

-- The months (as their 1st day) a yearly rule falls in between p_from and p_to, skipping
-- any month that ends before p_from or before the planting date. A month already under
-- way counts: planting catmint on 10 July still gives "cut back in July" this year.
create or replace function yearly_rule_months(p_rule care_rules, p_planted_date date, p_from date, p_to date)
returns setof date
language sql immutable
as $$
  select m
  from generate_series(extract(year from p_from)::int, extract(year from p_to)::int) as y,
       lateral (select make_date(y, p_rule.month, 1) as m) months
  where p_rule.timing_type = 'yearly'
    and m <= p_to
    and (m + interval '1 month' - interval '1 day')::date >= greatest(p_from, p_planted_date)
  order by m
$$;

-- Every task a rule gives from p_from on: single days for offset and recurring rules
-- (up to task_window_end(), 90 days), whole months for yearly rules (up to a year ahead).
create or replace function care_rule_periods(p_rule care_rules, p_planted_date date, p_from date)
returns table (due_date date, due_until date)
language sql stable
as $$
  select due, null::date
  from care_rule_due_dates(p_rule, p_planted_date, p_from, task_window_end()) as due
  where p_rule.timing_type <> 'yearly'
  union all
  select m, (m + interval '1 month' - interval '1 day')::date
  from yearly_rule_months(p_rule, p_planted_date, p_from, yearly_window_end()) as m
$$;

-- As in 0004, for every rule type.
create or replace function generate_tasks_for_planting() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;
  insert into tasks (user_id, planting_id, task_type, due_date, due_until)
  select new.user_id, new.id, r.task_type, p.due_date, p.due_until
  from care_rules r
  cross join lateral care_rule_periods(r, new.planted_date, current_date) as p
  where r.plant_id = new.plant_id;
  return new;
end $$;

-- As in 0005 (same name: the nightly cron job calls it), now also for yearly rules:
-- each night the windows move on, so new days and months come into reach.
create or replace function top_up_recurring_tasks() returns void
language sql
set search_path = public
as $$
  insert into tasks (user_id, planting_id, task_type, due_date, due_until)
  select distinct p.user_id, p.id, r.task_type, d.due_date, d.due_until
  from plantings p
  join care_rules r on r.plant_id = p.plant_id and r.timing_type in ('recurring', 'yearly')
  cross join lateral care_rule_periods(r, p.planted_date, current_date) as d
  where p.status = 'active'
    and not exists (
      select 1 from tasks t
      where t.planting_id = p.id and t.task_type = r.task_type and t.due_date = d.due_date
    );
$$;

revoke execute on function top_up_recurring_tasks() from public, anon, authenticated;

-- --- Calendar re-syncs: a month-long task is current until its month ends ---------------

-- As in 0009.
create or replace function resync_calendar_on_language_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  if tg_op = 'UPDATE' and new.language = old.language then return null; end if;
  if tg_op = 'INSERT' and new.language = 'en' then return null; end if;
  if not exists (
    select 1 from calendar_credentials where user_id = new.user_id and disconnected_reason is null
  ) then
    return null;
  end if;

  for t in
    select * from tasks where user_id = new.user_id and coalesce(due_until, due_date) >= current_date
  loop
    perform queue_calendar_sync(
      new.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
  return null;
end;
$$;

-- As in 0010.
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
    select tk.* from tasks tk join plantings p on p.id = tk.planting_id
     where p.plant_id = new.id and tk.user_id = new.user_id
       and coalesce(tk.due_until, tk.due_date) >= current_date
  loop
    perform queue_calendar_sync(
      new.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
  return null;
end;
$$;
