-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0004_task_generation.test.sql
-- Planting a plant generates its care tasks; removing it clears the unfinished ones.
-- Seeded rules used here:
--   Tomato (…001): seed_start +0, transplant +21, fertilize every 14, harvest +75
--   Pepper (…005): seed_start +0, transplant +28, fertilize every 21, harvest +80
begin;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@example.com');
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

insert into beds (id, user_id, name, rows, cols)
values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Test Bed', 2, 2);

-- Asserts the due dates of one planting's tasks of one type.
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

-- 1. Planted today: every offset task, and recurring tasks for the next 90 days.
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
values ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'b0000000-0000-0000-0000-000000000001', 0, 0, 'a0000000-0000-0000-0000-000000000001', current_date);

select pg_temp.expect_due('c0000000-0000-0000-0000-000000000001', 'seed_start', array[current_date]);
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000001', 'transplant', array[current_date + 21]);
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000001', 'harvest', array[current_date + 75]);
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000001', 'fertilize',
  array[current_date + 14, current_date + 28, current_date + 42, current_date + 56, current_date + 70, current_date + 84]);

do $$
begin
  if exists (select 1 from tasks where planting_id = 'c0000000-0000-0000-0000-000000000001'
             and (user_id <> '11111111-1111-1111-1111-111111111111' or completed_at is not null)) then
    raise exception 'TEST FAILED: generated tasks must belong to the planting owner and start incomplete';
  end if;
end $$;

-- 2. Recorded 30 days after planting: nothing dated in the past, and the fertilize
--    schedule stays anchored to the planting date (day 42 of the plant = today + 12).
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
values ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'b0000000-0000-0000-0000-000000000001', 0, 1, 'a0000000-0000-0000-0000-000000000001', current_date - 30);

select pg_temp.expect_due('c0000000-0000-0000-0000-000000000002', 'seed_start', '{}');
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000002', 'transplant', '{}');
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000002', 'harvest', array[current_date + 45]);
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000002', 'fertilize',
  array[current_date + 12, current_date + 26, current_date + 40, current_date + 54, current_date + 68, current_date + 82]);

-- 3. Planned 30 days ahead: one-off tasks are not limited by the 90-day window
--    (harvest lands on day 110), recurring ones are.
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
values ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
        'b0000000-0000-0000-0000-000000000001', 1, 0, 'a0000000-0000-0000-0000-000000000005', current_date + 30);

select pg_temp.expect_due('c0000000-0000-0000-0000-000000000003', 'seed_start', array[current_date + 30]);
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000003', 'harvest', array[current_date + 110]);
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000003', 'fertilize',
  array[current_date + 51, current_date + 72]);

-- 4. Removing a planting deletes its unfinished tasks and keeps completed ones as history.
update tasks set completed_at = now()
  where planting_id = 'c0000000-0000-0000-0000-000000000001' and task_type = 'seed_start';
update plantings set status = 'removed' where id = 'c0000000-0000-0000-0000-000000000001';

do $$
declare
  remaining text[];
begin
  select array_agg(task_type) into remaining from tasks where planting_id = 'c0000000-0000-0000-0000-000000000001';
  if remaining is distinct from array['seed_start'] then
    raise exception 'TEST FAILED: after removal expected only the completed seed_start task, got %', remaining;
  end if;
end $$;

-- The other plantings are untouched.
select pg_temp.expect_due('c0000000-0000-0000-0000-000000000002', 'harvest', array[current_date + 45]);

rollback;
