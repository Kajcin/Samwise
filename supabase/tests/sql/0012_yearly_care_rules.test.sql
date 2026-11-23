-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0012_yearly_care_rules.test.sql
-- Yearly rules give month-long tasks for the coming 12 months; the nightly top-up keeps
-- them coming; re-syncs include a month still under way.
-- Dates are relative to today, so this runs any day of the year.
begin;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements)
values ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Catmint', 'full_sun');
insert into beds (id, user_id, name, rows, cols)
values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Bed', 1, 3);

create temp table months as
select extract(month from current_date)::int as this_month,
       extract(month from current_date + interval '1 month')::int as next_month,
       date_trunc('month', current_date)::date as this_month_start;

-- Rules: cut back in this month, mulch next month, both every year.
insert into care_rules (plant_id, task_type, timing_type, month)
select 'e0000000-0000-0000-0000-000000000001'::uuid, 'cut_back', 'yearly', this_month from months
union all
select 'e0000000-0000-0000-0000-000000000001'::uuid, 'mulch', 'yearly', next_month from months;

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

-- 1. Checks.
select pg_temp.expect_error(
  $$insert into care_rules (plant_id, task_type, timing_type) values ('e0000000-0000-0000-0000-000000000001', 'divide', 'yearly')$$,
  'yearly_has_month');
select pg_temp.expect_error(
  $$insert into care_rules (plant_id, task_type, timing_type, month) values ('e0000000-0000-0000-0000-000000000001', 'divide', 'yearly', 13)$$,
  'care_rules_month_range');
select pg_temp.expect_error(
  $$insert into tasks (user_id, task_type, due_date, due_until) values ('11111111-1111-1111-1111-111111111111', 'divide', '2027-07-31', '2027-07-01')$$,
  'tasks_due_period');
insert into tasks (user_id, task_type, due_date)
select '11111111-1111-1111-1111-111111111111', t, current_date
from unnest(array['divide', 'mulch', 'winter_protection', 'cut_back']) as t;

-- 2. Planting today: this month (still under way) and the same month next year for the
--    cut-back; next month for the mulch. Each due for the whole month.
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
values ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'b0000000-0000-0000-0000-000000000001', 0, 0, 'e0000000-0000-0000-0000-000000000001', current_date);

create function pg_temp.periods(p_planting uuid, p_type text) returns text language sql as $$
  select coalesce(string_agg(due_date || '..' || due_until, ', ' order by due_date), '')
    from tasks where planting_id = p_planting and task_type = p_type;
$$;

do $$
declare
  m date := (select this_month_start from months);
  expected_cut text := m || '..' || (m + interval '1 month' - interval '1 day')::date || ', '
    || (m + interval '1 year')::date || '..' || (m + interval '1 year' + interval '1 month' - interval '1 day')::date;
  n date := (m + interval '1 month')::date;
  expected_mulch text := n || '..' || (n + interval '1 month' - interval '1 day')::date;
begin
  if pg_temp.periods('c0000000-0000-0000-0000-000000000001', 'cut_back') <> expected_cut then
    raise exception 'TEST FAILED: cut-back periods: expected %, got %',
      expected_cut, pg_temp.periods('c0000000-0000-0000-0000-000000000001', 'cut_back');
  end if;
  if pg_temp.periods('c0000000-0000-0000-0000-000000000001', 'mulch') <> expected_mulch then
    raise exception 'TEST FAILED: mulch periods: expected %, got %',
      expected_mulch, pg_temp.periods('c0000000-0000-0000-0000-000000000001', 'mulch');
  end if;
end $$;

-- 3. Planted later than this month ends (e.g. pre-planned): this month's cut-back is skipped.
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
select 'c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
       'b0000000-0000-0000-0000-000000000001', 0, 1, 'e0000000-0000-0000-0000-000000000001',
       (this_month_start + interval '1 month' + interval '5 days')::date
from months;
do $$
begin
  if exists (
    select 1 from tasks where planting_id = 'c0000000-0000-0000-0000-000000000002' and task_type = 'cut_back'
       and due_date = (select this_month_start from months)
  ) then
    raise exception 'TEST FAILED: a month that ended before planting got a task';
  end if;
  if not exists (
    select 1 from tasks where planting_id = 'c0000000-0000-0000-0000-000000000002' and task_type = 'cut_back'
       and due_date = (select (this_month_start + interval '1 year')::date from months)
  ) then
    raise exception 'TEST FAILED: next year''s cut-back is missing';
  end if;
end $$;

-- 4. The nightly top-up brings back a missing yearly task, keeps done ones, adds nothing twice.
delete from tasks where planting_id = 'c0000000-0000-0000-0000-000000000001' and task_type = 'mulch';
update tasks set completed_at = now()
 where planting_id = 'c0000000-0000-0000-0000-000000000001' and task_type = 'cut_back'
   and due_date = (select this_month_start from months);
select top_up_recurring_tasks();
select top_up_recurring_tasks();
do $$
begin
  if (select count(*) from tasks where planting_id = 'c0000000-0000-0000-0000-000000000001' and task_type = 'mulch') <> 1 then
    raise exception 'TEST FAILED: the top-up should restore exactly one mulch task';
  end if;
  if (select count(*) from tasks where planting_id = 'c0000000-0000-0000-0000-000000000001' and task_type = 'cut_back') <> 2 then
    raise exception 'TEST FAILED: the top-up duplicated or dropped a cut-back task';
  end if;
  if (select due_until from tasks where planting_id = 'c0000000-0000-0000-0000-000000000001' and task_type = 'mulch')
     is null then
    raise exception 'TEST FAILED: a topped-up yearly task lost its period';
  end if;
end $$;

-- 5. A language change re-syncs a month-long task that started before today but is still due.
insert into calendar_credentials (user_id, refresh_token, calendar_id)
values ('11111111-1111-1111-1111-111111111111', 'refresh-1', 'cal-1');
delete from vault.secrets where name in ('calendar_sync_url', 'calendar_sync_webhook_secret');
select vault.create_secret('http://sync.test/functions/v1/calendar-sync', 'calendar_sync_url');
select vault.create_secret('test-webhook-secret', 'calendar_sync_webhook_secret');
insert into tasks (id, user_id, task_type, due_date, due_until) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'mulch', current_date - 5, current_date + 5),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'mulch', current_date - 20, current_date - 1);
create temp table baseline as select coalesce(max(id), 0) as id from net.http_request_queue;
insert into user_preferences (user_id, language) values ('11111111-1111-1111-1111-111111111111', 'cs');
do $$
declare
  resynced text[] := (
    select array_agg(convert_from(body, 'utf8')::jsonb -> 'record' ->> 'id')
      from net.http_request_queue where id > (select id from baseline)
  );
begin
  if not ('d0000000-0000-0000-0000-000000000001' = any (resynced)) then
    raise exception 'TEST FAILED: a month still under way wasn''t re-synced';
  end if;
  if 'd0000000-0000-0000-0000-000000000002' = any (resynced) then
    raise exception 'TEST FAILED: a period that already ended was re-synced';
  end if;
end $$;

rollback;
