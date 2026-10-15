-- PinDrop migration 3: posts, likes, comments and private design storage
--
-- Approval-first: every new post starts as 'pending' and is only visible to
-- its author and staff (moderator/admin/owner) until a staff member approves it.
-- Clients can never set status or counts: those columns are not grantable, and
-- moderation goes through public.moderate_post(), which checks the caller's role
-- and writes to admin_audit_log.

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
create table if not exists public.posts (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid        not null references public.profiles (id) on delete cascade,
  title           text        not null,
  description     text        not null default '',
  category        text        not null,
  tags            text[]      not null default '{}',
  open_to_battles boolean     not null default false,
  image_path      text        not null,
  status          text        not null default 'pending',
  reviewed_by     uuid references auth.users (id) on delete set null,
  reviewed_at     timestamptz,
  like_count      integer     not null default 0,
  comment_count   integer     not null default 0,
  created_at      timestamptz not null default now(),

  constraint posts_title_length    check (char_length(btrim(title)) between 1 and 80),
  constraint posts_description_len check (char_length(description) <= 500),
  constraint posts_category_valid  check (category in
    ('Posters','Logos','Branding','Typography','UI/UX','Illustration','Photo Manipulation','Other')),
  constraint posts_tags_valid      check (cardinality(tags) <= 8),
  constraint posts_status_valid    check (status in ('pending','approved','rejected')),
  constraint posts_counts_valid    check (like_count >= 0 and comment_count >= 0),
  -- Images live in the author's own folder: <author uuid>/<uuid>.<ext>
  constraint posts_image_path_valid check (
    image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$'
    and split_part(image_path, '/', 1) = author_id::text
  )
);

create index if not exists posts_status_created_idx on public.posts (status, created_at desc);
create index if not exists posts_author_idx         on public.posts (author_id, created_at desc);
create index if not exists posts_reviewed_by_idx    on public.posts (reviewed_by);

alter table public.posts enable row level security;

drop policy if exists "Approved posts are public"     on public.posts;
drop policy if exists "Authors see their own posts"   on public.posts;
drop policy if exists "Staff see all posts"           on public.posts;
drop policy if exists "Confirmed users create posts"  on public.posts;
drop policy if exists "Authors delete their own posts" on public.posts;
drop policy if exists "Staff delete posts"            on public.posts;

-- Separate policies per role so 'anon' never evaluates the helper functions.
create policy "Approved posts are public"
  on public.posts for select
  to anon, authenticated
  using (status = 'approved');

create policy "Authors see their own posts"
  on public.posts for select
  to authenticated
  using (author_id = (select auth.uid()));

create policy "Staff see all posts"
  on public.posts for select
  to authenticated
  using ((select public.current_user_role()) in ('moderator', 'admin', 'owner'));

create policy "Confirmed users create posts"
  on public.posts for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and status = 'pending'
    and (select public.is_email_confirmed())
  );

create policy "Authors delete their own posts"
  on public.posts for delete
  to authenticated
  using (author_id = (select auth.uid()));

create policy "Staff delete posts"
  on public.posts for delete
  to authenticated
  using ((select public.current_user_role()) in ('moderator', 'admin', 'owner'));

-- No UPDATE grant at all: editing after approval would bypass moderation, and
-- status/counts must only change through trusted functions and triggers.
revoke all on table public.posts from anon, authenticated;
grant select on table public.posts to anon, authenticated;
grant insert (author_id, title, description, category, tags, open_to_battles, image_path)
  on table public.posts to authenticated;
grant delete on table public.posts to authenticated;

-- ---------------------------------------------------------------------------
-- likes
-- ---------------------------------------------------------------------------
create table if not exists public.likes (
  post_id    uuid        not null references public.posts (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists likes_user_idx on public.likes (user_id);

alter table public.likes enable row level security;

drop policy if exists "Users see their own likes"   on public.likes;
drop policy if exists "Users like approved posts"   on public.likes;
drop policy if exists "Users remove their own likes" on public.likes;

create policy "Users see their own likes"
  on public.likes for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users like approved posts"
  on public.likes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_email_confirmed())
    and exists (select 1 from public.posts p where p.id = post_id and p.status = 'approved')
  );

create policy "Users remove their own likes"
  on public.likes for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.likes from anon, authenticated;
grant select, delete on table public.likes to authenticated;
grant insert (post_id, user_id) on table public.likes to authenticated;

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid        not null references public.posts (id) on delete cascade,
  author_id  uuid        not null references public.profiles (id) on delete cascade,
  body       text        not null,
  created_at timestamptz not null default now(),
  constraint comments_body_length check (char_length(btrim(body)) between 1 and 500)
);

create index if not exists comments_post_idx   on public.comments (post_id, created_at);
create index if not exists comments_author_idx on public.comments (author_id);

alter table public.comments enable row level security;

drop policy if exists "Comments on approved posts are public" on public.comments;
drop policy if exists "Users comment on approved posts"       on public.comments;
drop policy if exists "Authors delete their own comments"     on public.comments;
drop policy if exists "Staff delete comments"                 on public.comments;

create policy "Comments on approved posts are public"
  on public.comments for select
  to anon, authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.status = 'approved'));

create policy "Users comment on approved posts"
  on public.comments for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and (select public.is_email_confirmed())
    and exists (select 1 from public.posts p where p.id = post_id and p.status = 'approved')
  );

create policy "Authors delete their own comments"
  on public.comments for delete
  to authenticated
  using (author_id = (select auth.uid()));

create policy "Staff delete comments"
  on public.comments for delete
  to authenticated
  using ((select public.current_user_role()) in ('moderator', 'admin', 'owner'));

revoke all on table public.comments from anon, authenticated;
grant select on table public.comments to anon, authenticated;
grant delete on table public.comments to authenticated;
grant insert (post_id, author_id, body) on table public.comments to authenticated;

-- ---------------------------------------------------------------------------
-- Keep like_count / comment_count correct (database-side, not from the browser)
-- ---------------------------------------------------------------------------
create or replace function public.bump_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set like_count = like_count + 1 where id = new.post_id;
  else
    update public.posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

create or replace function public.bump_comment_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set comment_count = comment_count + 1 where id = new.post_id;
  else
    update public.posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

revoke all on function public.bump_like_count()    from public, anon, authenticated;
revoke all on function public.bump_comment_count() from public, anon, authenticated;

drop trigger if exists likes_bump_count on public.likes;
create trigger likes_bump_count
  after insert or delete on public.likes
  for each row execute function public.bump_like_count();

drop trigger if exists comments_bump_count on public.comments;
create trigger comments_bump_count
  after insert or delete on public.comments
  for each row execute function public.bump_comment_count();

-- ---------------------------------------------------------------------------
-- Moderation: approve / reject / send back to pending
-- ---------------------------------------------------------------------------
create or replace function public.moderate_post(
  target_post uuid,
  new_status  text,
  reason      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller      uuid := (select auth.uid());
  caller_role text;
  post_author uuid;
begin
  if caller is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  if target_post is null or new_status not in ('approved', 'rejected', 'pending') then
    raise exception 'Invalid post or status.' using errcode = '22023';
  end if;

  if reason is not null and char_length(reason) > 300 then
    raise exception 'Reason is too long (300 characters max).' using errcode = '22023';
  end if;

  select p.role into caller_role from public.profiles p where p.id = caller;
  if caller_role is null or caller_role not in ('moderator', 'admin', 'owner') then
    raise exception 'Only PinDrop staff can review posts.' using errcode = '42501';
  end if;

  select p.author_id into post_author from public.posts p where p.id = target_post for update;
  if not found then
    raise exception 'That post does not exist.' using errcode = 'P0002';
  end if;

  -- Only the owner may review their own work.
  if post_author = caller and caller_role <> 'owner' then
    raise exception 'You cannot review your own post.' using errcode = '42501';
  end if;

  update public.posts
     set status      = new_status,
         reviewed_by = caller,
         reviewed_at = now()
   where id = target_post;

  insert into public.admin_audit_log (actor_id, action, target_id, details)
  values (
    caller,
    'post_' || new_status,
    post_author,
    jsonb_build_object('post_id', target_post, 'reason', reason, 'actor_role', caller_role)
  );
end;
$$;

revoke all on function public.moderate_post(uuid, text, text) from public, anon;
grant execute on function public.moderate_post(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private 'designs' bucket
-- ---------------------------------------------------------------------------
-- Private on purpose: a pending image must not be reachable by guessing its
-- URL. The site asks for short-lived signed URLs, which storage only issues for
-- objects the caller is allowed to read (policies below).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'designs', 'designs', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Designs: upload to own folder"        on storage.objects;
drop policy if exists "Designs: read approved images"        on storage.objects;
drop policy if exists "Designs: read own images"             on storage.objects;
drop policy if exists "Designs: staff read all images"       on storage.objects;
drop policy if exists "Designs: delete own images"           on storage.objects;
drop policy if exists "Designs: staff delete images"         on storage.objects;

create policy "Designs: upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'designs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_email_confirmed())
  );

create policy "Designs: read approved images"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'designs'
    and exists (
      select 1 from public.posts p
      where p.image_path = name and p.status = 'approved'
    )
  );

create policy "Designs: read own images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'designs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Designs: staff read all images"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'designs'
    and (select public.current_user_role()) in ('moderator', 'admin', 'owner')
  );

create policy "Designs: delete own images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'designs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Designs: staff delete images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'designs'
    and (select public.current_user_role()) in ('moderator', 'admin', 'owner')
  );
