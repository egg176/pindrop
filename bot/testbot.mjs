// PinDrop test bots
//
// Creates a few clearly-labelled test accounts and makes them post designs,
// like each other's posts and leave comments, so features such as battles and
// tournaments can be tried with realistic, changing data.
//
//   node testbot.mjs post [--dry-run]      create new posts (+ likes/comments)
//   node testbot.mjs cleanup [--delete-users]   remove everything the bots made
//
// Needs two environment variables (set as GitHub Actions secrets, never in code):
//   SUPABASE_URL                e.g. https://abcdefgh.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   the *secret* key. Full database access: keep it private.
//
// Optional: POSTS_PER_RUN (1-10, default 1), BOT_COUNT (1-3, default 3),
//           ENGAGE=false to skip bot-to-bot likes and comments.
//
// Safety: bots are identified by BOTH a "testbot_" username and a
// "testbot-*@example.com" email, so real accounts are never touched. Bots only
// like/comment on posts made by other bots, never on real people's posts.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// ------------------------------------------------------------------ config
const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith("--")) || "post";
const DRY_RUN = args.includes("--dry-run");
const DELETE_USERS = args.includes("--delete-users");

function intFromEnv(name, min, max, fallback) {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
const POSTS_PER_RUN = intFromEnv("POSTS_PER_RUN", 1, 10, 1);
const ENGAGE = (process.env.ENGAGE ?? "true").toLowerCase() !== "false";

const ALL_BOTS = [
  { key: "nova", display: "Nova (test bot)" },
  { key: "pixel", display: "Pixel (test bot)" },
  { key: "luna", display: "Luna (test bot)" }
].map(b => ({ ...b, username: `testbot_${b.key}`, email: `testbot-${b.key}@example.com` }));
const BOTS = ALL_BOTS.slice(0, intFromEnv("BOT_COUNT", 1, ALL_BOTS.length, ALL_BOTS.length));

const BUCKET = "designs";
const isBotEmail = email => /^testbot-[a-z]+@example\.com$/.test(String(email || ""));

// ------------------------------------------------------------------ helpers
function rngFrom(seed) {                       // small seeded PRNG (mulberry32)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

// ------------------------------------------------------------ design maker
const PALETTES = [
  { name: "ocean",   bg: "#0b2a6f", fg: "#ffffff", accent: "#5fa2ff", soft: "#dbe8ff" },
  { name: "sunset",  bg: "#ff6a3d", fg: "#2a0f3b", accent: "#ffd36b", soft: "#ffe9d6" },
  { name: "forest",  bg: "#12372a", fg: "#f1f7ee", accent: "#8bd17c", soft: "#dcefd6" },
  { name: "berry",   bg: "#5b1456", fg: "#fff3fb", accent: "#ff7ac6", soft: "#fbd9ee" },
  { name: "sand",    bg: "#f3e7d3", fg: "#2b2118", accent: "#c8553d", soft: "#fff9ef" },
  { name: "mono",    bg: "#111111", fg: "#f5f5f5", accent: "#9a9a9a", soft: "#e6e6e6" },
  { name: "mint",    bg: "#d9f5ea", fg: "#0d3b2e", accent: "#1fae7f", soft: "#f4fffa" },
  { name: "violet",  bg: "#2b1a6b", fg: "#f3eeff", accent: "#b69cff", soft: "#e4dbff" }
];
const ADJECTIVES = ["Neon", "Quiet", "Golden", "Midnight", "Paper", "Solar", "Velvet", "Concrete", "Electric", "Soft", "Wild", "Northern"];
const NOUNS = ["Skyline", "Echo", "Harbor", "Bloom", "Signal", "Orbit", "Garden", "Pulse", "Atlas", "Drift", "Canvas", "Summit"];
const FONT = "DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif";

function svgFrame(w, h, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">${inner}</svg>`;
}

const TEMPLATES = {
  Posters(rng, p, title) {
    const [w, h] = [1000, 1400];
    const [first, ...rest] = title.toUpperCase().split(" ");
    let shapes = "";
    for (let i = 0; i < 5; i++) {
      const r = 80 + rng() * 240;
      shapes += `<circle cx="${rng() * w}" cy="${600 + rng() * 700}" r="${r}" fill="${i % 2 ? p.accent : p.soft}" opacity="${0.25 + rng() * 0.4}"/>`;
    }
    return { w, h, svg: svgFrame(w, h, `
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.accent}"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}
      <text x="70" y="250" font-size="190" font-weight="800" fill="${p.fg}">${esc(first)}</text>
      <text x="70" y="420" font-size="190" font-weight="800" fill="${p.fg}" opacity=".85">${esc(rest.join(" "))}</text>
      <rect x="70" y="${h - 200}" width="${w - 140}" height="4" fill="${p.fg}"/>
      <text x="70" y="${h - 130}" font-size="34" letter-spacing="8" fill="${p.fg}">PINDROP TEST BOT · POSTER</text>`) };
  },
  Logos(rng, p, title) {
    const [w, h] = [1200, 1200];
    const letter = title[0].toUpperCase();
    const shape = pick(rng, ["circle", "square", "diamond"]);
    const mark = shape === "circle"
      ? `<circle cx="600" cy="480" r="230" fill="${p.bg}"/>`
      : shape === "square"
        ? `<rect x="370" y="250" width="460" height="460" rx="70" fill="${p.bg}"/>`
        : `<rect x="370" y="250" width="460" height="460" rx="40" fill="${p.bg}" transform="rotate(45 600 480)"/>`;
    return { w, h, svg: svgFrame(w, h, `
      <rect width="${w}" height="${h}" fill="${p.soft}"/>${mark}
      <text x="600" y="560" font-size="300" font-weight="800" text-anchor="middle" fill="${p.fg}">${esc(letter)}</text>
      <circle cx="${shape === "circle" ? 760 : 790}" cy="${shape === "circle" ? 330 : 290}" r="34" fill="${p.accent}"/>
      <text x="600" y="900" font-size="96" font-weight="800" text-anchor="middle" fill="${p.bg}">${esc(title.toLowerCase())}</text>
      <text x="600" y="980" font-size="30" letter-spacing="10" text-anchor="middle" fill="${p.bg}" opacity=".6">TEST BOT LOGO</text>`) };
  },
  Typography(rng, p, title) {
    const [w, h] = [1400, 1000];
    const word = title.split(" ")[0].toUpperCase();
    return { w, h, svg: svgFrame(w, h, `
      <rect width="${w}" height="${h}" fill="${p.bg}"/>
      <text x="80" y="560" font-size="420" font-weight="800" fill="none" stroke="${p.accent}" stroke-width="5">${esc(word)}</text>
      <text x="100" y="580" font-size="420" font-weight="800" fill="${p.fg}" opacity=".92">${esc(word)}</text>
      <text x="100" y="800" font-size="64" fill="${p.fg}" opacity=".8">${esc(title)} — a type study</text>
      <text x="100" y="880" font-size="30" letter-spacing="8" fill="${p.accent}">AaBbCc 0123456789</text>`) };
  },
  Branding(rng, p, title) {
    const [w, h] = [1200, 1200];
    const swatches = [p.bg, p.accent, p.soft, p.fg, p.bg].map((c, i) =>
      `<rect x="${90 + i * 200}" y="760" width="180" height="260" rx="20" fill="${c}" stroke="#00000022"/>`).join("");
    return { w, h, svg: svgFrame(w, h, `
      <rect width="${w}" height="${h}" fill="${p.soft}"/>
      <rect x="90" y="90" width="1020" height="560" rx="36" fill="${p.bg}"/>
      <circle cx="260" cy="370" r="110" fill="${p.accent}"/>
      <text x="420" y="395" font-size="110" font-weight="800" fill="${p.fg}">${esc(title.split(" ")[0])}</text>
      <text x="424" y="470" font-size="40" letter-spacing="10" fill="${p.fg}" opacity=".75">BRAND IDENTITY</text>${swatches}`) };
  },
  "UI/UX"(rng, p, title) {
    const [w, h] = [1400, 1000];
    const bars = Array.from({ length: 8 }, (_, i) => {
      const bh = 80 + rng() * 260;
      return `<rect x="${150 + i * 70}" y="${820 - bh}" width="44" height="${bh}" rx="10" fill="${i % 3 ? p.accent : p.bg}"/>`;
    }).join("");
    return { w, h, svg: svgFrame(w, h, `
      <rect width="${w}" height="${h}" fill="${p.soft}"/>
      <rect x="60" y="60" width="1280" height="880" rx="30" fill="#ffffff" stroke="#00000014"/>
      <rect x="60" y="60" width="1280" height="90" rx="30" fill="${p.bg}"/>
      <text x="110" y="118" font-size="38" font-weight="800" fill="${p.fg}">${esc(title)}</text>
      <rect x="110" y="200" width="300" height="190" rx="22" fill="${p.soft}"/>
      <text x="140" y="270" font-size="30" fill="${p.bg}" opacity=".7">Visitors</text>
      <text x="140" y="350" font-size="70" font-weight="800" fill="${p.bg}">${Math.floor(1000 + rng() * 8000)}</text>
      <rect x="440" y="200" width="300" height="190" rx="22" fill="${p.accent}" opacity=".35"/>
      <rect x="110" y="430" width="630" height="430" rx="22" fill="${p.soft}"/>${bars}
      <rect x="1000" y="200" width="290" height="660" rx="22" fill="${p.soft}"/>
      <rect x="1030" y="240" width="230" height="22" rx="11" fill="${p.bg}" opacity=".5"/>
      <rect x="1030" y="290" width="170" height="22" rx="11" fill="${p.bg}" opacity=".3"/>`) };
  }
};
const CATEGORIES = Object.keys(TEMPLATES);

function makeDesign(seed, serial) {
  const rng = rngFrom(seed);
  const category = pick(rng, CATEGORIES);
  const palette = pick(rng, PALETTES);
  const title = `${pick(rng, ADJECTIVES)} ${pick(rng, NOUNS)}`;
  const { w, h, svg } = TEMPLATES[category](rng, palette, title);
  return {
    category, title, svg, width: w, height: h,
    description: `[Test bot] Automated ${category.toLowerCase()} study in ${palette.name} tones (batch ${serial}). Not a real creator.`,
    tags: ["testbot", category.toLowerCase().replace(/[^a-z]/g, ""), palette.name]
  };
}

const COMMENTS = [
  "Love the colour balance here.", "Clean layout, nice and balanced.", "This would look great printed.",
  "The contrast works really well.", "Great use of space.", "Strong concept, simple execution.",
  "Would love to see this as a series.", "Nice! The typography does a lot of work here."
];

// ------------------------------------------------------------------ database
function connect() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Not an error: lets the scheduled workflow stay green until secrets are added.
    console.log("::warning::SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. Nothing was done. See bot/README.md.");
    process.exit(0);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findUserIdByEmail(admin, email) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find(u => (u.email || "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensureBots(admin) {
  const ready = [];
  for (const bot of BOTS) {
    let id = await findUserIdByEmail(admin, bot.email);
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email: bot.email,
        password: randomBytes(32).toString("base64url"),   // random and never stored: nobody signs in as a bot
        email_confirm: true,
        user_metadata: { display_name: bot.display }
      });
      if (error) throw new Error(`Could not create ${bot.email}: ${error.message}`);
      id = data.user.id;
      console.log(`Created test account ${bot.username}`);
    }
    // Profile row is created by a database trigger; make sure the name/username are set.
    const { error } = await admin.from("profiles")
      .update({ username: bot.username, display_name: bot.display, bio: "Automated test account. Not a real creator." })
      .eq("id", id);
    if (error) throw new Error(`Could not set up profile for ${bot.username}: ${error.message}`);
    ready.push({ ...bot, id });
  }
  return ready;
}

async function assertIsBot(admin, id) {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data?.user || !isBotEmail(data.user.email)) {
    throw new Error(`Refusing to touch ${id}: it is not a test bot account.`);
  }
}

// -------------------------------------------------------------------- post
async function runPost() {
  const stamp = Date.now();
  const designs = Array.from({ length: POSTS_PER_RUN }, (_, i) => makeDesign((stamp + i * 7919) >>> 0, i + 1));

  if (DRY_RUN) {
    await mkdir("out", { recursive: true });
    for (const [i, d] of designs.entries()) {
      const png = await sharp(Buffer.from(d.svg)).png().toBuffer();
      const file = `out/${stamp}-${i + 1}-${d.category.replace(/\W/g, "")}.png`;
      await writeFile(file, png);
      console.log(`[dry run] "${d.title}" (${d.category}, ${d.width}x${d.height}) tags=${d.tags.join(",")} -> ${file}`);
    }
    console.log("Dry run only: nothing was sent to Supabase.");
    return;
  }

  const admin = connect();
  const bots = await ensureBots(admin);
  const created = [];

  for (const d of designs) {
    const author = bots[Math.floor(Math.random() * bots.length)];
    const png = await sharp(Buffer.from(d.svg)).png({ compressionLevel: 9 }).toBuffer();
    const path = `${author.id}/${randomUUID()}.png`;   // <author uuid>/<uuid>.png is what the database requires

    const up = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png" });
    if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

    const { data, error } = await admin.from("posts").insert({
      author_id: author.id, title: d.title, description: d.description, category: d.category,
      tags: d.tags, open_to_battles: true, image_path: path,
      status: "approved", reviewed_at: new Date().toISOString()
    }).select("id,title,category").single();
    if (error) {
      await admin.storage.from(BUCKET).remove([path]);
      throw new Error(`Could not create post: ${error.message}`);
    }
    created.push({ ...data, author });
    console.log(`Posted "${data.title}" (${data.category}) as ${author.username}`);
  }

  if (ENGAGE && bots.length > 1) await engage(admin, bots, created);
}

// ------------------------------------------------------------- likes/comments
async function engage(admin, bots, newPosts) {
  const botIds = bots.map(b => b.id);
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: recent, error } = await admin.from("posts").select("id,author_id")
    .in("author_id", botIds).eq("status", "approved").gte("created_at", since).limit(200);
  if (error) throw new Error(`Could not load bot posts: ${error.message}`);

  const targets = new Map(recent.map(p => [p.id, p.author_id]));
  newPosts.forEach(p => targets.set(p.id, p.author.id));

  const likes = [];
  const comments = [];
  for (const [postId, authorId] of targets) {
    const isNew = newPosts.some(p => p.id === postId);
    for (const bot of bots) {
      if (bot.id === authorId) continue;
      if (Math.random() < (isNew ? 0.7 : 0.15)) likes.push({ post_id: postId, user_id: bot.id });
      if (isNew && Math.random() < 0.35) {
        comments.push({ post_id: postId, author_id: bot.id, body: COMMENTS[Math.floor(Math.random() * COMMENTS.length)] });
      }
    }
  }
  if (likes.length) {
    const { error: likeError } = await admin.from("likes").upsert(likes, { onConflict: "post_id,user_id", ignoreDuplicates: true });
    if (likeError) console.warn(`Likes skipped: ${likeError.message}`);
  }
  if (comments.length) {
    const { error: commentError } = await admin.from("comments").insert(comments);
    if (commentError) console.warn(`Comments skipped: ${commentError.message}`);
  }
  console.log(`Engagement: ${likes.length} likes attempted, ${comments.length} comments.`);
}

// ----------------------------------------------------------------- cleanup
async function runCleanup() {
  const admin = connect();
  const { data: profiles, error } = await admin.from("profiles").select("id,username").like("username", "testbot\\_%");
  if (error) throw new Error(`Could not look up bots: ${error.message}`);

  const botIds = [];
  for (const p of profiles) {
    try { await assertIsBot(admin, p.id); botIds.push(p.id); }
    catch (e) { console.warn(`Skipping "${p.username}": ${e.message}`); }
  }
  if (!botIds.length) return console.log("No test bot accounts found. Nothing to remove.");

  let removedPosts = 0;
  for (;;) {
    const { data: posts, error: postError } = await admin.from("posts").select("id,image_path").in("author_id", botIds).limit(200);
    if (postError) throw new Error(`Could not list bot posts: ${postError.message}`);
    if (!posts.length) break;
    await admin.storage.from(BUCKET).remove(posts.map(p => p.image_path));
    const { error: delError } = await admin.from("posts").delete().in("id", posts.map(p => p.id));
    if (delError) throw new Error(`Could not delete posts: ${delError.message}`);
    removedPosts += posts.length;
  }
  await admin.from("likes").delete().in("user_id", botIds);
  await admin.from("comments").delete().in("author_id", botIds);
  console.log(`Removed ${removedPosts} bot posts (and their images, likes and comments).`);

  if (DELETE_USERS) {
    for (const id of botIds) {
      const { error: userError } = await admin.auth.admin.deleteUser(id);
      if (userError) console.warn(`Could not delete account ${id}: ${userError.message}`);
    }
    console.log(`Deleted ${botIds.length} bot accounts.`);
  }
}

// --------------------------------------------------------------------- main
try {
  if (command === "post") await runPost();
  else if (command === "cleanup") await runCleanup();
  else fail(`Unknown command "${command}". Use "post" or "cleanup".`);
} catch (error) {
  fail(error.message || String(error));
}
