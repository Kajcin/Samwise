-- Run with: npm run db:psql -- -f supabase/tests/sql/0021_seasonal_repeating_rules.test.sql
-- Repeating rules within months: the dates (restarting each season), a rule following the
-- plant's harvest months, and what a rule may hold.
begin;

create function pg_temp.expect(p_actual text, p_expected text, p_what text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TEST FAILED: %: expected "%", got "%"', p_what, p_expected, p_actual;
  end if;
end $$;
create function pg_temp.dates(p_months smallint[], p_every int, p_from date, p_to date) returns text language sql as $$
  select string_agg(to_char(d, 'MM-DD'), ' ' order by d) from seasonal_repeat_dates(p_months, p_every, p_from, p_to) d
$$;

-- 1. The dates: from each season's 1st, every N days, within the months.
select pg_temp.expect(pg_temp.dates('{7,8}', 7, '2027-01-01', '2027-12-31'),
  '07-01 07-08 07-15 07-22 07-29 08-05 08-12 08-19 08-26', 'July and August, every 7 days');
select pg_temp.expect(pg_temp.dates('{4,5,9}', 10, '2027-01-01', '2027-12-31'),
  '04-01 04-11 04-21 05-01 05-11 05-21 05-31 09-01 09-11 09-21', 'two seasons, each from its 1st');
-- Over the new year: November to February is one season, from 1 November.
select pg_temp.expect(
  (select count(*)::text || ' ' || min(d)::text || ' ' || max(d)::text
     from seasonal_repeat_dates('{1,2,11,12}', 7, '2026-12-01', '2027-02-28') d),
  '13 2026-12-06 2027-02-28', 'a season over the new year');
select pg_temp.expect(pg_temp.dates('{1,2,3,4,5,6,7,8,9,10,11,12}', 100, '2027-01-01', '2027-12-31'),
  '01-01 04-11 07-20 10-28', 'all twelve months: one season from January');

-- 2. A rule following the plant's harvest months, and those months changing.
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements, harvest_months) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Chives', 'full_sun',
   array[extract(month from current_date + 30)::smallint]);
insert into care_rules (plant_id, task_type, timing_type, recurrence_days, season) values
  ('e0000000-0000-0000-0000-000000000001', 'harvest', 'recurring', 7, 'harvest');
insert into beds (id, user_id, name, rows, cols) values
  ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Herbs', 1, 1);
insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 0, 0,
   'e0000000-0000-0000-0000-000000000001', current_date);

-- The harvest tasks' months, and whether they all fall on days 1, 8, 15, 22 or 29.
create function pg_temp.harvest() returns text language sql as $$
  select coalesce(string_agg(distinct extract(month from due_date)::text, ' '), '-') || ' '
         || coalesce(bool_and(extract(day from due_date) in (1, 8, 15, 22, 29))::text, '-')
    from tasks where plant_id = 'e0000000-0000-0000-0000-000000000001' and task_type = 'harvest'
$$;
select pg_temp.expect(pg_temp.harvest(), extract(month from current_date + 30)::text || ' true', 'only in the harvest month');

update plants_catalog set harvest_months = array[extract(month from current_date + 60)::smallint]
 where id = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.expect(pg_temp.harvest(), extract(month from current_date + 60)::text || ' true', 'moved with the harvest months');

update plants_catalog set harvest_months = '{}' where id = 'e0000000-0000-0000-0000-000000000001';
select pg_temp.expect(pg_temp.harvest(), '- -', 'no harvest months, no tasks');

-- 3. Months belong to repeating rules only, and a rule has its own months or a season.
do $$
begin
  begin
    insert into care_rules (plant_id, task_type, timing_type, offset_days, months) values
      ('e0000000-0000-0000-0000-000000000001', 'harvest', 'offset_from_planting', 10, '{5}');
    raise exception 'TEST FAILED: months on a rule that doesn''t repeat';
  exception when check_violation then null;
  end;
  begin
    insert into care_rules (plant_id, task_type, timing_type, recurrence_days, months, season) values
      ('e0000000-0000-0000-0000-000000000001', 'harvest', 'recurring', 7, '{5}', 'harvest');
    raise exception 'TEST FAILED: both months and a season';
  exception when check_violation then null;
  end;
end $$;
insert into care_rules (id, plant_id, task_type, timing_type, recurrence_days, months) values
  ('f0000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-000000000001', 'fertilize', 'recurring', 14, '{9,5,5}');
select pg_temp.expect((select months::text from care_rules where id = 'f0000000-0000-0000-0000-000000000009'),
  '{5,9}', 'months stored in order without repeats');

rollback;
