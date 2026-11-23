-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0009_languages.test.sql
-- Each user's language is private to them; built-in plants have Czech texts; changing
-- the language re-syncs the calendar events of a connected user.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'connected@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'connected-too@example.com');
insert into calendar_credentials (user_id, refresh_token, calendar_id) values
  ('11111111-1111-1111-1111-111111111111', 'refresh-1', 'cal-1'),
  ('33333333-3333-3333-3333-333333333333', 'refresh-3', 'cal-3');

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

-- 1. Built-in plants have Czech names and notes; every built-in rule note has a Czech one.
do $$
begin
  if exists (select 1 from plants_catalog where user_id is null and (name_cs is null or notes_cs is null)) then
    raise exception 'TEST FAILED: a built-in plant lacks Czech texts';
  end if;
  if (select name_cs from plants_catalog where id = 'a0000000-0000-0000-0000-000000000001') <> 'Rajče' then
    raise exception 'TEST FAILED: tomato should be Rajče';
  end if;
  if exists (
    select 1 from care_rules r join plants_catalog p on p.id = r.plant_id
    where p.user_id is null and (r.notes is null) <> (r.notes_cs is null)
  ) then
    raise exception 'TEST FAILED: built-in rule notes and Czech notes don''t match up';
  end if;
end $$;

-- 2. Only English and Czech.
select pg_temp.expect_error(
  $$insert into user_preferences (user_id, language) values ('22222222-2222-2222-2222-222222222222', 'de')$$,
  'user_preferences_language_check');

-- 3. Users read and write only their own language (the app does this on first sign-in).
set local role authenticated;
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
insert into user_preferences (user_id) values ('22222222-2222-2222-2222-222222222222');
select pg_temp.expect_error(
  $$insert into user_preferences (user_id, language) values ('11111111-1111-1111-1111-111111111111', 'cs')$$,
  'row-level security');
do $$
begin
  if (select language from user_preferences) <> 'en' then
    raise exception 'TEST FAILED: the default language should be English';
  end if;
end $$;
reset role;
insert into user_preferences (user_id, language) values ('11111111-1111-1111-1111-111111111111', 'en');
set local role authenticated;
do $$
begin
  if (select count(*) from user_preferences) <> 1 then
    raise exception 'TEST FAILED: a user can see another user''s language';
  end if;
end $$;
update user_preferences set language = 'cs' where user_id = '11111111-1111-1111-1111-111111111111';
reset role;
do $$
begin
  if (select language from user_preferences where user_id = '11111111-1111-1111-1111-111111111111') <> 'en' then
    raise exception 'TEST FAILED: a user changed another user''s language';
  end if;
  if has_table_privilege('anon', 'user_preferences', 'select') then
    raise exception 'TEST FAILED: anon can read user_preferences';
  end if;
  if has_function_privilege('authenticated', 'queue_calendar_sync(uuid, jsonb)', 'execute') then
    raise exception 'TEST FAILED: clients can call queue_calendar_sync()';
  end if;
end $$;

-- 4. A language change re-syncs the connected user's tasks due today or later.
delete from vault.secrets where name in ('calendar_sync_url', 'calendar_sync_webhook_secret');
select vault.create_secret('http://sync.test/functions/v1/calendar-sync', 'calendar_sync_url');
select vault.create_secret('test-webhook-secret', 'calendar_sync_webhook_secret');

insert into tasks (id, user_id, task_type, due_date, completed_at) values
  ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'prune', current_date, null),
  ('d0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'harvest', current_date + 5, now()),
  ('d0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'prune', current_date - 1, null),
  ('d0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'prune', current_date + 1, null),
  ('d0000000-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'prune', current_date + 1, null);

create temp table baseline as select coalesce(max(id), 0) as id from net.http_request_queue;
create function pg_temp.resynced() returns text[] language sql as $$
  select coalesce(array_agg(b -> 'record' ->> 'id' order by b -> 'record' ->> 'id'), '{}')
    from (select convert_from(body, 'utf8')::jsonb as b from net.http_request_queue where id > (select id from baseline)) q
   where b ->> 'type' = 'RESYNC';
$$;

update user_preferences set language = 'cs' where user_id = '11111111-1111-1111-1111-111111111111';
do $$
begin
  if pg_temp.resynced() is distinct from array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002'] then
    raise exception 'TEST FAILED: expected a re-sync of the two upcoming tasks, got %', pg_temp.resynced();
  end if;
end $$;

-- 5. No re-sync when nothing changed, for unconnected users, or for a first preference of English...
update user_preferences set language = 'cs' where user_id = '11111111-1111-1111-1111-111111111111';
update user_preferences set language = 'cs' where user_id = '22222222-2222-2222-2222-222222222222';
insert into user_preferences (user_id, language) values ('33333333-3333-3333-3333-333333333333', 'en');
do $$
begin
  if cardinality(pg_temp.resynced()) <> 2 then
    raise exception 'TEST FAILED: unexpected re-syncs %', pg_temp.resynced();
  end if;
end $$;

-- 6. ...but a connected user whose first preference is Czech gets one.
delete from user_preferences where user_id = '33333333-3333-3333-3333-333333333333';
insert into user_preferences (user_id, language) values ('33333333-3333-3333-3333-333333333333', 'cs');
do $$
begin
  if not ('d0000000-0000-0000-0000-000000000005' = any (pg_temp.resynced())) then
    raise exception 'TEST FAILED: a first preference of Czech should re-sync, got %', pg_temp.resynced();
  end if;
end $$;

-- 7. Task changes still queue their usual webhook through the shared helper.
update tasks set completed_at = now() where id = 'd0000000-0000-0000-0000-000000000001';
do $$
begin
  if not exists (
    select 1 from net.http_request_queue
     where id > (select id from baseline)
       and convert_from(body, 'utf8')::jsonb ->> 'type' = 'UPDATE'
       and convert_from(body, 'utf8')::jsonb -> 'record' ->> 'id' = 'd0000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'TEST FAILED: completing a task no longer queues a sync';
  end if;
end $$;

rollback;
