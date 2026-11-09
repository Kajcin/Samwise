-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0002_seed_catalog.test.sql
-- The built-in catalog is readable by any signed-in user but not writable by them.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com');

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

do $$
declare
  plant_count int;
  rule_count int;
begin
  select count(*) into plant_count from plants_catalog where user_id is null;
  select count(*) into rule_count from care_rules;
  if plant_count <> 8 then
    raise exception 'SEED FAILED: expected 8 built-in plants visible, got %', plant_count;
  end if;
  if rule_count <> 22 then
    raise exception 'SEED FAILED: expected 22 built-in care rules visible, got %', rule_count;
  end if;
end $$;

do $$
declare
  changed int;
begin
  update plants_catalog set name = 'Hacked' where id = 'a0000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'RLS FAILED: a user modified a built-in plant';
  end if;
end $$;

rollback;
