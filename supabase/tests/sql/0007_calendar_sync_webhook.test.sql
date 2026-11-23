-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0007_calendar_sync_webhook.test.sql
-- Task changes of connected users are queued (pg_net) for the calendar-sync function;
-- nothing is queued for unconnected users or for changes the calendar doesn't show.
-- pg_net only sends requests after commit, so this rolled-back test sends nothing.
begin;

-- Known Vault secrets for this test (replacing any configured locally; rolled back).
delete from vault.secrets where name in ('calendar_sync_url', 'calendar_sync_webhook_secret');
select vault.create_secret('http://sync.test/functions/v1/calendar-sync', 'calendar_sync_url');
select vault.create_secret('test-webhook-secret', 'calendar_sync_webhook_secret');

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'connected@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'never-connected@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'revoked@example.com');
insert into calendar_credentials (user_id, refresh_token, calendar_id, disconnected_reason) values
  ('11111111-1111-1111-1111-111111111111', 'refresh-1', 'cal-1', null),
  ('33333333-3333-3333-3333-333333333333', null, 'cal-3', 'revoked'); -- Google revoked access

create temp table baseline as select coalesce(max(id), 0) as id from net.http_request_queue;

-- The requests queued since the test started, oldest first.
create function pg_temp.queued() returns table (url text, headers jsonb, body jsonb, timeout_ms int)
language sql as $$
  select q.url, q.headers, convert_from(q.body, 'utf8')::jsonb, q.timeout_milliseconds
    from net.http_request_queue q where q.id > (select id from baseline) order by q.id;
$$;

create function pg_temp.expect_queued(p_count int, p_step text) returns void language plpgsql as $$
declare
  actual int := (select count(*) from pg_temp.queued());
begin
  if actual <> p_count then
    raise exception 'TEST FAILED (%): expected % queued requests, got %', p_step, p_count, actual;
  end if;
end $$;

-- 1. The connected user adds a task (as the app does): one request with the whole row.
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';
insert into tasks (id, user_id, task_type, due_date)
values ('d0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'prune', '2026-12-01');
reset role;

select pg_temp.expect_queued(1, 'insert');
do $$
declare
  r record;
begin
  select * into r from pg_temp.queued() limit 1;
  if r.url <> 'http://sync.test/functions/v1/calendar-sync' then
    raise exception 'TEST FAILED: wrong url %', r.url;
  end if;
  if r.headers ->> 'x-webhook-secret' is distinct from 'test-webhook-secret' then
    raise exception 'TEST FAILED: webhook secret header missing';
  end if;
  if r.body ->> 'type' <> 'INSERT' or r.body ->> 'table' <> 'tasks'
     or r.body -> 'record' ->> 'id' <> 'd0000000-0000-0000-0000-000000000001'
     or r.body -> 'record' ->> 'due_date' <> '2026-12-01'
     or r.body -> 'old_record' <> 'null'::jsonb then
    raise exception 'TEST FAILED: unexpected insert body %', r.body;
  end if;
  if r.timeout_ms <> 30000 then
    raise exception 'TEST FAILED: timeout %', r.timeout_ms;
  end if;
end $$;

-- 2. Writing back the event id (what calendar-sync does) queues nothing.
update tasks set google_calendar_event_id = 'evt-1' where id = 'd0000000-0000-0000-0000-000000000001';
select pg_temp.expect_queued(1, 'event id write-back');

-- 3. An update that changes nothing the event shows queues nothing either.
update tasks set due_date = '2026-12-01' where id = 'd0000000-0000-0000-0000-000000000001';
select pg_temp.expect_queued(1, 'no-change update');

-- 4. Completing it does.
set local role authenticated;
update tasks set completed_at = now() where id = 'd0000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.expect_queued(2, 'complete');
do $$
declare
  b jsonb := (select q.body from pg_temp.queued() q offset 1 limit 1);
begin
  if b ->> 'type' <> 'UPDATE' or b -> 'record' ->> 'completed_at' is null
     or b -> 'old_record' ->> 'completed_at' is not null then
    raise exception 'TEST FAILED: unexpected update body %', b;
  end if;
end $$;

-- 5. Deleting it sends the old row (with its event id).
delete from tasks where id = 'd0000000-0000-0000-0000-000000000001';
select pg_temp.expect_queued(3, 'delete');
do $$
declare
  b jsonb := (select q.body from pg_temp.queued() q offset 2 limit 1);
begin
  if b ->> 'type' <> 'DELETE' or b -> 'record' <> 'null'::jsonb
     or b -> 'old_record' ->> 'google_calendar_event_id' <> 'evt-1' then
    raise exception 'TEST FAILED: unexpected delete body %', b;
  end if;
end $$;

-- 6. Nothing for a user who never connected, or whose access Google revoked.
insert into tasks (user_id, task_type, due_date) values
  ('22222222-2222-2222-2222-222222222222', 'prune', '2026-12-01'),
  ('33333333-3333-3333-3333-333333333333', 'prune', '2026-12-01');
select pg_temp.expect_queued(3, 'unconnected users');

-- 7. Planting something queues one request per generated task.
insert into beds (id, user_id, name, rows, cols)
values ('b0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Test Bed', 1, 1);
insert into plantings (id, user_id, bed_id, cell_row, cell_col, plant_id, planted_date)
values ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'b0000000-0000-0000-0000-000000000001', 0, 0, 'a0000000-0000-0000-0000-000000000001', current_date);
do $$
declare
  generated int := (select count(*) from tasks where planting_id = 'c0000000-0000-0000-0000-000000000001');
begin
  if generated = 0 then
    raise exception 'TEST FAILED: planting generated no tasks';
  end if;
  perform pg_temp.expect_queued(3 + generated, 'planting');
end $$;

-- 8. Without the Vault secrets (not configured in this environment) task writes still work.
delete from vault.secrets where name = 'calendar_sync_url';
insert into tasks (user_id, task_type, due_date)
values ('11111111-1111-1111-1111-111111111111', 'prune', '2026-12-02');
do $$
begin
  if not exists (select 1 from tasks where due_date = '2026-12-02') then
    raise exception 'TEST FAILED: task insert failed without Vault secrets';
  end if;
end $$;

rollback;
