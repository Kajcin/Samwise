-- Pushes task changes to the calendar-sync Edge Function, which mirrors them onto
-- the user's "Samwise" Google calendar.
create extension if not exists pg_net;

-- A connection whose refresh token Google rejected (the user removed Samwise's
-- access) keeps its row with the tokens cleared: reconnecting then reuses the
-- same calendar instead of leaving a stale second "Samwise" calendar behind.
alter table calendar_credentials alter column refresh_token drop not null;

-- Only a connection that can still sync counts as connected.
create or replace function has_calendar_connection() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from calendar_credentials where user_id = auth.uid() and refresh_token is not null
  );
$$;

-- security definer: the trigger fires as the signed-in user, who can read
-- neither Vault nor calendar_credentials.
create or replace function notify_calendar_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  task_user uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  sync_url text;
  webhook_secret text;
begin
  -- Most users never connect a calendar; don't call the function for them.
  if not exists (
    select 1 from calendar_credentials where user_id = task_user and refresh_token is not null
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

create trigger tasks_after_insert_or_delete_notify_calendar
  after insert or delete on tasks
  for each row execute function notify_calendar_sync();

-- Only changes the event shows. In particular not calendar-sync writing back
-- google_calendar_event_id, which would otherwise call the function again.
create trigger tasks_after_update_notify_calendar
  after update of due_date, task_type, completed_at on tasks
  for each row
  when (
    old.due_date is distinct from new.due_date
    or old.task_type is distinct from new.task_type
    or old.completed_at is distinct from new.completed_at
  )
  execute function notify_calendar_sync();
