-- Run with: npm run db:psql -- -f supabase/tests/sql/0017_delete_plant.test.sql
-- delete_plant() refuses a plant that's in a bed, deletes one that was only planted in the
-- past together with that history, and touches only your own plants.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'In the garden', 'full_sun'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Was planted', 'full_sun'),
  ('e0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Never planted', 'full_sun');
insert into beds (id, user_id, name, rows, cols) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Herbs', 2, 2),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Veg', 2, 2);
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000002', 0, 0,
   'e0000000-0000-0000-0000-000000000001', current_date),
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 0, 0,
   'e0000000-0000-0000-0000-000000000001', current_date),
  ('c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 1, 1,
   'e0000000-0000-0000-0000-000000000002', current_date - 30);
-- The second plant was taken out of its bed, after one task was done.
update plantings set status = 'removed' where id = 'c0000000-0000-0000-0000-000000000003';
insert into tasks (user_id, planting_id, task_type, due_date, completed_at) values
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003', 'harvest', current_date - 5, now());

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- 1. The check says where a plant is, and what history would go.
do $$
begin
  if (select active_beds from plant_deletion_check('e0000000-0000-0000-0000-000000000001')) <> array['Herbs', 'Veg'] then
    raise exception 'TEST FAILED: the check should list the beds the plant is in';
  end if;
  if (select (active_beds, completed_tasks) from plant_deletion_check('e0000000-0000-0000-0000-000000000002'))
     <> ('{}'::text[], 1) then
    raise exception 'TEST FAILED: a plant planted in the past is in no bed, with 1 completed task';
  end if;
end $$;

-- 2. A plant in a bed can't be deleted, and nothing changes.
select pg_temp.expect_error($$select delete_plant('e0000000-0000-0000-0000-000000000001')$$, 'plant_in_garden');
do $$
begin
  if not exists (select 1 from plants_catalog where id = 'e0000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: the plant in the garden was deleted';
  end if;
end $$;

-- 3. A plant planted only in the past goes, with its plantings and their tasks.
select delete_plant('e0000000-0000-0000-0000-000000000002');
select delete_plant('e0000000-0000-0000-0000-000000000003');
do $$
begin
  if exists (select 1 from plants_catalog where id in ('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003'))
     or exists (select 1 from plantings where id = 'c0000000-0000-0000-0000-000000000003')
     or exists (select 1 from tasks where planting_id = 'c0000000-0000-0000-0000-000000000003') then
    raise exception 'TEST FAILED: the plant and its history should be gone';
  end if;
end $$;

-- 4. Not someone else's plant, and not a built-in one.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
select pg_temp.expect_error($$select delete_plant('e0000000-0000-0000-0000-000000000001')$$, 'plant_not_found');
select pg_temp.expect_error($$select delete_plant('a0000000-0000-0000-0000-000000000001')$$, 'plant_not_found');
do $$
begin
  if (select active_beds from plant_deletion_check('e0000000-0000-0000-0000-000000000001')) <> '{}' then
    raise exception 'TEST FAILED: the check should not show another user''s beds';
  end if;
end $$;

-- 5. Not callable without signing in.
reset role;
do $$
begin
  if has_function_privilege('anon', 'delete_plant(uuid)', 'execute')
     or has_function_privilege('anon', 'plant_deletion_check(uuid)', 'execute') then
    raise exception 'TEST FAILED: anon should not be able to call the functions';
  end if;
end $$;

rollback;
