-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0005_cron_topup.test.sql
-- The daily top-up extends the 90-day window of recurring tasks for active plantings,
-- idempotently. Tomato (…001): fertilize every 14 days.
begin;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@example.com');

create function pg_temp.expect_due(p_planting uuid, p_type text, p_expected date[]) returns void language plpgsql as $$
declare
  actual date[];
begin
  select coalesce(array_agg(due_date order by due_date), '{}') into actual
    from tasks where planting_id = p_planting and task_type = p_type;
  if actual is distinct from p_expected then
    raise exception 'TEST FAILED: % tasks for planting %: expected %, got %', p_type, p_planting, p_expected, actual;
  end if;
end $$;

-- The job is registered with pg_cron.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'top-up-recurring-tasks' and command like '%top_up_recurring_tasks()%') then
    raise exception 'TEST FAILED: cron job top-up-recurring-tasks is not scheduled';
  end if;
end $$;

-- Clients can't trigger the job through the API.
do $$
begin
  if has_function_privilege('authenticated', 'top_up_recurring_tasks()', 'execute')
     or has_function_privilege('anon', 'top_up_recurring_tasks()', 'execute') then
    raise exception 'TEST FAILED: top_up_recurring_tasks() is executable by API roles';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

insert into beds (id, user_id, name, rows, cols)
values ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Test Bed 2', 2, 2);

-- A: planted 100 days ago, so fertilize falls on plant-days 112, 126, …
--    = today + 12, 26, 40, 54, 68, 82 within the window.
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
values ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'b0000000-0000-0000-0000-000000000002', 0, 0, 'a0000000-0000-0000-0000-000000000001', current_date - 100);
-- Simulate a window generated a while ago that only reaches today + 30, with its first task done.
delete from tasks where planting_id = 'c0000000-0000-0000-0000-000000000002' and due_date > current_date + 30;
update tasks set completed_at = now()
  where planting_id = 'c0000000-0000-0000-0000-000000000002' and due_date = current_date + 12;
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000002', 'fertilize', array[current_date + 12, current_date + 26]);

-- B: a custom plant whose recurring rule is added after it was planted.
insert into plants_catalog (id, user_id, name)
values ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'My Chili');
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
values ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
        'b0000000-0000-0000-0000-000000000002', 0, 1, 'd0000000-0000-0000-0000-000000000001', current_date);
insert into care_rules (plant_id, task_type, timing_type, recurrence_days)
values ('d0000000-0000-0000-0000-000000000001', 'prune', 'recurring', 30);

-- C: a removed planting (its unfinished tasks were cleared on removal).
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
values ('c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
        'b0000000-0000-0000-0000-000000000002', 1, 0, 'a0000000-0000-0000-0000-000000000001', current_date);
update plantings set status = 'removed' where id = 'c0000000-0000-0000-0000-000000000004';

-- pg_cron runs the job as the database owner.
reset role;
select top_up_recurring_tasks();

-- A: window refilled to today + 90, the completed task kept and not duplicated.
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000002', 'fertilize',
  array[current_date + 12, current_date + 26, current_date + 40, current_date + 54, current_date + 68, current_date + 82]);
do $$
begin
  if not exists (select 1 from tasks where planting_id = 'c0000000-0000-0000-0000-000000000002'
                 and due_date = current_date + 12 and completed_at is not null) then
    raise exception 'TEST FAILED: the completed task lost its completion';
  end if;
  if exists (select 1 from tasks where planting_id = 'c0000000-0000-0000-0000-000000000002'
             and user_id <> '11111111-1111-1111-1111-111111111111') then
    raise exception 'TEST FAILED: topped-up tasks must belong to the planting owner';
  end if;
end $$;
-- One-off tasks are not the top-up's business (harvest was today + 0 - 100 + 75 = past, so none).
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000002', 'harvest', '{}');

-- B: the newly added recurring rule is picked up.
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000003', 'prune',
  array[current_date + 30, current_date + 60, current_date + 90]);

-- C: nothing for removed plantings.
do $$
begin
  if exists (select 1 from tasks where planting_id = 'c0000000-0000-0000-0000-000000000004' and completed_at is null) then
    raise exception 'TEST FAILED: top-up generated tasks for a removed planting';
  end if;
end $$;

-- Running it again changes nothing.
do $$
declare
  before_count int;
  after_count int;
begin
  select count(*) into before_count from tasks;
  perform top_up_recurring_tasks();
  select count(*) into after_count from tasks;
  if after_count <> before_count then
    raise exception 'TEST FAILED: second run added % tasks', after_count - before_count;
  end if;
end $$;

rollback;
