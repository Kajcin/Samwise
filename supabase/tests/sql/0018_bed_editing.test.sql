-- Run with: npm run db:psql -- -f supabase/tests/sql/0018_bed_editing.test.sql
-- Beds of any shape: adding and removing slots (the box stays tight, plantings move
-- with it), a planted slot taking its plant with it, deleting beds, and only your own.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Sage', 'full_sun');
-- A 2 × 2 bed with a plant in the bottom-right corner.
insert into beds (id, user_id, name, rows, cols) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Herbs', 2, 2),
  ('b0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Empty', 1, 1);
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001',
   1, 1, 'e0000000-0000-0000-0000-000000000001', current_date);

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

-- The bed as "rows x cols gaps", and where the plant is.
create function pg_temp.shape() returns text language sql as $$
  select rows || 'x' || cols || ' ' || coalesce((
           select string_agg(g::text, ' ' order by (g->>0)::int, (g->>1)::int) from jsonb_array_elements(gaps) g), '-')
    from beds where id = 'b0000000-0000-0000-0000-000000000001'
$$;
create function pg_temp.plant_at() returns text language sql as $$
  select cell_row || ',' || cell_col from plantings where id = 'c0000000-0000-0000-0000-000000000001'
$$;
create function pg_temp.expect(p_actual text, p_expected text, p_what text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: %: expected "%", got "%"', p_what, p_expected, p_actual;
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- 1. A slot above the top row: the box grows, everything moves down, the rest of the new row are gaps.
select add_bed_slot('b0000000-0000-0000-0000-000000000001', -1, 0);
select pg_temp.expect(pg_temp.shape(), '3x2 [0, 1]', 'after adding above');
select pg_temp.expect(pg_temp.plant_at(), '2,1', 'the plant moved down');

-- 2. A slot left of the box: everything moves right.
select add_bed_slot('b0000000-0000-0000-0000-000000000001', 2, -1);
select pg_temp.expect(pg_temp.shape(), '3x3 [0, 0] [0, 2] [1, 0]', 'after adding on the left');
select pg_temp.expect(pg_temp.plant_at(), '2,2', 'the plant moved right');

-- 3. Below and on the right: the box grows, nothing moves.
select add_bed_slot('b0000000-0000-0000-0000-000000000001', 3, 2);
select add_bed_slot('b0000000-0000-0000-0000-000000000001', 1, 3);
select pg_temp.expect(pg_temp.shape(), '4x4 [0, 0] [0, 2] [0, 3] [1, 0] [2, 3] [3, 0] [3, 1] [3, 3]', 'after adding below and right');
select pg_temp.expect(pg_temp.plant_at(), '2,2', 'the plant stayed');

-- 4. A gap inside becomes a slot again.
select add_bed_slot('b0000000-0000-0000-0000-000000000001', 1, 0);
select pg_temp.expect(pg_temp.shape(), '4x4 [0, 0] [0, 2] [0, 3] [2, 3] [3, 0] [3, 1] [3, 3]', 'after filling a gap');

-- 5. Refused: an existing slot, a corner or a far spot, a box beyond 20.
select pg_temp.expect_error($$select add_bed_slot('b0000000-0000-0000-0000-000000000001', 1, 1)$$, 'slot_exists');
select pg_temp.expect_error($$select add_bed_slot('b0000000-0000-0000-0000-000000000001', -1, -1)$$, 'slot_not_adjacent');
select pg_temp.expect_error($$select add_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 5)$$, 'slot_not_adjacent');
reset role;
update beds set rows = 20, gaps = '[]' where id = 'b0000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.expect_error($$select add_bed_slot('b0000000-0000-0000-0000-000000000002', 20, 0)$$, 'bed_too_large');
select add_bed_slot('b0000000-0000-0000-0000-000000000002', 0, 1); -- a new column is fine

-- 6. Removing slots: the box shrinks when an edge empties, moving everything up or left.
select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 3, 2); -- the only slot in the bottom row
select pg_temp.expect(pg_temp.shape(), '3x4 [0, 0] [0, 2] [0, 3] [2, 3]', 'after removing the bottom slot');
select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 1); -- the only slot in the top row
select pg_temp.expect(pg_temp.shape(), '2x4 [1, 3]', 'after removing the top slot');
select pg_temp.expect(pg_temp.plant_at(), '1,2', 'the plant moved up');

-- 7. A planted slot takes its plant with it (kept as history), and its unfinished tasks go.
reset role;
insert into tasks (user_id, planting_id, task_type, due_date) values
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', 'harvest', current_date + 5);
set local role authenticated;
select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 1, 2);
do $$
begin
  if (select status from plantings where id = 'c0000000-0000-0000-0000-000000000001') <> 'removed'
     or exists (select 1 from tasks where planting_id = 'c0000000-0000-0000-0000-000000000001' and completed_at is null) then
    raise exception 'TEST FAILED: the plant in a removed slot should be taken out, its tasks gone';
  end if;
end $$;

-- 8. Plants can't go into a gap.
select pg_temp.expect_error($$
  insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
    ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 1, 2,
     'e0000000-0000-0000-0000-000000000001', current_date)$$, 'not a slot');

-- 9. The last slot can't be removed.
select pg_temp.expect(pg_temp.shape(), '2x4 [1, 2] [1, 3]', 'before removing down to one');
select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 0);
select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 1);
select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 2);
select pg_temp.expect_error($$select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 0)$$, 'slot_not_found');
-- The top row empties: it goes, and so do the two right columns, all gaps once it has.
select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 3);
select pg_temp.expect(pg_temp.shape(), '1x2 -', 'after the top row emptied');
select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 0);
select pg_temp.expect(pg_temp.shape(), '1x1 -', 'one slot left');
select pg_temp.expect_error($$select remove_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 0)$$, 'slot_last');

-- 10. Another user can't touch the bed; a bed with a plant can't be deleted; an empty one can.
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
select pg_temp.expect_error($$select add_bed_slot('b0000000-0000-0000-0000-000000000001', 0, 1)$$, 'bed_not_found');
select pg_temp.expect_error($$select remove_bed_slot('b0000000-0000-0000-0000-000000000002', 0, 0)$$, 'bed_not_found');
select pg_temp.expect_error($$select delete_bed('b0000000-0000-0000-0000-000000000001')$$, 'bed_not_found');
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';
reset role;
insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000002', 0, 0,
   'e0000000-0000-0000-0000-000000000001', current_date);
set local role authenticated;
select pg_temp.expect_error($$select delete_bed('b0000000-0000-0000-0000-000000000002')$$, 'bed_not_empty');
select delete_bed('b0000000-0000-0000-0000-000000000001');
do $$
begin
  if exists (select 1 from beds where id = 'b0000000-0000-0000-0000-000000000001')
     or exists (select 1 from plantings where id = 'c0000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: the empty bed should be gone, with its past plantings';
  end if;
end $$;

-- 11. A name can't be blank; the helpers can't be called directly.
select pg_temp.expect_error($$update beds set name = '  ' where id = 'b0000000-0000-0000-0000-000000000002'$$, 'beds_name_not_blank');
select pg_temp.expect_error($$select trim_bed('b0000000-0000-0000-0000-000000000002')$$, 'permission denied');
reset role;
do $$
begin
  if has_function_privilege('anon', 'add_bed_slot(uuid, int, int)', 'execute')
     or has_function_privilege('anon', 'delete_bed(uuid)', 'execute') then
    raise exception 'TEST FAILED: anon should not be able to edit beds';
  end if;
end $$;

rollback;
