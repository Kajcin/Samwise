-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0011_plant_lookup_cache.test.sql
-- The lookup cache is for the plant-lookup Edge Function (service role) only.
begin;

insert into plant_lookup_cache (key, candidates) values ('test:sql-test-only', '[]');

do $$
begin
  if has_table_privilege('anon', 'plant_lookup_cache', 'select')
     or has_table_privilege('authenticated', 'plant_lookup_cache', 'select')
     or has_table_privilege('authenticated', 'plant_lookup_cache', 'insert') then
    raise exception 'TEST FAILED: clients can read or write the lookup cache';
  end if;
end $$;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@example.com');
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';
do $$
begin
  perform 1 from plant_lookup_cache;
  raise exception 'TEST FAILED: a signed-in user read the lookup cache';
exception when insufficient_privilege then
  raise notice 'lookup cache correctly closed';
end $$;

rollback;
