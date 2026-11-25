-- A task type for removing faded flowers: "Deadhead" / "Odstraňování odkvětů".
--
-- Until now the built-in marigold's deadheading was a "prune" rule with the note "Deadhead
-- spent blooms.". It becomes a deadhead rule, kept to the marigold's flowering months
-- (0021): there is nothing to deadhead outside them. Gardens growing it get their tasks
-- redone right away (0020).

alter table care_rules drop constraint care_rules_task_type_check;
alter table care_rules add constraint care_rules_task_type_check check (task_type in (
  'seed_start', 'transplant', 'prune', 'fertilize', 'harvest',
  'divide', 'mulch', 'winter_protection', 'cut_back', 'deadhead'
));
alter table tasks drop constraint tasks_task_type_check;
alter table tasks add constraint tasks_task_type_check check (task_type in (
  'seed_start', 'transplant', 'prune', 'fertilize', 'harvest',
  'divide', 'mulch', 'winter_protection', 'cut_back', 'deadhead'
));

update care_rules
   set task_type = 'deadhead',
       season = 'flowering',
       notes = 'Pinch off faded flowers so it keeps blooming.',
       notes_cs = 'Odštípněte odkvetlé květy, ať kvete dál.'
 where plant_id = 'a0000000-0000-0000-0000-000000000006' -- Marigold
   and task_type = 'prune'
   and timing_type = 'recurring';
