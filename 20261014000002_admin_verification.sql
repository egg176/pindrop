-- PinDrop migration 2: audit log + admin-controlled creator verification
--
-- Verification is granted through the database function
-- public.admin_set_verification(). The function checks the caller's role
-- itself, so it cannot be bypassed from the browser, and it writes an audit
-- log entry for every change. No service-role key is needed anywhere.

-- ---------------------------------------------------------------------------
-- Audit log (readable by admins/owner only, written only by trusted functions)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references auth.users (id) on delete set null,
  action     text        not null,
  target_id  uuid references auth.users (id) on delete set null,
  details    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "Staff can read the audit log" on public.admin_audit_log;
create policy "Staff can read the audit log"
  on public.admin_audit_log for select
  to authenticated
  using (public.current_user_role() in ('admin', 'owner'));

revoke all on table public.admin_audit_log from anon, authenticated;
grant select on table public.admin_audit_log to authenticated;
-- No INSERT/UPDATE/DELETE grants: only SECURITY DEFINER functions write here.

-- ---------------------------------------------------------------------------
-- Grant or remove the blue checkmark
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_verification(
  target_id     uuid,
  make_verified boolean,
  reason        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller      uuid := (select auth.uid());
  caller_role text;
  target_role text;
begin
  if caller is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  if target_id is null or make_verified is null then
    raise exception 'Missing target or verification value.' using errcode = '22023';
  end if;

  if reason is not null and char_length(reason) > 300 then
    raise exception 'Reason is too long (300 characters max).' using errcode = '22023';
  end if;

  select p.role into caller_role from public.profiles p where p.id = caller;
  if caller_role is null or caller_role not in ('admin', 'owner') then
    raise exception 'Only PinDrop admins can change verification.' using errcode = '42501';
  end if;

  -- Nobody can grant themselves the checkmark (the owner is verified by definition).
  if target_id = caller and caller_role <> 'owner' then
    raise exception 'You cannot change your own verification.' using errcode = '42501';
  end if;

  select p.role into target_role from public.profiles p where p.id = target_id for update;
  if not found then
    raise exception 'That user does not exist.' using errcode = 'P0002';
  end if;

  if target_role = 'owner' then
    raise exception 'The owner account is always verified.' using errcode = '42501';
  end if;

  update public.profiles
     set is_verified = make_verified,
         verified_at = case when make_verified then now() else null end
   where id = target_id;

  insert into public.admin_audit_log (actor_id, action, target_id, details)
  values (
    caller,
    case when make_verified then 'verification_granted' else 'verification_removed' end,
    target_id,
    jsonb_build_object('reason', reason, 'actor_role', caller_role)
  );
end;
$$;

revoke all on function public.admin_set_verification(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_verification(uuid, boolean, text) to authenticated;
