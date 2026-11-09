-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0001_rls.test.sql
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

insert into beds (user_id, name, rows, cols)
values ('11111111-1111-1111-1111-111111111111', 'User A Bed', 3, 3);

set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

do $$
begin
  if exists (select 1 from beds where name = 'User A Bed') then
    raise exception 'RLS FAILED: user B can see user A''s bed';
  end if;
end $$;

do $$
begin
  begin
    insert into beds (user_id, name, rows, cols)
    values ('11111111-1111-1111-1111-111111111111', 'Sneaky Bed', 2, 2);
    raise exception 'RLS FAILED: user B inserted a bed owned by user A';
  exception when others then
    if sqlerrm not like 'RLS FAILED%' then
      raise notice 'insert correctly rejected: %', sqlerrm;
    else
      raise;
    end if;
  end;
end $$;

rollback;
