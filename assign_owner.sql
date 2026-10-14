-- PinDrop: assign the OWNER role to the official PinDrop account.
--
-- Run this ONCE, by hand, in the Supabase SQL Editor (it runs as the
-- database owner, so the protections that stop normal users do not apply).
--
-- Before running:
--   1. Sign up on the PinDrop account page with YOUR OWN email address.
--   2. Click the confirmation link in the email you receive.
--   3. Replace the email below with that same address.
--
-- This script never creates an account and never sets a password.
-- Do not paste this into the website, and do not commit your real email
-- into a public repository.

do $$
declare
  owner_email constant text := 'REPLACE_WITH_YOUR_EMAIL';
  owner_id    uuid;
begin
  if owner_email = 'REPLACE_WITH_YOUR_EMAIL' then
    raise exception 'Edit owner_email at the top of this script first.';
  end if;

  select u.id into owner_id
  from auth.users u
  where lower(u.email) = lower(owner_email)
    and u.email_confirmed_at is not null;

  if owner_id is null then
    raise exception 'No user with a CONFIRMED email "%" exists yet. Sign up and confirm the email first.', owner_email;
  end if;

  if exists (select 1 from public.profiles where role = 'owner' and id <> owner_id) then
    raise exception 'A different owner already exists. Remove that role first if this is intentional.';
  end if;

  update public.profiles
     set role         = 'owner',
         is_verified  = true,
         verified_at  = now(),
         display_name = 'PinDrop',
         username     = 'pindrop'
   where id = owner_id;

  insert into public.admin_audit_log (actor_id, action, target_id, details)
  values (null, 'owner_assigned', owner_id, jsonb_build_object('via', 'sql_editor'));

  raise notice 'Done. % is now the PinDrop owner. Sign out and back in on the site to see it.', owner_email;
end
$$;

-- ---------------------------------------------------------------------------
-- Optional: make a trusted person an admin (can grant/remove checkmarks).
-- Uncomment, replace the email, and run in the SQL Editor.
-- ---------------------------------------------------------------------------
-- update public.profiles
--    set role = 'admin'
--  where id = (select id from auth.users where lower(email) = lower('admin@example.com') and email_confirmed_at is not null);
