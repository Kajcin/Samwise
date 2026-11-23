-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0008_calendar_connection_status.test.sql
-- The client may learn only its own connection status, never the credentials;
-- a broken connection is reported with its reason and no longer syncs.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'connected@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'never-connected@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'revoked@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'calendar-deleted@example.com');

-- As the service role would (bypassing RLS).
insert into calendar_credentials (user_id, refresh_token, calendar_id, disconnected_reason) values
  ('11111111-1111-1111-1111-111111111111', 'refresh-1', 'cal-1', null),
  ('33333333-3333-3333-3333-333333333333', null, 'cal-3', 'revoked'),
  ('44444444-4444-4444-4444-444444444444', 'refresh-4', 'cal-4', 'calendar_deleted');

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

-- Only a revoked connection may lack its refresh token; reasons are a fixed set.
select pg_temp.expect_error(
  $$update calendar_credentials set refresh_token = null where user_id = '11111111-1111-1111-1111-111111111111'$$,
  'calendar_credentials_refresh_token_unless_revoked');
select pg_temp.expect_error(
  $$update calendar_credentials set disconnected_reason = 'bored' where user_id = '11111111-1111-1111-1111-111111111111'$$,
  'calendar_credentials_disconnected_reason_check');

do $$
begin
  if exists (select 1 from pg_proc where proname = 'has_calendar_connection') then
    raise exception 'TEST FAILED: has_calendar_connection() should be gone';
  end if;
  if has_function_privilege('anon', 'calendar_connection_status()', 'execute') then
    raise exception 'TEST FAILED: anon can call calendar_connection_status()';
  end if;
  if not has_function_privilege('authenticated', 'calendar_connection_status()', 'execute') then
    raise exception 'TEST FAILED: authenticated cannot call calendar_connection_status()';
  end if;
end $$;

create function pg_temp.expect_status(p_user uuid, p_expected text) returns void language plpgsql as $$
declare
  actual text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  actual := calendar_connection_status();
  if actual is distinct from p_expected then
    raise exception 'TEST FAILED: status for %: expected %, got %', p_user, p_expected, actual;
  end if;
end $$;

set local role authenticated;
select pg_temp.expect_status('11111111-1111-1111-1111-111111111111', 'connected');
select pg_temp.expect_status('22222222-2222-2222-2222-222222222222', 'not_connected');
select pg_temp.expect_status('33333333-3333-3333-3333-333333333333', 'revoked');
select pg_temp.expect_status('44444444-4444-4444-4444-444444444444', 'calendar_deleted');

do $$
begin
  perform refresh_token from calendar_credentials;
  raise exception 'TEST FAILED: authenticated role could read calendar_credentials';
exception when insufficient_privilege then
  raise notice 'direct read correctly rejected';
end $$;
reset role;

-- A broken connection doesn't sync: no webhook request for its task changes.
delete from vault.secrets where name in ('calendar_sync_url', 'calendar_sync_webhook_secret');
select vault.create_secret('http://sync.test/functions/v1/calendar-sync', 'calendar_sync_url');
select vault.create_secret('test-webhook-secret', 'calendar_sync_webhook_secret');
create temp table baseline as select coalesce(max(id), 0) as id from net.http_request_queue;

insert into tasks (user_id, task_type, due_date) values
  ('11111111-1111-1111-1111-111111111111', 'prune', '2026-12-01'),
  ('33333333-3333-3333-3333-333333333333', 'prune', '2026-12-01'),
  ('44444444-4444-4444-4444-444444444444', 'prune', '2026-12-01');

do $$
declare
  synced uuid[] := (
    select array_agg((convert_from(body, 'utf8')::jsonb -> 'record' ->> 'user_id')::uuid)
      from net.http_request_queue where id > (select id from baseline)
  );
begin
  if synced is distinct from array['11111111-1111-1111-1111-111111111111'::uuid] then
    raise exception 'TEST FAILED: expected a request for the connected user only, got %', synced;
  end if;
end $$;

rollback;
