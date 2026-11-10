-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0003_planting_integrity.test.sql
-- A planting must sit inside its bed, in a bed its owner owns, using a plant its owner can use.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');

-- Data owned by user B, created as superuser (bypasses RLS).
insert into beds (id, user_id, name, rows, cols) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'B bed', 3, 3);
insert into plants_catalog (id, user_id, name) values
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'B private plant');

-- Runs a statement that must fail with a message containing `expected`.
create function pg_temp.expect_error(stmt text, expected text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm not like '%' || expected || '%' then
      raise exception 'TEST FAILED: % -> wrong error: %', stmt, sqlerrm;
    end if;
    raise notice 'correctly rejected: %', sqlerrm;
    return;
  end;
  raise exception 'TEST FAILED: statement was accepted: %', stmt;
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

insert into beds (id, user_id, name, rows, cols) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'A bed', 2, 3);

-- Valid: built-in plant, corner cells of a 2x3 bed (cells are 0-based).
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
  ('aaaaaaaa-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 0, 0, 'a0000000-0000-0000-0000-000000000001', current_date),
  ('aaaaaaaa-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 2, 'a0000000-0000-0000-0000-000000000002', current_date);

select pg_temp.expect_error($sql$
  insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 2, 0, 'a0000000-0000-0000-0000-000000000001', current_date)
$sql$, 'outside the bed');

select pg_temp.expect_error($sql$
  insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 0, 3, 'a0000000-0000-0000-0000-000000000001', current_date)
$sql$, 'outside the bed');

select pg_temp.expect_error($sql$
  insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', -1, 0, 'a0000000-0000-0000-0000-000000000001', current_date)
$sql$, 'outside the bed');

select pg_temp.expect_error($sql$
  insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
    ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 0, 0, 'a0000000-0000-0000-0000-000000000001', current_date)
$sql$, 'bed not found');

select pg_temp.expect_error($sql$
  insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 0, 1, 'bbbbbbbb-0000-0000-0000-000000000002', current_date)
$sql$, 'plant not found');

select pg_temp.expect_error($sql$
  update plantings set cell_row = 5 where id = 'aaaaaaaa-0000-0000-0000-000000000010'
$sql$, 'outside the bed');

-- Status changes on an existing planting stay allowed.
update plantings set status = 'removed' where id = 'aaaaaaaa-0000-0000-0000-000000000010';

reset role;

-- The check also holds for the service role / superuser (Edge Functions, cron), which bypass RLS.
select pg_temp.expect_error($sql$
  insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
    ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 0, 0, 'a0000000-0000-0000-0000-000000000001', current_date)
$sql$, 'bed not found');

rollback;
