-- Flowering and harvest as sets of months (1-12) instead of a from-to range, so a plant
-- can have two seasons (spinach is harvested in spring and again in autumn). Harvest is
-- new: for vegetables, fruit and herbs it's the season that matters, and it differs from
-- flowering. Replaces flowering_start_month / flowering_end_month (migration 0001).

alter table plants_catalog
  add column flowering_months smallint[] not null default '{}'
    constraint plants_catalog_flowering_months
      check (flowering_months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]),
  add column harvest_months smallint[] not null default '{}'
    constraint plants_catalog_harvest_months
      check (harvest_months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]);

-- Keep what was entered: a range becomes its months (a range may run over the new year).
update plants_catalog
   set flowering_months = array(
         select m::smallint from generate_series(1, 12) m
          where case when flowering_start_month <= flowering_end_month
                     then m between flowering_start_month and flowering_end_month
                     else m >= flowering_start_month or m <= flowering_end_month end)
 where flowering_start_month is not null and flowering_end_month is not null;

alter table plants_catalog drop column flowering_start_month, drop column flowering_end_month;

-- Stored in calendar order without repeats, however they were sent.
create function normalize_plant_months() returns trigger
language plpgsql as $$
begin
  new.flowering_months := array(select distinct m from unnest(new.flowering_months) m order by m);
  new.harvest_months := array(select distinct m from unnest(new.harvest_months) m order by m);
  return new;
end $$;
revoke all on function normalize_plant_months() from public, anon, authenticated;

create trigger plants_catalog_normalize_months
  before insert or update of flowering_months, harvest_months on plants_catalog
  for each row execute function normalize_plant_months();

-- The built-in plants: the seeded "flowering" months of the vegetables were closer to
-- their growing season. Lettuce and spinach flower only when they bolt, and carrots in
-- their second year, so they have no flowering season here.
update plants_catalog p
   set flowering_months = v.flowering::smallint[], harvest_months = v.harvest::smallint[]
  from (values
    ('a0000000-0000-0000-0000-000000000001'::uuid, '{6,7,8}',         '{7,8,9,10}'),     -- Tomato
    ('a0000000-0000-0000-0000-000000000002'::uuid, '{7,8,9}',         '{6,7,8,9}'),      -- Basil
    ('a0000000-0000-0000-0000-000000000003'::uuid, '{}',              '{5,6,7,8,9}'),    -- Lettuce
    ('a0000000-0000-0000-0000-000000000004'::uuid, '{}',              '{7,8,9,10}'),     -- Carrot
    ('a0000000-0000-0000-0000-000000000005'::uuid, '{6,7,8}',         '{7,8,9,10}'),     -- Pepper
    ('a0000000-0000-0000-0000-000000000006'::uuid, '{6,7,8,9,10}',    '{}'),             -- Marigold
    ('a0000000-0000-0000-0000-000000000007'::uuid, '{6,7,8}',         '{7,8,9}'),        -- Zucchini
    ('a0000000-0000-0000-0000-000000000008'::uuid, '{}',              '{4,5,6,9,10}')    -- Spinach
  ) as v(id, flowering, harvest)
 where p.id = v.id;
