# PinDrop test bot

Three clearly-labelled test accounts (**Nova**, **Pixel**, **Luna** "(test bot)") that
post a generated design every day, like each other's posts and leave short
comments. Use them to try out battles, tournaments and leaderboards with
realistic, changing data.

* Posts are marked with the tag `#testbot` and a description starting with `[Test bot]`.
* Bots **only** like/comment on posts made by other bots, never on real people's.
* Bot posts are published directly as *approved* (they skip the review queue).

## One-time setup

1. In **Supabase → Project Settings → API Keys**, copy the **secret** key
   (`sb_secret_…`, or the legacy `service_role` key). It has full access to your
   database, so treat it like a password.
2. In **GitHub → this repo → Settings → Secrets and variables → Actions → New repository secret** add:
   * `SUPABASE_URL` – your project URL (the same one as in `config.js`)
   * `SUPABASE_SERVICE_ROLE_KEY` – the secret key from step 1
3. Open the **Actions** tab → **Test bot** → **Run workflow** to make the first post.
   After that it runs by itself every day at 06:17 UTC.

**Never** put the secret key in `config.js` or any file in the repo.

## Everyday use

* **Run it now:** Actions → Test bot → Run workflow (you can ask for up to 10 posts).
* **Remove everything the bots made:** run the workflow with *action = cleanup*
  (tick *delete accounts* to remove the three bot accounts as well).
* **Stop the daily posts:** Actions → Test bot → ⋯ → Disable workflow.

## Trying it locally

```bash
cd bot
npm ci
npm run dry-run      # makes sample images in bot/out/, never touches Supabase
```

To post for real from your computer, set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in your terminal and run `npm run post`.
Options: `POSTS_PER_RUN` (1–10), `BOT_COUNT` (1–3), `ENGAGE=false`.
