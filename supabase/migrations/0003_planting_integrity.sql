-- Cross-table integrity for plantings that foreign keys and RLS don't cover.
--
-- Foreign-key checks bypass RLS, so without this a client could insert a planting
-- that points at another user's bed or private plant (if it knew the id), or at a
-- cell outside the bed. Such rows would never show in the grid but would still
-- generate care tasks. The checks compare owners explicitly, so they also hold for
-- the service role and pg_cron, which bypass RLS.
--
-- Cells are 0-based: 0 <= cell_row < beds.rows, 0 <= cell_col < beds.cols.

create or replace function check_planting_integrity() returns trigger
language plpgsql
set search_path = public
as $$
declare
  bed_owner uuid;
  bed_rows int;
  bed_cols int;
  plant_owner uuid;
  plant_found boolean;
begin
  select user_id, rows, cols into bed_owner, bed_rows, bed_cols from beds where id = new.bed_id;
  if not found or bed_owner <> new.user_id then
    raise exception 'Planting rejected: bed not found'
      using errcode = 'check_violation', detail = format('bed_id %s is not owned by user %s', new.bed_id, new.user_id);
  end if;

  if new.cell_row < 0 or new.cell_row >= bed_rows or new.cell_col < 0 or new.cell_col >= bed_cols then
    raise exception 'Planting rejected: cell (%, %) is outside the bed (% x %)', new.cell_row, new.cell_col, bed_rows, bed_cols
      using errcode = 'check_violation';
  end if;

  select true, user_id into plant_found, plant_owner from plants_catalog where id = new.plant_id;
  if not coalesce(plant_found, false) or (plant_owner is not null and plant_owner <> new.user_id) then
    raise exception 'Planting rejected: plant not found'
      using errcode = 'check_violation', detail = format('plant_id %s is neither built-in nor owned by user %s', new.plant_id, new.user_id);
  end if;

  return new;
end $$;

create trigger plantings_integrity
  before insert or update of user_id, bed_id, cell_row, cell_col, plant_id on plantings
  for each row execute function check_planting_integrity();
