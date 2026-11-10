-- The client can't read calendar_credentials (0001). This is the only thing it
-- may learn about it: whether a row exists for the signed-in user.
-- security definer: runs as the owner so it can see the table; it only ever
-- reveals a boolean about auth.uid()'s own row.
create or replace function has_calendar_connection() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from calendar_credentials where user_id = auth.uid());
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default; only signed-in users should call this one.
revoke all on function has_calendar_connection() from public, anon;
grant execute on function has_calendar_connection() to authenticated;
