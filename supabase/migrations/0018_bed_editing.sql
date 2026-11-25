-- Editing garden beds: any shape, renaming, deleting.
--
-- A bed is no longer always a full rectangle. rows × cols is its bounding box, and
-- `gaps` lists the positions in that box that aren't part of the bed, as [row, col]
-- pairs (0-based): an L-shaped bed, or one with a path through it. Slots are added and
-- removed one at a time with add_bed_slot() / remove_bed_slot(), which keep the box
-- tight around the slots, moving the plantings when a row or column comes or goes at
-- the top or the left.

alter table beds
  add column gaps jsonb not null default '[]'
    constraint beds_gaps_array check (jsonb_typeof(gaps) = 'array');

alter table beds add constraint beds_name_not_blank check (btrim(name) <> '');

-- The largest box the app offers (MAX_BED_SIZE in the app).
create function bed_max_size() returns int language sql immutable as $$ select 20 $$;

-- Whether (row, col) is a slot of the bed: inside its box and not a gap. (Not `gaps @>`:
-- jsonb containment ignores positions, so [[0, 2]] would "contain" [[2, 2]].)
create or replace function bed_has_slot(p_bed beds, p_row int, p_col int) returns boolean
language sql immutable as $$
  select p_row between 0 and p_bed.rows - 1
     and p_col between 0 and p_bed.cols - 1
     and not exists (
       select 1 from jsonb_array_elements(p_bed.gaps) g
        where (g->>0)::int = p_row and (g->>1)::int = p_col)
$$;

-- An active planting must sit in a slot, not in a gap (adds the gap check to 0003).
-- Past plantings keep the position they had, wherever the bed's shape has gone since.
create or replace function check_planting_integrity() returns trigger
language plpgsql
set search_path = public
as $$
declare
  bed beds;
  plant_owner uuid;
  plant_found boolean;
begin
  select * into bed from beds where id = new.bed_id;
  if not found or bed.user_id <> new.user_id then
    raise exception 'Planting rejected: bed not found'
      using errcode = 'check_violation', detail = format('bed_id %s is not owned by user %s', new.bed_id, new.user_id);
  end if;

  if new.status = 'active' and not bed_has_slot(bed, new.cell_row, new.cell_col) then
    if new.cell_row not between 0 and bed.rows - 1 or new.cell_col not between 0 and bed.cols - 1 then
      raise exception 'Planting rejected: cell (%, %) is outside the bed (% x %)', new.cell_row, new.cell_col, bed.rows, bed.cols
        using errcode = 'check_violation';
    end if;
    raise exception 'Planting rejected: cell (%, %) is not a slot of the bed', new.cell_row, new.cell_col
      using errcode = 'check_violation';
  end if;

  select true, user_id into plant_found, plant_owner from plants_catalog where id = new.plant_id;
  if not coalesce(plant_found, false) or (plant_owner is not null and plant_owner <> new.user_id) then
    raise exception 'Planting rejected: plant not found'
      using errcode = 'check_violation', detail = format('plant_id %s is neither built-in nor owned by user %s', new.plant_id, new.user_id);
  end if;

  return new;
end $$;

-- The gaps of one whole row (p_row set) or column (p_col set), except one position.
create function bed_line_gaps(p_rows int, p_cols int, p_row int, p_col int, p_except int) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(
           case when p_row is not null then jsonb_build_array(p_row, i) else jsonb_build_array(i, p_col) end), '[]')
    from generate_series(0, case when p_row is not null then p_cols else p_rows end - 1) i
   where i is distinct from p_except
$$;

-- Moves the bed's gaps and active plantings by (dr, dc), after the box has grown (or
-- before it shrinks). Plantings move one at a time, farthest first, so none lands on a
-- cell another still holds (one active planting per cell is checked row by row).
create function shift_bed_contents(p_bed_id uuid, p_dr int, p_dc int) returns void
language plpgsql set search_path = public as $$
declare
  p record;
begin
  update beds
     set gaps = coalesce((
           select jsonb_agg(jsonb_build_array((g->>0)::int + p_dr, (g->>1)::int + p_dc))
             from jsonb_array_elements(gaps) g), '[]')
   where id = p_bed_id;
  for p in
    select id from plantings
     where bed_id = p_bed_id and status = 'active'
     order by cell_row * sign(p_dr) desc, cell_col * sign(p_dc) desc
  loop
    update plantings set cell_row = cell_row + p_dr, cell_col = cell_col + p_dc where id = p.id;
  end loop;
end $$;

-- Drops edge rows and columns that are all gaps, so the box stays tight.
create function trim_bed(p_bed_id uuid) returns void
language plpgsql set search_path = public as $$
declare
  bed beds;
  in_row int;
begin
  loop
    select * into bed from beds where id = p_bed_id;
    if (select count(*) from jsonb_array_elements(bed.gaps) g where (g->>0)::int = 0) = bed.cols then
      update beds set rows = rows - 1,
             gaps = (select coalesce(jsonb_agg(g), '[]') from jsonb_array_elements(gaps) g where (g->>0)::int <> 0)
       where id = p_bed_id;
      perform shift_bed_contents(p_bed_id, -1, 0);
    elsif (select count(*) from jsonb_array_elements(bed.gaps) g where (g->>0)::int = bed.rows - 1) = bed.cols then
      update beds set rows = rows - 1,
             gaps = (select coalesce(jsonb_agg(g), '[]') from jsonb_array_elements(gaps) g where (g->>0)::int <> bed.rows - 1)
       where id = p_bed_id;
    elsif (select count(*) from jsonb_array_elements(bed.gaps) g where (g->>1)::int = 0) = bed.rows then
      update beds set cols = cols - 1,
             gaps = (select coalesce(jsonb_agg(g), '[]') from jsonb_array_elements(gaps) g where (g->>1)::int <> 0)
       where id = p_bed_id;
      perform shift_bed_contents(p_bed_id, 0, -1);
    elsif (select count(*) from jsonb_array_elements(bed.gaps) g where (g->>1)::int = bed.cols - 1) = bed.rows then
      update beds set cols = cols - 1,
             gaps = (select coalesce(jsonb_agg(g), '[]') from jsonb_array_elements(gaps) g where (g->>1)::int <> bed.cols - 1)
       where id = p_bed_id;
    else
      exit;
    end if;
  end loop;
end $$;

-- Adds one slot: a gap inside the bed, or a spot just outside its edge next to one of
-- its slots (the box grows; at the top or the left, everything moves down or right).
-- Refused with slot_exists, slot_not_adjacent or bed_too_large (DETAIL: the limit).
create function add_bed_slot(p_bed_id uuid, p_row int, p_col int) returns beds
language plpgsql security definer set search_path = public as $$
declare
  bed beds;
begin
  select * into bed from beds where id = p_bed_id and user_id = auth.uid() for update;
  if not found then raise exception 'bed_not_found' using errcode = 'P0002'; end if;
  if bed_has_slot(bed, p_row, p_col) then raise exception 'slot_exists' using errcode = 'P0001'; end if;

  if p_row between 0 and bed.rows - 1 and p_col between 0 and bed.cols - 1 then
    -- A gap inside the box becomes a slot.
    update beds set gaps = (
      select coalesce(jsonb_agg(g), '[]') from jsonb_array_elements(gaps) g where g <> jsonb_build_array(p_row, p_col))
     where id = p_bed_id;
  else
    -- Just outside the box: it must touch a slot (no corners), and the box may not outgrow the limit.
    if not (bed_has_slot(bed, p_row - 1, p_col) or bed_has_slot(bed, p_row + 1, p_col)
            or bed_has_slot(bed, p_row, p_col - 1) or bed_has_slot(bed, p_row, p_col + 1)) then
      raise exception 'slot_not_adjacent' using errcode = 'P0001';
    end if;
    if (p_row in (-1, bed.rows) and bed.rows >= bed_max_size())
       or (p_col in (-1, bed.cols) and bed.cols >= bed_max_size()) then
      raise exception 'bed_too_large' using errcode = 'P0001', detail = bed_max_size()::text;
    end if;

    if p_row = -1 then
      -- A new top row: grow, move everything down, the rest of the new row are gaps.
      update beds set rows = rows + 1 where id = p_bed_id;
      perform shift_bed_contents(p_bed_id, 1, 0);
      update beds set gaps = gaps || bed_line_gaps(rows, cols, 0, null, p_col) where id = p_bed_id;
    elsif p_row = bed.rows then
      update beds set rows = rows + 1, gaps = gaps || bed_line_gaps(rows + 1, cols, bed.rows, null, p_col)
       where id = p_bed_id;
    elsif p_col = -1 then
      update beds set cols = cols + 1 where id = p_bed_id;
      perform shift_bed_contents(p_bed_id, 0, 1);
      update beds set gaps = gaps || bed_line_gaps(rows, cols, null, 0, p_row) where id = p_bed_id;
    else
      update beds set cols = cols + 1, gaps = gaps || bed_line_gaps(rows, cols + 1, null, bed.cols, p_row)
       where id = p_bed_id;
    end if;
  end if;

  select * into bed from beds where id = p_bed_id;
  return bed;
end $$;

-- Removes one slot. A plant in it is taken out first, as "Remove" in the garden does:
-- its planting is kept as history and its unfinished tasks go (migration 0004). The last
-- slot can't go (slot_last): delete the bed instead.
create function remove_bed_slot(p_bed_id uuid, p_row int, p_col int) returns beds
language plpgsql security definer set search_path = public as $$
declare
  bed beds;
begin
  select * into bed from beds where id = p_bed_id and user_id = auth.uid() for update;
  if not found then raise exception 'bed_not_found' using errcode = 'P0002'; end if;
  if not bed_has_slot(bed, p_row, p_col) then raise exception 'slot_not_found' using errcode = 'P0001'; end if;
  if bed.rows * bed.cols - jsonb_array_length(bed.gaps) <= 1 then
    raise exception 'slot_last' using errcode = 'P0001';
  end if;

  update plantings set status = 'removed'
   where bed_id = p_bed_id and cell_row = p_row and cell_col = p_col and status = 'active';
  update beds set gaps = gaps || jsonb_build_array(jsonb_build_array(p_row, p_col)) where id = p_bed_id;
  perform trim_bed(p_bed_id);

  select * into bed from beds where id = p_bed_id;
  return bed;
end $$;

-- Deletes one of your beds, with its past plantings and their tasks. Refused with
-- bed_not_empty while anything grows in it.
create function delete_bed(p_bed_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from beds where id = p_bed_id and user_id = auth.uid()) then
    raise exception 'bed_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from plantings where bed_id = p_bed_id and status = 'active') then
    raise exception 'bed_not_empty' using errcode = 'P0001';
  end if;
  delete from beds where id = p_bed_id;
end $$;

-- Event locations name the bed and the cell ("Herbs, row 2, column 3"), so renaming a
-- bed or moving a planting re-syncs the events of the tasks due today or later (as
-- renaming a plant does, migration 0010).
create function resync_calendar_on_bed_rename() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  if new.name is not distinct from old.name then return null; end if;
  if not exists (
    select 1 from calendar_credentials where user_id = new.user_id and disconnected_reason is null
  ) then
    return null;
  end if;
  for t in
    select tk.* from tasks tk join plantings p on p.id = tk.planting_id
     where p.bed_id = new.id and p.status = 'active' and tk.user_id = new.user_id
       and coalesce(tk.due_until, tk.due_date) >= current_date
  loop
    perform queue_calendar_sync(
      new.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
  return null;
end;
$$;

create trigger beds_after_rename_resync_calendar
  after update of name on beds
  for each row execute function resync_calendar_on_bed_rename();

create function resync_calendar_on_planting_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t tasks;
begin
  if new.status <> 'active'
     or (new.cell_row = old.cell_row and new.cell_col = old.cell_col) then
    return null;
  end if;
  if not exists (
    select 1 from calendar_credentials where user_id = new.user_id and disconnected_reason is null
  ) then
    return null;
  end if;
  for t in
    select * from tasks where planting_id = new.id and coalesce(due_until, due_date) >= current_date
  loop
    perform queue_calendar_sync(
      new.user_id,
      jsonb_build_object('type', 'RESYNC', 'table', 'tasks', 'record', to_jsonb(t), 'old_record', null)
    );
  end loop;
  return null;
end;
$$;

create trigger plantings_after_move_resync_calendar
  after update of cell_row, cell_col on plantings
  for each row execute function resync_calendar_on_planting_move();

-- The three actions are for signed-in users (they check the bed is theirs); the helpers
-- only run inside them.
revoke all on function add_bed_slot(uuid, int, int) from public, anon;
revoke all on function remove_bed_slot(uuid, int, int) from public, anon;
revoke all on function delete_bed(uuid) from public, anon;
grant execute on function add_bed_slot(uuid, int, int) to authenticated;
grant execute on function remove_bed_slot(uuid, int, int) to authenticated;
grant execute on function delete_bed(uuid) to authenticated;
revoke all on function shift_bed_contents(uuid, int, int) from public, anon, authenticated;
revoke all on function trim_bed(uuid) from public, anon, authenticated;
