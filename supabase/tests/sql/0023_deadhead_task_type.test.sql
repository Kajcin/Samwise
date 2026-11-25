-- Run with: npm run db:psql -- -f supabase/tests/sql/0023_deadhead_task_type.test.sql
-- The deadhead task type, and the marigold's deadheading as such a rule in its flowering months.
begin;

create function pg_temp.expect(p_actual text, p_expected text, p_what text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: %: expected "%", got "%"', p_what, p_expected, p_actual;
  end if;
end $$;

-- 1. The marigold's rule.
select pg_temp.expect(
  (select string_agg(task_type || ' ' || coalesce(season, '-'), ', ' order by task_type) from care_rules
    where plant_id = 'a0000000-0000-0000-0000-000000000006'),
  'deadhead flowering, seed_start -', 'the marigold deadheads while it flowers, and prunes no more');

-- 2. Growing it gives deadhead tasks, only in its flowering months (June to October).
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into beds (id, user_id, name, rows, cols) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Flowers', 1, 1);
insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 0, 0,
   'a0000000-0000-0000-0000-000000000006', current_date);
select pg_temp.expect(
  (select (count(*) > 0 and bool_and(extract(month from due_date) between 6 and 10))::text from tasks
    where plant_id = 'a0000000-0000-0000-0000-000000000006' and task_type = 'deadhead'),
  'true', 'deadhead tasks in the flowering months');

-- 3. Your own plants can have deadhead rules too.
insert into plants_catalog (id, user_id, name, sun_requirements) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Rose', 'full_sun');
insert into care_rules (plant_id, task_type, timing_type, recurrence_days) values
  ('e0000000-0000-0000-0000-000000000001', 'deadhead', 'recurring', 10);

rollback;
