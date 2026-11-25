-- Run with: npm run db:psql -- -f supabase/tests/sql/0022_seasonal_rules_year_ahead.test.sql
-- A repeating rule kept to months plans a year ahead; an all-year one still 90 days.
begin;

create function pg_temp.expect(p_actual text, p_expected text, p_what text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: %: expected "%", got "%"', p_what, p_expected, p_actual;
  end if;
end $$;

-- A season about 200 days away: past the 90 days, within the year.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements, harvest_months) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Chives', 'full_sun',
   array[extract(month from current_date + 200)::smallint]);
insert into care_rules (plant_id, task_type, timing_type, recurrence_days, season) values
  ('e0000000-0000-0000-0000-000000000001', 'harvest', 'recurring', 7, 'harvest');
insert into care_rules (plant_id, task_type, timing_type, recurrence_days) values
  ('e0000000-0000-0000-0000-000000000001', 'fertilize', 'recurring', 30);
insert into beds (id, user_id, name, rows, cols) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Herbs', 1, 1);
insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 0, 0,
   'e0000000-0000-0000-0000-000000000001', current_date);

select pg_temp.expect(
  (select string_agg(distinct extract(month from due_date)::text, ' ') from tasks
    where plant_id = 'e0000000-0000-0000-0000-000000000001' and task_type = 'harvest'),
  extract(month from current_date + 200)::text, 'the harvest season''s tasks, months ahead');
select pg_temp.expect(
  (select bool_and(due_date <= current_date + 90)::text from tasks
    where plant_id = 'e0000000-0000-0000-0000-000000000001' and task_type = 'fertilize'),
  'true', 'all-year repeating tasks still only 90 days ahead');

rollback;
