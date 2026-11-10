-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0006_calendar_connection.test.sql
-- The client may learn only whether it has a calendar connection, never the credentials.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');

-- As the service role would (bypassing RLS), store credentials for user A only.
insert into calendar_credentials (user_id, refresh_token, calendar_id)
values ('11111111-1111-1111-1111-111111111111', 'secret-refresh-token', 'cal-1');

do $$
begin
  if has_function_privilege('anon', 'has_calendar_connection()', 'execute') then
    raise exception 'TEST FAILED: anon can call has_calendar_connection()';
  end if;
  if not has_function_privilege('authenticated', 'has_calendar_connection()', 'execute') then
    raise exception 'TEST FAILED: authenticated cannot call has_calendar_connection()';
  end if;
end $$;

set local role authenticated;

set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';
do $$
begin
  if not has_calendar_connection() then
    raise exception 'TEST FAILED: user A should be connected';
  end if;
  begin
    perform refresh_token from calendar_credentials;
    raise exception 'TEST FAILED: authenticated role could read calendar_credentials';
  exception when insufficient_privilege then
    raise notice 'direct read correctly rejected';
  end;
end $$;

set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
begin
  if has_calendar_connection() then
    raise exception 'TEST FAILED: user B should not be connected';
  end if;
end $$;

rollback;
