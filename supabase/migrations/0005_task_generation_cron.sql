-- Daily top-up of the rolling window of recurring care tasks (see 0004).
--
-- For every active planting and recurring rule, adds the due dates in
-- [today, task_window_end()] that don't have a task of that type yet. Being
-- "fill the gaps" rather than "continue from the latest task", it is idempotent,
-- catches up after missed runs, copes with two recurring rules of the same task
-- type, and also picks up recurring rules added to a custom plant after planting.
-- Tasks can't be deleted in the app, so this never resurrects a deleted task.

create extension if not exists pg_cron;

create or replace function top_up_recurring_tasks() returns void
language sql
set search_path = public
as $$
  insert into tasks (user_id, planting_id, task_type, due_date)
  select distinct p.user_id, p.id, r.task_type, due
  from plantings p
  join care_rules r on r.plant_id = p.plant_id and r.timing_type = 'recurring'
  cross join lateral care_rule_due_dates(r, p.planted_date, current_date, task_window_end()) as due
  where p.status = 'active'
    and not exists (
      select 1 from tasks t
      where t.planting_id = p.id and t.task_type = r.task_type and t.due_date = due
    );
$$;

-- Only pg_cron (running as the database owner) should call this; Postgres grants
-- EXECUTE to PUBLIC by default, which would expose it as an API RPC.
revoke execute on function top_up_recurring_tasks() from public, anon, authenticated;

-- 03:00 UTC daily. cron.schedule() replaces an existing job with the same name.
select cron.schedule('top-up-recurring-tasks', '0 3 * * *', $$select public.top_up_recurring_tasks()$$);
