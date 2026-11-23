-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0010_plant_editing.test.sql
-- Users edit and delete only their own plants; a planted plant can't be deleted;
-- renaming a plant re-syncs its calendar events.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com');
insert into calendar_credentials (user_id, refresh_token, calendar_id)
values ('11111111-1111-1111-1111-111111111111', 'refresh-1', 'cal-1');

insert into plants_catalog (id, user_id, name, sun_requirements) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Chilli', 'full_sun'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Unused', 'full_sun');
insert into care_rules (plant_id, task_type, timing_type, offset_days) values
  ('e0000000-0000-0000-0000-000000000001', 'harvest', 'offset_from_planting', 30),
  ('e0000000-0000-0000-0000-000000000002', 'harvest', 'offset_from_planting', 30);
insert into beds (id, user_id, name, rows, cols)
values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Bed', 1, 2);
insert into plantings (user_id, bed_id, cell_row, cell_col, plant_id, planted_date) values
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000001', 0, 0,
   'e0000000-0000-0000-0000-000000000001', current_date);

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

-- 1. Field checks.
select pg_temp.expect_error(
  $$update plants_catalog set source_url = 'javascript:alert(1)' where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_source_url_http');
select pg_temp.expect_error(
  $$update plants_catalog set watering_frequency_days = 0 where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_watering_days');
select pg_temp.expect_error(
  $$update plants_catalog set flowering_start_month = 5 where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_flowering_range');
-- Allowed: a link, and flowering over the new year.
update plants_catalog
   set source_url = 'https://www.example.com/plants/chilli', flowering_start_month = 12, flowering_end_month = 3
 where id = 'e0000000-0000-0000-0000-000000000001';

-- 2. Another user can't edit or delete them (RLS hides the rows: nothing changes).
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
update plants_catalog set name = 'Hacked' where id = 'e0000000-0000-0000-0000-000000000002';
delete from plants_catalog where id = 'e0000000-0000-0000-0000-000000000002';
-- ...and nobody can edit a built-in plant.
update plants_catalog set name = 'Hacked' where id = 'a0000000-0000-0000-0000-000000000001';
reset role;
do $$
begin
  if (select name from plants_catalog where id = 'e0000000-0000-0000-0000-000000000002') <> 'Unused' then
    raise exception 'TEST FAILED: another user edited or deleted the plant';
  end if;
  if (select name from plants_catalog where id = 'a0000000-0000-0000-0000-000000000001') <> 'Tomato' then
    raise exception 'TEST FAILED: a built-in plant was edited';
  end if;
end $$;

-- 3. The owner deletes an unused plant, with its care rules...
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';
delete from plants_catalog where id = 'e0000000-0000-0000-0000-000000000002';
-- ...but not a planted one (the error code the app shows as "it's planted").
do $$
begin
  delete from plants_catalog where id = 'e0000000-0000-0000-0000-000000000001';
  raise exception 'TEST FAILED: a planted plant was deleted';
exception when foreign_key_violation then
  raise notice 'planted plant correctly kept';
end $$;
reset role;
do $$
begin
  if exists (select 1 from plants_catalog where id = 'e0000000-0000-0000-0000-000000000002')
     or exists (select 1 from care_rules where plant_id = 'e0000000-0000-0000-0000-000000000002') then
    raise exception 'TEST FAILED: the unused plant or its rules are still there';
  end if;
end $$;

-- 4. Renaming re-syncs the plant's upcoming events (and only renaming does).
delete from vault.secrets where name in ('calendar_sync_url', 'calendar_sync_webhook_secret');
select vault.create_secret('http://sync.test/functions/v1/calendar-sync', 'calendar_sync_url');
select vault.create_secret('test-webhook-secret', 'calendar_sync_webhook_secret');
create temp table baseline as select coalesce(max(id), 0) as id from net.http_request_queue;
create function pg_temp.resyncs() returns int language sql as $$
  select count(*)::int from net.http_request_queue
   where id > (select id from baseline) and convert_from(body, 'utf8')::jsonb ->> 'type' = 'RESYNC';
$$;

update plants_catalog set notes = 'Hot!' where id = 'e0000000-0000-0000-0000-000000000001';
do $$
begin
  if pg_temp.resyncs() <> 0 then raise exception 'TEST FAILED: editing notes re-synced events'; end if;
end $$;

update plants_catalog set name = 'Chilli pepper' where id = 'e0000000-0000-0000-0000-000000000001';
do $$
declare
  upcoming int := (
    select count(*) from tasks t join plantings p on p.id = t.planting_id
     where p.plant_id = 'e0000000-0000-0000-0000-000000000001' and t.due_date >= current_date
  );
begin
  if upcoming = 0 then raise exception 'TEST FAILED: the planting generated no tasks'; end if;
  if pg_temp.resyncs() <> upcoming then
    raise exception 'TEST FAILED: expected % re-syncs after renaming, got %', upcoming, pg_temp.resyncs();
  end if;
end $$;

rollback;
