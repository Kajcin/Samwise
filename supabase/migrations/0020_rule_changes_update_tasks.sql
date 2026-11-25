-- Changing a plant's care rules updates its upcoming tasks right away.
--
-- Since 0019 the nightly top-up adds the tasks of new or changed rules, but only planting
-- or taking out a plant removed the tasks of old ones. Now adding, changing or deleting a
-- rule works the plant's tasks out again for everyone growing it (with pruning): upcoming
-- unfinished tasks follow the rules, completed and past ones stay as they are. The
-- calendar follows through the tasks' own triggers.

create function sync_tasks_on_rule_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  grower record;
begin
  for grower in
    select distinct user_id from plantings
     where plant_id = coalesce(new.plant_id, old.plant_id) and status = 'active'
  loop
    perform sync_plant_tasks(grower.user_id, coalesce(new.plant_id, old.plant_id), true);
  end loop;
  return null;
end $$;

create trigger care_rules_after_change_sync_tasks
  after insert or update or delete on care_rules
  for each row execute function sync_tasks_on_rule_change();
