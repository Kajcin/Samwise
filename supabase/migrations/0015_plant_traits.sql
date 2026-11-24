-- What kind of plant it is, shown as chips in the catalog and used to filter it.
--   life_cycle:  how it's grown here (a carrot is grown as an annual): one value.
--   growth_form: its shape: one value. Shrubs and trees have no life cycle here,
--                since Czech gardening's "trvalka" means a herbaceous perennial.
--   uses:        what it's grown for: any of them (lavender is a herb and ornamental).
-- All optional: an unknown value just shows no chip.

alter table plants_catalog
  add column life_cycle text
    constraint plants_catalog_life_cycle check (life_cycle in ('annual', 'biennial', 'perennial', 'bulb')),
  add column growth_form text
    constraint plants_catalog_growth_form check (growth_form in ('herbaceous', 'subshrub', 'shrub', 'tree', 'climber')),
  add column uses text[] not null default '{}'
    constraint plants_catalog_uses check (uses <@ array['vegetable', 'fruit', 'herb', 'ornamental']::text[]),
  add constraint plants_catalog_woody_no_life_cycle
    check (growth_form is null or growth_form not in ('shrub', 'tree') or life_cycle is null);

-- The built-in plants: all grown as annuals, all herbaceous.
update plants_catalog p
   set life_cycle = 'annual', growth_form = 'herbaceous', uses = v.uses
  from (values
    ('a0000000-0000-0000-0000-000000000001'::uuid, array['vegetable']),  -- Tomato
    ('a0000000-0000-0000-0000-000000000002'::uuid, array['herb']),       -- Basil
    ('a0000000-0000-0000-0000-000000000003'::uuid, array['vegetable']),  -- Lettuce
    ('a0000000-0000-0000-0000-000000000004'::uuid, array['vegetable']),  -- Carrot
    ('a0000000-0000-0000-0000-000000000005'::uuid, array['vegetable']),  -- Pepper
    ('a0000000-0000-0000-0000-000000000006'::uuid, array['ornamental']), -- Marigold
    ('a0000000-0000-0000-0000-000000000007'::uuid, array['vegetable']),  -- Zucchini
    ('a0000000-0000-0000-0000-000000000008'::uuid, array['vegetable'])   -- Spinach
  ) as v(id, uses)
 where p.id = v.id;
