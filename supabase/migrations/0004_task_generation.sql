-- Care tasks generated from a planting's care rules.
--
-- * Offset rules give one task on planted_date + offset_days.
-- * Recurring rules give a task every recurrence_days after planted_date, generated
--   for a rolling window (today .. today + 90 days); a daily pg_cron job (next
--   migration) extends the window.
-- * Nothing is generated with a due date before today, so recording a planting
--   after the fact doesn't produce a backlog of overdue tasks. Recurring dates stay
--   anchored to planted_date.
-- * Removing a planting deletes its unfinished tasks; completed ones stay as history.
--
-- Dates use the database's current_date (UTC on Supabase).

-- Last day of the rolling window for recurring tasks.
create or replace function task_window_end() returns date
language sql stable
as $$ select current_date + 90 $$;

-- The due dates `p_rule` produces for a planting on `p_planted_date`, limited to
-- dates >= p_from, and (for recurring rules only) <= p_to. Pure: no table access.
create or replace function care_rule_due_dates(p_rule care_rules, p_planted_date date, p_from date, p_to date)
returns setof date
language sql immutable
as $$
  select p_planted_date + p_rule.offset_days
  where p_rule.timing_type = 'offset_from_planting'
    and p_planted_date + p_rule.offset_days >= p_from
  union all
  -- Occurrence k (k >= 1) falls on planted_date + k * recurrence_days.
  select p_planted_date + k * p_rule.recurrence_days
  from generate_series(
    greatest(1, ceil((p_from - p_planted_date)::numeric / p_rule.recurrence_days)::int),
    floor((p_to - p_planted_date)::numeric / p_rule.recurrence_days)::int
  ) as k
  where p_rule.timing_type = 'recurring'
$$;

create or replace function generate_tasks_for_planting() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;
  insert into tasks (user_id, planting_id, task_type, due_date)
  select new.user_id, new.id, r.task_type, due
  from care_rules r
  cross join lateral care_rule_due_dates(r, new.planted_date, current_date, task_window_end()) as due
  where r.plant_id = new.plant_id;
  return new;
end $$;

create trigger plantings_after_insert_generate_tasks
  after insert on plantings
  for each row execute function generate_tasks_for_planting();

create or replace function clear_tasks_for_removed_planting() returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from tasks where planting_id = new.id and completed_at is null;
  return new;
end $$;

create trigger plantings_after_remove_clear_tasks
  after update of status on plantings
  for each row
  when (old.status = 'active' and new.status = 'removed')
  execute function clear_tasks_for_removed_planting();
