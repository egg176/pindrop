# PinDrop

A social platform for graphic designers. White and blue, clean, minimal and mobile-first.

**Current stage: Stage 1 (accounts) + the first part of Stage 3 (real posts, likes and comments).**
Posts are approval-first: a new design is only visible to its author and staff until a moderator/admin/owner approves it. Automated image screening, reporting, blocking, follows and tournament voting are *not* built yet (see [Roadmap](#roadmap)).

> **Status honesty note:** the code for accounts is written, but it has not yet been run against *your* Supabase project. Work through the [setup](#1-set-up-supabase) and the [test checklist](#5-test-checklist) below before relying on any of it.

---

## What's in Stage 1

| Feature | Where |
| --- | --- |
| Email/password sign-up | `account.html`, `account.js` |
| Email confirmation required before use | Supabase "Confirm email" setting + RLS check (`is_email_confirmed()`) |
| Sign-in, sign-out, persistent sessions | `auth.js`, `account.js` |
| Password reset by email | `account.js` (reset + "choose new password" screens) |
| Profiles: display name, username, bio, profile picture | `profiles` table, account page, `avatar-editor.js` |
| Roles: `user`, `moderator`, `admin`, `owner` | `profiles.role` |
| Protected official **owner** role | `supabase/scripts/assign_owner.sql` (SQL editor only) |
| Blue verified checkmark users can't grant themselves | `profiles.is_verified` + `admin_set_verification()` |
| Admin verification panel | Account page (only shown to admins; enforced in the database) |
| Audit log of verification/owner changes | `admin_audit_log` table |

## What's in the posts update

| Feature | Where |
| --- | --- |
| Upload a design (PNG/JPG/WEBP/GIF, max 10 MB) to a **private** storage bucket | `create.html`, `create.js`, bucket `designs` |
| Posts start as `pending`; only approved posts are public | `posts` table + RLS |
| Real feed with likes and comments shared between users | `feed.js`, `likes`, `comments` tables |
| Like/comment counts kept by database triggers (can't be faked from the browser) | `bump_like_count()`, `bump_comment_count()` |
| "Your designs" list with review status and delete | `account.html`, `myposts.js` |
| Staff review queue (approve / reject with a reason, audit-logged) | Account page, `moderate_post()` |
| Security headers + Content Security Policy for Vercel | `vercel.json` |

Images are never public by URL: the site requests short-lived signed links, and storage only issues one when the post is approved, or the caller is the author or staff.

## Project layout

```
index.html  create.html  explore.html  battles.html  tournaments.html  profile.html   existing pages
account.html / account.js        NEW  sign up, sign in, reset, profile, admin verification
auth.js                          NEW  shared Supabase client + signed-in state for every page
config.js / config.example.js    NEW  public Supabase URL + publishable key
app.js  create.js  styles.css    existing, lightly updated
supabase/migrations/             NEW  database setup (run in order)
  20261014000001_profiles_and_roles.sql
  20261014000002_admin_verification.sql
  20261015000003_posts_likes_comments.sql   posts, likes, comments, moderate_post(), private image bucket
  20261015000004_avatars.sql                public avatars bucket, upload rules, set_my_avatar()
avatar-editor.js                 NEW  profile picture crop + upload on the account page
assets/                          NEW  logo + favicons
feed.js                          NEW  feed, likes and comments on the home page
myposts.js                       NEW  "Your designs" + staff review queue on the account page
vercel.json                      NEW  security headers / CSP for Vercel
supabase/scripts/assign_owner.sql NEW  one-time owner assignment (run by hand)
```

---

## 1. Set up Supabase

1. Create a free account at <https://supabase.com> and click **New project**. Pick a region near your users and save the database password in a password manager (the site never needs it).
2. When the project is ready, open **Project Settings → API** (or **API Keys**) and copy:
   - the **Project URL**
   - the **publishable key** (`sb_publishable_...`) – or the legacy **anon** key if your project still shows that.
   
   Do **not** use the `service_role` / `sb_secret_...` key anywhere in this site. `auth.js` refuses to start if it detects one.
3. Open **Authentication** and configure:
   - **Sign In / Providers → Email**: keep *Enable email provider* on and **Confirm email** **on**. This is what stops unconfirmed accounts from getting a session.
   - Set the **minimum password length** to 8 or more.
   - **URL Configuration**: set **Site URL** to where the site is served (for local testing `http://localhost:8000`), and add these to **Redirect URLs**:
     - `http://localhost:8000/account.html`
     - your production address, e.g. `https://your-domain.com/account.html`
     
     Confirmation and reset links will fail if the page isn't in this list. Use `localhost` consistently (not `127.0.0.1`).
   - Supabase's built-in email sender is heavily rate-limited and meant for testing. Before launch, add your own **SMTP provider** under Authentication → SMTP settings.
   - Menu names change occasionally; if one isn't where described, search the dashboard for it.

## 2. Create the database tables and security rules

Open **SQL Editor → New query** and run these files **in order**, pasting each in full:

1. `supabase/migrations/20261014000001_profiles_and_roles.sql`
2. `supabase/migrations/20261014000002_admin_verification.sql`
3. `supabase/migrations/20261015000003_posts_likes_comments.sql`

Or, with the [Supabase CLI](https://supabase.com/docs/guides/cli): `supabase login`, `supabase link --project-ref <ref>`, then `supabase db push`.

What they set up:

- `profiles` – one row per user, created automatically by a trigger on sign-up. `role` and `is_verified` are always set by the database, **never** from anything the user submits.
- **Row Level Security** – anyone can read profiles; a signed-in user can update only their own row, only after confirming their email, and only the columns `display_name`, `username` and `bio`.
- A **guard trigger** that rejects attempts to change `role`, `is_verified`, `verified_at`, `avatar_url` or `id` from the API, and reserves names such as `pindrop`, `admin` and `official`.
- `admin_set_verification()` – a database function that checks the caller is an admin/owner, blocks self-verification, and writes to `admin_audit_log`.

## 3. Connect the website

Edit `config.js`:

```js
window.PINDROP_CONFIG = {
  supabaseUrl: "https://your-project-ref.supabase.co",
  supabaseKey: "sb_publishable_xxxxxxxx"
};
```

Only the project URL and the publishable/anon key go here. These are designed to be public; your security comes from the database rules above.

Run locally (any static server works):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` by double-click will *not* work for sign-in because the email links need a real `http://` address.

The Supabase library is loaded from the jsDelivr CDN (`@supabase/supabase-js@2`). For production, consider self-hosting a pinned version or adding a Subresource Integrity hash.

## 4. Create the official PinDrop owner account

I can't (and shouldn't) create this account for you; it must be yours.

1. On the site, open **Account → Create account** and sign up with **your own email** and a strong, unique password.
2. Click the confirmation link in the email. Then check you can sign in.
3. In Supabase **SQL Editor**, open `supabase/scripts/assign_owner.sql`, replace `REPLACE_WITH_YOUR_EMAIL` with that same address, and run it once.
4. Sign out and back in on the site. Your profile now shows the **Official owner** chip and the blue ✓, with the name `PinDrop` and username `@pindrop`.

Why this is safe: the owner role can only be assigned through the SQL editor (which only the project owner can open). The website, the API and every other user are blocked from setting it, and a database index allows only one owner to exist.

To make a trusted person an **admin** (able to verify creators), see the commented snippet at the bottom of `assign_owner.sql`. Dedicated moderator invitations come with the admin dashboard in Stage 2.

### Granting the blue checkmark to a creator

Sign in as the owner or an admin → **Account → Creator verification** → enter the creator's username → **Look up** → **Grant verification**. The change is recorded in `admin_audit_log` (visible to admins in the Supabase table editor or via SQL).

You can also do it in SQL: `select public.admin_set_verification('<user-uuid>', true, 'reason');` works only when run as an admin/owner session; from the SQL editor, update `profiles.is_verified` directly instead.

## 5. Test checklist

Do these after setup. Nothing here has been run against a live project yet.

- [ ] Sign up with a test email → "check your inbox" message appears.
- [ ] You cannot sign in before confirming (message says to confirm your email).
- [ ] Confirm link opens `account.html` and you are signed in.
- [ ] Refresh the page / close and reopen the browser → still signed in.
- [ ] Sign out → signed-out view; sign in again works.
- [ ] Wrong password → "Incorrect email or password."
- [ ] "Forgot password?" → email arrives → link lets you set a new password → sign in with it.
- [ ] Save a display name, username and bio; reload to see them persist. Try a taken username (should say it's taken) and `admin` (should be reserved).
- [ ] In the browser console, try `await PinDropAuth.client.from('profiles').update({ is_verified: true, role: 'owner' }).eq('id', '<your id>')` → must fail with a permission error.
- [ ] `await PinDropAuth.client.rpc('admin_set_verification', { target_id: '<your id>', make_verified: true })` as a normal user → must fail ("Only PinDrop admins…").
- [ ] After `assign_owner.sql`: owner sees the ✓ and the Creator verification panel; verifying a second test account works; that account's own attempt to un-verify/verify itself via the console fails.

## Security notes

- Only the project URL and publishable/anon key are in the browser. No secrets exist in this repo.
- Role and verification checks happen in Postgres (RLS, column privileges, a guard trigger, and a `SECURITY DEFINER` function with an empty `search_path`). The "admin panel" in the browser is only a convenience.
- Sign-up and password-reset messages are worded so they don't reveal whether an email is registered.
- All profile text is rendered with `textContent`, never as HTML.
- Role names are publicly readable (so badges can show). Nothing sensitive is stored in `profiles`.
- Display names/usernames containing "PinDrop" are reserved so nobody can imitate the official account. The blue ✓ is the real signal of authenticity.
- Because email confirmation is on, unconfirmed users can't obtain a session at all; the RLS policy additionally checks confirmation as a second layer.

## Known limitations at this stage

- Follows are still a browser-only demo, and Explore, Profile, Battles and Tournaments still show sample content.
- The feed loads the 30 newest approved posts; there is no "load more" yet.
- Posts can't be edited after submitting (editing would bypass review); delete and repost instead.
- Profile pictures are public as soon as they are uploaded (posts are reviewed first, avatars are not). Staff can delete a file from the `avatars` bucket; a report/review flow for avatars is part of Stage 2.
- Moderation is manual only: no automated image/text screening, reporting, blocking, suspensions or appeals yet. Do this before opening the site to the public.
- No rate limits on posting, liking or commenting yet.
- `[hidden]` is now enforced globally in `styles.css` (this also fixes the upload box staying visible after choosing an image on the create page).
- No automated tests exist yet; verify with the checklist above.

## Roadmap

1. **Stage 1 (done)** – accounts, profiles, owner role, verification foundation.
   **Stage 3a (this update)** – real posts, likes, comments, manual approval queue.
2. **Stage 2 – Moderation** – text + image screening (OpenAI Moderation API as one layer, run server-side in an Edge Function with its key as a Supabase secret), private-by-default pending review, admin review queue, reports, blocking, warnings/suspensions/bans/appeals, moderator invitations, audit logging, access-controlled storage, child-safety procedures.
3. **Stage 3 – Social + tournaments** – database-backed feed, likes, comments, follows; one-vote-per-user-per-battle enforced in the database, server-side winner calculation, rate limits and suspicious-vote review.

## Brand

- Name: PinDrop · Logo: `assets/logo-128.png` (white lowercase `p` in a blue circle) · Main blue `#246BFD` · White / soft gray backgrounds.
