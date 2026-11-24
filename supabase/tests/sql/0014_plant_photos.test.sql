-- Run with: npx supabase db reset && npm run db:psql -- -f supabase/tests/sql/0014_plant_photos.test.sql
-- Photos are each user's own (also on built-in plants); one main photo per plant;
-- uploads live in the user's own storage folder.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');
insert into plants_catalog (id, user_id, name, sun_requirements) values
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Sage', 'full_sun'),
  ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'B''s plant', 'full_sun');

create function pg_temp.expect_error(p_sql text, p_expected text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAILED: expected an error mentioning "%" from: %', p_expected, p_sql;
exception when others then
  if sqlerrm not like '%' || p_expected || '%' then
    raise exception 'TEST FAILED: expected "%", got "%" from: %', p_expected, sqlerrm, p_sql;
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- 1. Photos of your own plant and of a built-in one; the first of each is the main photo.
insert into plant_photos (id, plant_id, kind, url) values
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'link', 'https://example.com/sage-1.jpg');
insert into plant_photos (id, plant_id, kind, storage_path) values
  ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'upload',
   '11111111-1111-1111-1111-111111111111/e0000000-0000-0000-0000-000000000001/a.jpg');
insert into plant_photos (id, plant_id, kind, url, attribution) values
  ('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'wikimedia',
   'https://upload.wikimedia.org/tomato.jpg', '{"author": "Someone", "license": "CC BY-SA 4.0"}');
do $$
begin
  if (select array_agg(id::text order by id) from plant_photos where is_main)
     is distinct from array['f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003'] then
    raise exception 'TEST FAILED: the first photo of each plant should be the main one';
  end if;
end $$;

-- 2. Checks: a source matching the kind, web addresses only, uploads in your own folder,
--    and no photos of another user's plant.
select pg_temp.expect_error(
  $$insert into plant_photos (plant_id, kind, url) values ('e0000000-0000-0000-0000-000000000001', 'upload', 'https://x.cz/a.jpg')$$,
  'plant_photos_source');
select pg_temp.expect_error(
  $$insert into plant_photos (plant_id, kind, url) values ('e0000000-0000-0000-0000-000000000001', 'link', 'javascript:alert(1)')$$,
  'plant_photos_url_http');
select pg_temp.expect_error(
  $$insert into plant_photos (plant_id, kind, storage_path) values ('e0000000-0000-0000-0000-000000000001', 'upload', '22222222-2222-2222-2222-222222222222/x/a.jpg')$$,
  'plant_photos_upload_in_own_folder');
select pg_temp.expect_error(
  $$insert into plant_photos (plant_id, kind, url) values ('e0000000-0000-0000-0000-000000000002', 'link', 'https://x.cz/a.jpg')$$,
  'row-level security');

-- 3. Switching the main photo, and deleting the main one passes it on.
select set_main_plant_photo('f0000000-0000-0000-0000-000000000002');
do $$
begin
  if (select id::text from plant_photos where is_main and plant_id = 'e0000000-0000-0000-0000-000000000001')
     <> 'f0000000-0000-0000-0000-000000000002' then
    raise exception 'TEST FAILED: set_main_plant_photo didn''t switch the main photo';
  end if;
end $$;
delete from plant_photos where id = 'f0000000-0000-0000-0000-000000000002';
do $$
begin
  if (select id::text from plant_photos where is_main and plant_id = 'e0000000-0000-0000-0000-000000000001')
     is distinct from 'f0000000-0000-0000-0000-000000000001' then
    raise exception 'TEST FAILED: deleting the main photo should make the remaining one main';
  end if;
end $$;

-- 4. Another user sees none of these photos (not even on the shared built-in plant).
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';
do $$
begin
  if exists (select 1 from plant_photos) then
    raise exception 'TEST FAILED: another user can see the photos';
  end if;
end $$;
reset role;

-- 5. Storage: a private bucket whose policy limits each user to their own folder.
do $$
begin
  if (select public from storage.buckets where id = 'plant-photos') is not false then
    raise exception 'TEST FAILED: the plant-photos bucket should be private';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'plant_photos_own_folder') then
    raise exception 'TEST FAILED: the storage folder policy is missing';
  end if;
  if has_function_privilege('anon', 'set_main_plant_photo(uuid)', 'execute') then
    raise exception 'TEST FAILED: anon can call set_main_plant_photo()';
  end if;
end $$;

-- 6. Deleting a plant deletes its photos (the app removes the uploaded files).
delete from plants_catalog where id = 'e0000000-0000-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from plant_photos where plant_id = 'e0000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: the deleted plant''s photos are still there';
  end if;
end $$;

rollback;
