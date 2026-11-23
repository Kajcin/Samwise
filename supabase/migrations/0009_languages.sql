-- Languages: English (default) and Czech.
--   * each user's language, set from the browser on first sign-in, changed in Settings;
--   * Czech names and notes for the built-in plants;
--   * a language change re-syncs the user's upcoming calendar events, whose titles
--     are written in the user's language by calendar-sync.

-- --- The user's language ------------------------------------------------------

create table user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  language text not null default 'en' check (language in ('en', 'cs'))
);

alter table user_preferences enable row level security;

create policy user_preferences_all on user_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Signed-in users only; a language row is nothing an anonymous visitor needs.
revoke all on user_preferences from anon;

-- --- Czech catalog texts -----------------------------------------------------------
-- Only built-in plants have them; a user's own plants are in whatever language
-- they were typed (cloning a built-in plant copies the texts of the user's language).

alter table plants_catalog add column name_cs text, add column notes_cs text;
alter table care_rules add column notes_cs text;

update plants_catalog p set name_cs = v.name_cs, notes_cs = v.notes_cs
from (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'Rajče',      'Během růstu vyvazujte ke kolíku nebo opoře.'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'Bazalka',    'Odštipujte květy, aby listy zůstaly jemné.'),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'Salát',      'Ve velkém horku vybíhá do květu.'),
  ('a0000000-0000-0000-0000-000000000004'::uuid, 'Mrkev',      'Semenáčky včas protrhejte.'),
  ('a0000000-0000-0000-0000-000000000005'::uuid, 'Paprika',    'Po přesazení pomalu zakořeňuje.'),
  ('a0000000-0000-0000-0000-000000000006'::uuid, 'Aksamitník', 'Doprovodná rostlina, odpuzuje škůdce.'),
  ('a0000000-0000-0000-0000-000000000007'::uuid, 'Cuketa',     'Potřebuje hodně místa.'),
  ('a0000000-0000-0000-0000-000000000008'::uuid, 'Špenát',     'Daří se mu v chladnějším počasí.')
) as v(id, name_cs, notes_cs)
where p.id = v.id and p.user_id is null;

update care_rules r set notes_cs = v.notes_cs
from (values
  ('After last frost.', 'Po posledních mrazech.'),
  ('Pinch tops to encourage bushing.', 'Zaštipujte vrcholky, aby se rostlina víc větvila.'),
  ('Deadhead spent blooms.', 'Odstraňujte odkvetlé květy.')
) as v(notes, notes_cs)
where r.notes = v.notes
  and exists (select 1 from plants_catalog p where p.id = r.plant_id and p.user_id is null);

-- --- Calendar sync ------------------------------------------------------------------

-- Queues one request to calendar-sync, if the user has a working calendar connection
-- and this environment is configured (Vault secrets, see the README). Shared by the
-- tasks triggers and the language-change re-sync.
create or replace function queue_calendar_sync(p_user uuid, p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  sync_url text;
  webhook_secret text;
begin
  -- Most users never connect a calendar; don't call the function for them.
  if not exists (
    select 1 from calendar_credentials where user_id = p_user and disconnected_reason is null
  ) then
    return;
  end if;

  select decrypted_secret into sync_url
    from vault.decrypted_secrets where name = 'calendar_sync_url';
  select decrypted_secret into webhook_secret
    from vault.decrypted_secrets where name = 'calendar_sync_webhook_secret';
  if sync_url is null or webhook_secret is null then
    raise warning 'calendar sync is not configured: Vault secrets calendar_sync_url / calendar_sync_webhook_secret are missing';
    return;
  end if;

  -- Queued now, sent by pg_net's worker after the transaction commits (never on rollback).
  perform net.http_post(
    url := sync_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', webhook_secret),
    body := p_body,
    -- The function refreshes a token and calls Google; pg_net's 5s default is tight.
    timeout_milliseconds := 30000
  );
end;
$$;

-- Internal: only the triggers below call it.
revoke all on function queue_calendar_sync(uuid, jsonb) from public, anon, authenticated;

-- As in 0008, now through queue_calendar_sync.
create or replace function notify_calendar_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform queue_calendar_sync(
    case when tg_op = 'DELETE' then old.user_id else new.user_id end,
    jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
      'old_record', case when tg_op = 'INSERT' then null else to_jsonb(old) end
    )
  );
  return null; -- after trigger: the return value is ignored
end;
$$;

-- Event titles are in the user's language, so a new language re-syncs every task
-- the calendar shows (due today or later, as connecting does). A first preference
-- that isn't English counts as a change too: until then events were English.
create or replace function resync_calendar_on_language_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  if tg_op = 'UPDATE' and new.language = old.language then return null; end if;
  if tg_op = 'INSERT' and new.language = 'en' then return null; end if;
  if not exists (
    select 1 from calendar_credentials where user_id = new.user_id and disconnected_reason is null
  ) then
    return null;
  end if;

  for t in select * from tasks where user_id = new.user_id and due_date >= current_date loop
    perform queue_calendar_sync(
      new.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
  return null;
end;
$$;

create trigger user_preferences_after_change_resync_calendar
  after insert or update of language on user_preferences
  for each row execute function resync_calendar_on_language_change();
