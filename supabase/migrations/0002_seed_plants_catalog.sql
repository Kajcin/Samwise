-- Built-in plant catalog (user_id is null = visible to everyone, editable by no one).
-- Users who want different care rules clone a plant into their own catalog.

insert into plants_catalog (id, user_id, name, species, sun_requirements, watering_frequency_days, flowering_start_month, flowering_end_month, notes) values
  ('a0000000-0000-0000-0000-000000000001', null, 'Tomato',   'Solanum lycopersicum', 'full_sun',      2, 6,    9,    'Stake or cage as it grows.'),
  ('a0000000-0000-0000-0000-000000000002', null, 'Basil',    'Ocimum basilicum',     'full_sun',      2, 7,    9,    'Pinch flowers to keep leaves tender.'),
  ('a0000000-0000-0000-0000-000000000003', null, 'Lettuce',  'Lactuca sativa',       'partial_shade', 1, 5,    7,    'Bolts in high heat.'),
  ('a0000000-0000-0000-0000-000000000004', null, 'Carrot',   'Daucus carota',        'full_sun',      3, null, null, 'Thin seedlings early.'),
  ('a0000000-0000-0000-0000-000000000005', null, 'Pepper',   'Capsicum annuum',      'full_sun',      3, 6,    9,    'Slow to establish after transplant.'),
  ('a0000000-0000-0000-0000-000000000006', null, 'Marigold', 'Tagetes',              'full_sun',      4, 6,    10,   'Companion plant, deters pests.'),
  ('a0000000-0000-0000-0000-000000000007', null, 'Zucchini', 'Cucurbita pepo',       'full_sun',      2, 6,    8,    'Needs a lot of space.'),
  ('a0000000-0000-0000-0000-000000000008', null, 'Spinach',  'Spinacia oleracea',    'partial_shade', 2, 4,    5,    'Prefers cool weather.');

-- (plant_id, task_type, timing_type, offset_days, recurrence_days, notes)
-- offset_from_planting rules set offset_days only; recurring rules set recurrence_days only.
insert into care_rules (plant_id, task_type, timing_type, offset_days, recurrence_days, notes) values
  -- Tomato
  ('a0000000-0000-0000-0000-000000000001', 'seed_start', 'offset_from_planting', 0,    null, null),
  ('a0000000-0000-0000-0000-000000000001', 'transplant', 'offset_from_planting', 21,   null, 'After last frost.'),
  ('a0000000-0000-0000-0000-000000000001', 'fertilize',  'recurring',            null, 14,   null),
  ('a0000000-0000-0000-0000-000000000001', 'harvest',    'offset_from_planting', 75,   null, null),
  -- Basil
  ('a0000000-0000-0000-0000-000000000002', 'seed_start', 'offset_from_planting', 0,    null, null),
  ('a0000000-0000-0000-0000-000000000002', 'prune',      'recurring',            null, 10,   'Pinch tops to encourage bushing.'),
  ('a0000000-0000-0000-0000-000000000002', 'harvest',    'offset_from_planting', 60,   null, null),
  -- Lettuce
  ('a0000000-0000-0000-0000-000000000003', 'seed_start', 'offset_from_planting', 0,    null, null),
  ('a0000000-0000-0000-0000-000000000003', 'harvest',    'offset_from_planting', 45,   null, null),
  -- Carrot
  ('a0000000-0000-0000-0000-000000000004', 'seed_start', 'offset_from_planting', 0,    null, null),
  ('a0000000-0000-0000-0000-000000000004', 'harvest',    'offset_from_planting', 70,   null, null),
  -- Pepper
  ('a0000000-0000-0000-0000-000000000005', 'seed_start', 'offset_from_planting', 0,    null, null),
  ('a0000000-0000-0000-0000-000000000005', 'transplant', 'offset_from_planting', 28,   null, 'After last frost.'),
  ('a0000000-0000-0000-0000-000000000005', 'fertilize',  'recurring',            null, 21,   null),
  ('a0000000-0000-0000-0000-000000000005', 'harvest',    'offset_from_planting', 80,   null, null),
  -- Marigold (grown for flowers, so deadheading instead of a harvest)
  ('a0000000-0000-0000-0000-000000000006', 'seed_start', 'offset_from_planting', 0,    null, null),
  ('a0000000-0000-0000-0000-000000000006', 'prune',      'recurring',            null, 7,    'Deadhead spent blooms.'),
  -- Zucchini
  ('a0000000-0000-0000-0000-000000000007', 'seed_start', 'offset_from_planting', 0,    null, null),
  ('a0000000-0000-0000-0000-000000000007', 'fertilize',  'recurring',            null, 21,   null),
  ('a0000000-0000-0000-0000-000000000007', 'harvest',    'offset_from_planting', 50,   null, null),
  -- Spinach
  ('a0000000-0000-0000-0000-000000000008', 'seed_start', 'offset_from_planting', 0,    null, null),
  ('a0000000-0000-0000-0000-000000000008', 'harvest',    'offset_from_planting', 40,   null, null);
