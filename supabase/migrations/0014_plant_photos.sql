-- Photos of plants: your own uploads (Supabase Storage), links to pictures elsewhere, and
-- Wikimedia Commons pictures found by the plant lookup (shown with their credit).
-- Photos are each user's own, also on built-in plants (the plant stays shared and
-- read-only; your photo of "Rajče" is yours alone). One of a user's photos of a plant
-- is its main photo.

create table plant_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plant_id uuid not null references plants_catalog(id) on delete cascade,
  kind text not null check (kind in ('upload', 'link', 'wikimedia')),
  -- upload: the file in the plant-photos bucket, "<user id>/<plant id>/<file>"
  storage_path text,
  -- link / wikimedia: where the picture is shown from (never copied)
  url text constraint plant_photos_url_http check (url ~* '^https?://\S+$'),
  -- wikimedia: { author, license, licenseUrl, sourceUrl } to credit the picture
  attribution jsonb,
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  constraint plant_photos_source check (
    case kind when 'upload' then storage_path is not null and url is null
              else url is not null and storage_path is null end
  ),
  constraint plant_photos_upload_in_own_folder check (
    storage_path is null or storage_path like user_id::text || '/%'
  )
);

create index plant_photos_by_plant on plant_photos (user_id, plant_id, created_at);
create unique index plant_photos_one_main on plant_photos (user_id, plant_id) where is_main;

alter table plant_photos enable row level security;

-- Your own photos, of plants you can see (built-in ones or your own).
create policy plant_photos_all on plant_photos
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from plants_catalog p where p.id = plant_id and (p.user_id is null or p.user_id = auth.uid()))
  );

revoke all on plant_photos from anon;

-- The first photo of a plant becomes its main photo; when the main photo is deleted, the
-- newest remaining one takes over.
create or replace function plant_photos_keep_main() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from plant_photos where user_id = new.user_id and plant_id = new.plant_id and is_main) then
      new.is_main := true;
    end if;
    return new;
  end if;
  -- DELETE of the main photo
  update plant_photos set is_main = true
   where id = (select id from plant_photos where user_id = old.user_id and plant_id = old.plant_id
                order by created_at desc limit 1);
  return old;
end;
$$;

create trigger plant_photos_before_insert_main
  before insert on plant_photos
  for each row execute function plant_photos_keep_main();

create trigger plant_photos_after_delete_main
  after delete on plant_photos
  for each row when (old.is_main)
  execute function plant_photos_keep_main();

-- Makes one of your photos the main photo of its plant, in one step (the unique index
-- allows one main photo per plant). Runs as the caller, so RLS applies.
create or replace function set_main_plant_photo(p_photo_id uuid) returns void
language sql
set search_path = public
as $$
  update plant_photos set is_main = false
   where is_main and (user_id, plant_id) = (select user_id, plant_id from plant_photos where id = p_photo_id);
  update plant_photos set is_main = true where id = p_photo_id;
$$;

revoke all on function set_main_plant_photo(uuid) from public, anon;
grant execute on function set_main_plant_photo(uuid) to authenticated;

-- --- Storage: the uploads ---------------------------------------------------------------
-- Private; each user reads and writes only their own folder ("<user id>/…"). Files are
-- shown through short-lived signed URLs. The app shrinks photos before uploading
-- (about 1600 px), so 5 MB is a generous cap.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plant-photos', 'plant-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy plant_photos_own_folder on storage.objects
  for all to authenticated
  using (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'plant-photos' and (storage.foldername(name))[1] = auth.uid()::text);
