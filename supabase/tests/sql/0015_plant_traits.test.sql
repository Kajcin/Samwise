-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0015_plant_traits.test.sql
-- A plant's life cycle, growth form and uses: allowed values, shrubs and trees
-- without a life cycle, and the built-in plants' values.
begin;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Lavender', 'full_sun');

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

-- 1. New plants start without traits.
do $$
begin
  if (select life_cycle is not null or growth_form is not null or uses <> '{}'
        from plants_catalog where id = 'e0000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: a new plant should start without traits';
  end if;
end $$;

-- 2. Only the known values.
select pg_temp.expect_error(
  $$update plants_catalog set life_cycle = 'evergreen' where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_life_cycle');
select pg_temp.expect_error(
  $$update plants_catalog set growth_form = 'grass' where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_growth_form');
select pg_temp.expect_error(
  $$update plants_catalog set uses = array['herb', 'medicinal'] where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_uses');

-- 3. Shrubs and trees have no life cycle; subshrubs and climbers may.
select pg_temp.expect_error(
  $$update plants_catalog set growth_form = 'shrub', life_cycle = 'perennial' where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_woody_no_life_cycle');
select pg_temp.expect_error(
  $$update plants_catalog set growth_form = 'tree', life_cycle = 'perennial' where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_woody_no_life_cycle');
update plants_catalog set growth_form = 'climber', life_cycle = 'annual' where id = 'e0000000-0000-0000-0000-000000000001';
update plants_catalog set growth_form = 'shrub', life_cycle = null, uses = array['fruit'] where id = 'e0000000-0000-0000-0000-000000000001';
-- Lavender: a perennial subshrub, grown as a herb and for its looks.
update plants_catalog
   set growth_form = 'subshrub', life_cycle = 'perennial', uses = array['herb', 'ornamental']
 where id = 'e0000000-0000-0000-0000-000000000001';

-- 4. The built-in plants have their traits.
do $$
begin
  if exists (select 1 from plants_catalog where user_id is null
               and (life_cycle is distinct from 'annual' or growth_form is distinct from 'herbaceous' or uses = '{}')) then
    raise exception 'TEST FAILED: every built-in plant should be an annual herbaceous plant with a use';
  end if;
  if (select uses from plants_catalog where id = 'a0000000-0000-0000-0000-000000000002') <> array['herb'] then
    raise exception 'TEST FAILED: basil should be a herb';
  end if;
  if (select uses from plants_catalog where id = 'a0000000-0000-0000-0000-000000000006') <> array['ornamental'] then
    raise exception 'TEST FAILED: marigold should be ornamental';
  end if;
end $$;

rollback;
