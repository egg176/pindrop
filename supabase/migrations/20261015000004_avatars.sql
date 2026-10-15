-- PinDrop migration 4: profile pictures
--
-- NOTE: this setup was already applied directly to the live Supabase project.
-- This file records it so the repo can rebuild the database from scratch.
-- Every statement is idempotent, so running it on the live project again is harmless.
--
-- Design:
--   * Public bucket "avatars" (2 MB, png/jpg/webp). Public so avatars load fast without signed links.
--   * Files must live at "<user-id>/<random-uuid>.<png|jpg|webp>" and only the owner (with a
--     confirmed email) can upload into their own folder.
--   * profiles.avatar_url can NOT be changed straight from the API (profiles_guard blocks it).
--     The only way is set_my_avatar(), which checks the path and that the file really exists.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatars: upload to own folder" on storage.objects;
drop policy if exists "Avatars: read own files"       on storage.objects;
drop policy if exists "Avatars: delete own files"     on storage.objects;
drop policy if exists "Avatars: staff delete files"   on storage.objects;

create policy "Avatars: upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
    and (select public.is_email_confirmed())
  );

create policy "Avatars: read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Avatars: delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Avatars: staff delete files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (select public.current_user_role()) = any (array['moderator', 'admin', 'owner'])
  );

create or replace function public.set_my_avatar(new_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  if not (select public.is_email_confirmed()) then
    raise exception 'Please confirm your email first.' using errcode = '42501';
  end if;

  -- null = remove my avatar
  if new_path is not null then
    if new_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$'
       or split_part(new_path, '/', 1) <> caller::text then
      raise exception 'Invalid avatar path.' using errcode = '22023';
    end if;

    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'avatars' and o.name = new_path
    ) then
      raise exception 'Upload the image first.' using errcode = '22023';
    end if;
  end if;

  update public.profiles set avatar_url = new_path where id = caller;
end;
$$;

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;
