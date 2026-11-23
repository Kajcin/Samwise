-- Editing your own plants: a source link, sanity checks on the editable fields, and
-- calendar events that follow a renamed plant.
-- (Updating and deleting your own plants and rules is already allowed by RLS, 0001.
-- A plant that is or was planted can't be deleted: plantings.plant_id has no
-- ON DELETE, so the delete fails, which keeps planting history and tasks intact.)

-- A page describing the plant, e.g. its product page on a nursery's site. Samwise only
-- links to it; it never reads the page.
alter table plants_catalog
  add column source_url text
  constraint plants_catalog_source_url_http check (source_url ~* '^https?://\S+$');

alter table plants_catalog
  add constraint plants_catalog_watering_days check (watering_frequency_days between 1 and 365),
  -- A flowering range is both months or neither (the start may be later than the end:
  -- flowering over the new year, e.g. December to March).
  add constraint plants_catalog_flowering_range
    check ((flowering_start_month is null) = (flowering_end_month is null));

-- Event titles name the plant ("Harvest — Chilli"), so renaming one of your plants
-- re-syncs the events of its tasks due today or later (as a language change does, 0009).
create or replace function resync_calendar_on_plant_rename() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  -- Built-in plants (no owner) are shared and never renamed by users.
  if new.user_id is null then return null; end if;
  if new.name is not distinct from old.name and new.name_cs is not distinct from old.name_cs then
    return null;
  end if;
  if not exists (
    select 1 from calendar_credentials where user_id = new.user_id and disconnected_reason is null
  ) then
    return null;
  end if;

  for t in
    select tk.* from tasks tk join plantings p on p.id = tk.planting_id
     where p.plant_id = new.id and tk.user_id = new.user_id and tk.due_date >= current_date
  loop
    perform queue_calendar_sync(
      new.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
  return null;
end;
$$;

create trigger plants_catalog_after_rename_resync_calendar
  after update of name, name_cs on plants_catalog
  for each row execute function resync_calendar_on_plant_rename();
