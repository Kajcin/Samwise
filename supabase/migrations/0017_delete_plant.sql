-- Deleting your own plant. A planting removed from a bed stays in `plantings` (status
-- 'removed'), and its foreign key kept the plant from being deleted, though the app shows
-- no such history. Now only a plant in a bed right now is kept; otherwise it goes with its
-- past plantings and their tasks (whose calendar events the tasks' delete trigger removes
-- from Google Calendar, migration 0007).
--
-- Both functions run as the caller, so row-level security limits them to your own rows.

-- What deleting the plant would mean: the beds it's in now (then it can't be deleted)
-- and how many completed tasks of past plantings would go with it.
create function plant_deletion_check(p_plant_id uuid)
returns table (active_beds text[], completed_tasks int)
language sql stable security invoker set search_path = public as $$
  select
    coalesce((select array_agg(distinct b.name order by b.name)
                from plantings pl join beds b on b.id = pl.bed_id
               where pl.plant_id = p_plant_id and pl.status = 'active'), '{}'),
    (select count(*)::int
       from tasks t join plantings pl on pl.id = t.planting_id
      where pl.plant_id = p_plant_id and t.completed_at is not null)
$$;

-- Deletes one of your own plants with its care rules, photos (cascade), past plantings
-- and their tasks. Refused with 'plant_in_garden' (the beds in DETAIL) while it's in a bed.
create function delete_plant(p_plant_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_beds text;
begin
  if not exists (select 1 from plants_catalog where id = p_plant_id and user_id = auth.uid()) then
    raise exception 'plant_not_found' using errcode = 'P0002';
  end if;
  select string_agg(distinct b.name, ', ' order by b.name) into v_beds
    from plantings pl join beds b on b.id = pl.bed_id
   where pl.plant_id = p_plant_id and pl.status = 'active';
  if v_beds is not null then
    raise exception 'plant_in_garden' using errcode = 'P0001', detail = v_beds;
  end if;
  delete from plantings where plant_id = p_plant_id;
  delete from plants_catalog where id = p_plant_id;
end $$;

revoke all on function plant_deletion_check(uuid) from public, anon;
revoke all on function delete_plant(uuid) from public, anon;
grant execute on function plant_deletion_check(uuid) to authenticated;
grant execute on function delete_plant(uuid) to authenticated;
