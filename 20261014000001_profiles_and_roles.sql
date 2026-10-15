-- PinDrop migration 1: profiles, roles and protected fields
--
-- What this does
--   * Creates public.profiles (one row per auth user, created automatically).
--   * Adds role + is_verified columns that ordinary users can NEVER change.
--   * Turns on Row Level Security and column-level privileges.
--   * Adds a guard trigger as a second layer of defence.
--
-- Run this in the Supabase SQL Editor (or with `supabase db push`).
-- It is safe to read top to bottom; nothing here needs a secret.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique,
  display_name text        not null default 'New creator',
  bio          text        not null default '',
  avatar_url   text,                         -- set only by the future moderated upload flow
  role         text        not null default 'user',
  is_verified  boolean     not null default false,
  verified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_username_format
    check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length
    check (char_length(btrim(display_name)) between 1 and 50),
  constraint profiles_bio_length
    check (char_length(bio) <= 300),
  constraint profiles_role_valid
    check (role in ('user', 'moderator', 'admin', 'owner')),
  -- The official owner account is always verified.
  constraint profiles_owner_verified
    check (role <> 'owner' or is_verified)
);

-- At most one owner can ever exist.
create unique index if not exists profiles_single_owner
  on public.profiles ((role)) where role = 'owner';

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER, empty search_path, explicit grants)
-- ---------------------------------------------------------------------------

-- True when the signed-in user's email address has been confirmed.
create or replace function public.is_email_confirmed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;

-- The role of the signed-in user ('user' | 'moderator' | 'admin' | 'owner'), or null.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

revoke all on function public.is_email_confirmed() from public, anon;
revoke all on function public.current_user_role()  from public, anon;
grant execute on function public.is_email_confirmed() to authenticated;
grant execute on function public.current_user_role()  to authenticated;

-- ---------------------------------------------------------------------------
-- Create a profile automatically when someone signs up
-- ---------------------------------------------------------------------------
-- IMPORTANT: role and is_verified are never read from user metadata, because
-- metadata is controlled by the person signing up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dn text;
begin
  dn := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 50);
  if char_length(dn) < 1 or dn ilike '%pindrop%' then
    dn := 'New creator';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, dn);

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any users that already exist.
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Guard trigger: second layer of defence for protected fields
-- ---------------------------------------------------------------------------
-- Column privileges below already stop clients from touching protected
-- columns. This trigger makes the rule explicit and also reserves official
-- usernames and display names. It only restricts the 'anon' and
-- 'authenticated' API roles; the SQL editor, the service role and our
-- SECURITY DEFINER admin functions are not affected.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  caller_role text;
  reserved    text[] := array[
    'pindrop','official','admin','administrator','moderator','mod','support',
    'staff','team','help','security','root','system','owner','verified',
    'api','null','undefined'
  ];
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.id          is distinct from old.id
  or new.role        is distinct from old.role
  or new.is_verified is distinct from old.is_verified
  or new.verified_at is distinct from old.verified_at
  or new.avatar_url  is distinct from old.avatar_url
  or new.created_at  is distinct from old.created_at then
    raise exception 'These profile fields can only be changed by the PinDrop team.'
      using errcode = '42501';
  end if;

  select p.role into caller_role
  from public.profiles p
  where p.id = (select auth.uid());

  if coalesce(caller_role, 'user') not in ('admin', 'owner') then
    if new.username is not null
       and new.username is distinct from old.username
       and (new.username = any (reserved) or new.username like '%pindrop%') then
      raise exception 'That username is reserved.';
    end if;

    if new.display_name is distinct from old.display_name
       and new.display_name ilike '%pindrop%' then
      raise exception 'Display names containing "PinDrop" are reserved for the official account.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------------
-- Row Level Security + privileges
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "Profiles are public"            on public.profiles;
drop policy if exists "Users update their own profile" on public.profiles;

create policy "Profiles are public"
  on public.profiles for select
  to anon, authenticated
  using (true);

-- Only your own row, and only once your email is confirmed.
create policy "Users update their own profile"
  on public.profiles for update
  to authenticated
  using      (id = (select auth.uid()) and public.is_email_confirmed())
  with check (id = (select auth.uid()));

-- No client INSERT or DELETE policies exist, so clients cannot create or
-- delete profiles. Start from zero privileges, then grant only what is needed.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to anon, authenticated;
grant update (display_name, username, bio) on table public.profiles to authenticated;
-- role, is_verified, verified_at and avatar_url are deliberately NOT grantable.
