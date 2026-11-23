-- A broken calendar connection is remembered, with the reason, so Settings can say
-- what happened and offer to reconnect (and reconnecting reuses what it can):
--   revoked           the user removed Samwise's access in their Google account;
--                     tokens cleared, calendar id kept (reconnecting reuses the calendar)
--   calendar_deleted  the user deleted the "Samwise" calendar in Google Calendar;
--                     reconnecting creates a new one
-- Disconnecting in Settings deletes the row.
alter table calendar_credentials
  add column disconnected_reason text check (disconnected_reason in ('revoked', 'calendar_deleted'));

-- Rows revoked under 0007, which marked that by clearing the refresh token only.
update calendar_credentials set disconnected_reason = 'revoked' where refresh_token is null;

-- Only a revoked connection may lack its refresh token.
alter table calendar_credentials
  add constraint calendar_credentials_refresh_token_unless_revoked
  check (refresh_token is not null or disconnected_reason = 'revoked');

-- Replaces has_calendar_connection(), which could only say yes or no.
drop function has_calendar_connection();

-- 'connected' | 'not_connected' | 'revoked' | 'calendar_deleted', for auth.uid() only.
-- security definer: the client can't read calendar_credentials (0001); this
-- reveals nothing but the signed-in user's own status.
create function calendar_connection_status() returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select coalesce(disconnected_reason, 'connected') from calendar_credentials where user_id = auth.uid()),
    'not_connected'
  );
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default; only signed-in users should call this one.
revoke all on function calendar_connection_status() from public, anon;
grant execute on function calendar_connection_status() to authenticated;

-- As in 0007, except that a connection counts only while it isn't broken.
create or replace function notify_calendar_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  task_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  sync_url text;
  webhook_secret text;
begin
  -- Most users never connect a calendar; don't call the function for them.
  if not exists (
    select 1 from calendar_credentials where user_id = task_user and disconnected_reason is null
  ) then
    return null;
  end if;

  -- Per environment, not in a migration (see the README): the function's URL and
  -- the secret it checks.
  select decrypted_secret into sync_url
    from vault.decrypted_secrets where name = 'calendar_sync_url';
  select decrypted_secret into webhook_secret
    from vault.decrypted_secrets where name = 'calendar_sync_webhook_secret';
  if sync_url is null or webhook_secret is null then
    raise warning 'calendar sync is not configured: Vault secrets calendar_sync_url / calendar_sync_webhook_secret are missing';
    return null;
  end if;

  -- Queued now, sent by pg_net's worker after the transaction commits (never on rollback).
  perform net.http_post(
    url := sync_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', webhook_secret),
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
      'old_record', case when tg_op = 'INSERT' then null else to_jsonb(old) end
    ),
    -- The function refreshes a token and calls Google; pg_net's 5s default is tight.
    timeout_milliseconds := 30000
  );
  return null; -- after trigger: the return value is ignored
end;
$$;
