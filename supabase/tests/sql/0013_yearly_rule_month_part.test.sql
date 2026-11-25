-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0013_yearly_rule_month_part.test.sql
-- A yearly rule for early or late in its month gives tasks due for that half only.
-- Dates are relative to today, so this runs any day of the year.
begin;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements)
values ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Sage', 'full_sun');
insert into beds (id, user_id, name, rows, cols)
values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Bed', 1, 3);

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

-- 1. Only 'early' or 'late', and only on yearly rules.
select pg_temp.expect_error(
  $$insert into care_rules (plant_id, task_type, timing_type, month, month_part) values ('e0000000-0000-0000-0000-000000000001', 'prune', 'yearly', 5, 'mid')$$,
  'care_rules_month_part');
select pg_temp.expect_error(
  $$insert into care_rules (plant_id, task_type, timing_type, recurrence_days, month_part) values ('e0000000-0000-0000-0000-000000000001', 'prune', 'recurring', 7, 'early')$$,
  'month_part_only_yearly');

-- 2. Next month (so nothing of it has passed): early = 1st-15th, late = 16th-last, and
--    a rule without a part still covers the whole month.
create temp table next_month as
select extract(month from current_date + interval '1 month')::int as month,
       (date_trunc('month', current_date) + interval '1 month')::date as start;

insert into care_rules (plant_id, task_type, timing_type, month, month_part)
select 'e0000000-0000-0000-0000-000000000001'::uuid, 'prune', 'yearly', month, 'early' from next_month
union all
select 'e0000000-0000-0000-0000-000000000001'::uuid, 'mulch', 'yearly', month, 'late' from next_month
union all
select 'e0000000-0000-0000-0000-000000000001'::uuid, 'divide', 'yearly', month, null from next_month;

insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
values ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'b0000000-0000-0000-0000-000000000001', 0, 0, 'e0000000-0000-0000-0000-000000000001', current_date);

do $$
declare
  s date := (select start from next_month);
  got text;
begin
  select due_date || '..' || due_until into got from tasks
   where id in (select task_id from task_plantings where planting_id = 'c0000000-0000-0000-0000-000000000001') and task_type = 'prune' and due_date < s + 365;
  if got <> s || '..' || (s + 14) then raise exception 'TEST FAILED: early half: %', got; end if;

  select due_date || '..' || due_until into got from tasks
   where id in (select task_id from task_plantings where planting_id = 'c0000000-0000-0000-0000-000000000001') and task_type = 'mulch' and due_date < s + 365;
  if got <> (s + 15) || '..' || (s + interval '1 month' - interval '1 day')::date then
    raise exception 'TEST FAILED: late half: %', got;
  end if;

  select due_date || '..' || due_until into got from tasks
   where id in (select task_id from task_plantings where planting_id = 'c0000000-0000-0000-0000-000000000001') and task_type = 'divide' and due_date < s + 365;
  if got <> s || '..' || (s + interval '1 month' - interval '1 day')::date then
    raise exception 'TEST FAILED: whole month: %', got;
  end if;
end $$;

-- 3. Planted on the 20th of a rule's month: early that month is over, late still counts.
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
select 'c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
       'b0000000-0000-0000-0000-000000000001', 0, 1, 'e0000000-0000-0000-0000-000000000001', start + 19
from next_month;
do $$
declare
  s date := (select start from next_month);
begin
  if exists (select 1 from tasks where id in (select task_id from task_plantings where planting_id = 'c0000000-0000-0000-0000-000000000002')
                and task_type = 'prune' and due_date = s) then
    raise exception 'TEST FAILED: an early half that ended before planting got a task';
  end if;
  if not exists (select 1 from tasks where id in (select task_id from task_plantings where planting_id = 'c0000000-0000-0000-0000-000000000002')
                    and task_type = 'mulch' and due_date = s + 15) then
    raise exception 'TEST FAILED: the late half under way at planting is missing';
  end if;
end $$;

-- 4. The nightly top-up keeps the halves (and adds nothing twice).
delete from tasks where id in (select task_id from task_plantings where planting_id = 'c0000000-0000-0000-0000-000000000001') and task_type = 'mulch';
select top_up_recurring_tasks();
select top_up_recurring_tasks();
do $$
declare
  s date := (select start from next_month);
begin
  if (select count(*) from tasks where id in (select task_id from task_plantings where planting_id = 'c0000000-0000-0000-0000-000000000001')
         and task_type = 'mulch' and due_date = s + 15 and due_until = (s + interval '1 month' - interval '1 day')::date) <> 1 then
    raise exception 'TEST FAILED: the top-up didn''t restore the late-half task exactly once';
  end if;
end $$;

rollback;
