-- Run with: npm run db:psql -- -f supabase/tests/sql/0016_plant_season_months.test.sql
-- Flowering and harvest months: only 1-12, stored sorted without repeats, any set of
-- months (two seasons, over the new year), and the built-in plants' values.
begin;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'owner@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Spinach', 'partial_shade');

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

-- 1. A new plant has no seasons; the old range columns are gone.
do $$
begin
  if (select flowering_months <> '{}' or harvest_months <> '{}'
        from plants_catalog where id = 'e0000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: a new plant should start without seasons';
  end if;
  if exists (select 1 from information_schema.columns
              where table_name = 'plants_catalog' and column_name like 'flowering_%_month') then
    raise exception 'TEST FAILED: the old flowering range columns should be gone';
  end if;
end $$;

-- 2. Only months 1-12.
select pg_temp.expect_error(
  $$update plants_catalog set flowering_months = '{0,5}' where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_flowering_months');
select pg_temp.expect_error(
  $$update plants_catalog set harvest_months = '{13}' where id = 'e0000000-0000-0000-0000-000000000001'$$,
  'plants_catalog_harvest_months');

-- 3. Two seasons and the new year are fine; months are stored sorted, without repeats.
update plants_catalog set harvest_months = '{10,4,5,9,4}', flowering_months = '{12,1,2}'
 where id = 'e0000000-0000-0000-0000-000000000001';
do $$
begin
  if (select harvest_months from plants_catalog where id = 'e0000000-0000-0000-0000-000000000001') <> '{4,5,9,10}'::smallint[]
     or (select flowering_months from plants_catalog where id = 'e0000000-0000-0000-0000-000000000001') <> '{1,2,12}'::smallint[] then
    raise exception 'TEST FAILED: months should be stored sorted without repeats';
  end if;
end $$;

-- 4. The built-in plants' seasons.
do $$
begin
  if (select harvest_months from plants_catalog where id = 'a0000000-0000-0000-0000-000000000008') <> '{4,5,6,9,10}'::smallint[] then
    raise exception 'TEST FAILED: spinach is harvested in spring and autumn';
  end if;
  if (select (flowering_months, harvest_months) from plants_catalog where id = 'a0000000-0000-0000-0000-000000000001')
     <> ('{6,7,8}'::smallint[], '{7,8,9,10}'::smallint[]) then
    raise exception 'TEST FAILED: tomato flowers June-August and is harvested July-October';
  end if;
  if (select harvest_months from plants_catalog where id = 'a0000000-0000-0000-0000-000000000006') <> '{}' then
    raise exception 'TEST FAILED: marigold has no harvest';
  end if;
  if exists (select 1 from plants_catalog where user_id is null and flowering_months = '{}' and harvest_months = '{}') then
    raise exception 'TEST FAILED: every built-in plant should have a season';
  end if;
end $$;

rollback;
