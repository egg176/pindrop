const toastElement = document.getElementById("toast");
let toastTimer;
function showToast(message) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove("show"), 2400);
}
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("drawerOverlay");
const menuToggle = document.getElementById("menuToggle");
function openDrawer() {
  if (!sidebar || !overlay || !menuToggle) return;
  sidebar.classList.add("open");
  overlay.classList.add("visible");
  menuToggle.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
}
function closeDrawer() {
  if (!sidebar || !overlay || !menuToggle) return;
  sidebar.classList.remove("open");
  overlay.classList.remove("visible");
  menuToggle.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}
if (menuToggle) menuToggle.addEventListener("click", () => sidebar.classList.contains("open") ? closeDrawer() : openDrawer());
if (overlay) overlay.addEventListener("click", closeDrawer);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeDrawer(); });

document.querySelectorAll(".like").forEach(button => button.addEventListener("click", () => {
  const liked = button.classList.toggle("liked");
  const heart = button.querySelector(".heart");
  const count = button.querySelector(".count");
  if (heart) heart.textContent = liked ? "♥" : "♡";
  if (count) count.textContent = String(Number(count.textContent) + (liked ? 1 : -1));
}));
document.querySelectorAll(".comment").forEach(button => button.addEventListener("click", () => showToast("Comments need a connected backend in the next version.")));
document.querySelectorAll(".share").forEach(button => button.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); showToast("Page link copied."); }
  catch { showToast("Copy the page address to share this design."); }
}));
document.querySelectorAll(".bookmark").forEach(button => button.addEventListener("click", () => {
  const saved = button.classList.toggle("liked");
  button.textContent = saved ? "▣" : "♧";
  showToast(saved ? "Design saved in this preview." : "Design removed from saved items.");
}));
document.querySelectorAll(".follow").forEach(button => button.addEventListener("click", () => {
  const following = button.textContent.trim() === "Follow";
  button.textContent = following ? "Following" : "Follow";
  showToast(following ? "Following creator in this preview." : "Creator unfollowed in this preview.");
}));
document.querySelectorAll(".category").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll(".category").forEach(item => item.classList.toggle("active", item === button));
  const category = button.dataset.category;
  document.querySelectorAll("#feed .post").forEach(post => {
    post.hidden = !(category === "All Designs" || post.dataset.category === category);
  });
  const empty = document.getElementById("emptyState");
  if (empty) empty.hidden = Boolean(document.querySelector("#feed .post:not([hidden])"));
  closeDrawer();
}));
const searchInput = document.getElementById("search");
if (searchInput) searchInput.addEventListener("input", () => {
  const query = searchInput.value.toLowerCase().trim();
  document.querySelectorAll("#feed .post").forEach(post => {
    post.hidden = !((post.dataset.search + " " + post.textContent).toLowerCase().includes(query));
  });
  const empty = document.getElementById("emptyState");
  if (empty) empty.hidden = Boolean(document.querySelector("#feed .post:not([hidden])"));
});
const notifications = document.getElementById("notifications");
if (notifications) notifications.addEventListener("click", () => showToast("You are all caught up."));

// Load designs published from create.html in this browser.
function renderPublishedPosts() {
  const feed = document.getElementById("feed");
  if (!feed) return;
  let posts = [];
  try { posts = JSON.parse(localStorage.getItem("pindrop.posts") || "[]"); } catch {}
  posts.forEach(post => {
    if (document.getElementById("published-" + post.id)) return;
    const article = document.createElement("article");
    article.className = "post";
    article.id = "published-" + post.id;
    article.dataset.category = post.category || "Other";
    article.dataset.search = [post.title, post.description, post.category, ...(post.tags || [])].join(" ").toLowerCase();

    const head = document.createElement("div");
    head.className = "post-head";
    head.innerHTML = '<div class="avatar">Y</div><div><div class="post-user">You</div><div class="handle">@yourhandle · just now</div></div>';
    const title = document.createElement("h3");
    title.className = "post-user";
    title.style.margin = "14px 0 4px";
    title.textContent = post.title || "Untitled design";
    article.appendChild(head);
    article.appendChild(title);
    if (post.description) {
      const copy = document.createElement("p");
      copy.className = "post-copy";
      copy.textContent = post.description;
      article.appendChild(copy);
    }
    if (post.image) {
      const image = document.createElement("img");
      image.src = post.image;
      image.alt = post.title || "Uploaded design";
      image.style.cssText = "display:block;width:100%;max-height:560px;object-fit:contain;background:#f4f7fc;border-radius:12px";
      article.appendChild(image);
    }
    if (post.tags && post.tags.length) {
      const tags = document.createElement("p");
      tags.className = "small-meta";
      tags.textContent = post.tags.map(tag => "#" + tag.replace(/\s+/g, "")).join("  ");
      article.appendChild(tags);
    }
    const actions = document.createElement("div");
    actions.className = "post-actions";
    actions.innerHTML = '<button class="action like"><span class="heart">♡</span><span class="count">0</span></button><button class="action comment"><span>▢</span><span>Comment</span></button><button class="action share"><span>↗</span><span>Share</span></button>';
    article.appendChild(actions);
    const like = actions.querySelector(".like");
    like.addEventListener("click", () => {
      const liked = like.classList.toggle("liked");
      like.querySelector(".heart").textContent = liked ? "♥" : "♡";
      like.querySelector(".count").textContent = liked ? "1" : "0";
    });
    actions.querySelector(".comment").addEventListener("click", () => showToast("Comments need a connected backend in the next version."));
    actions.querySelector(".share").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(location.href + "#published-" + post.id); showToast("Post link copied."); }
      catch { showToast("Copy the page address to share this design."); }
    });
    feed.prepend(article);
  });
}
renderPublishedPosts();
const params = new URLSearchParams(location.search);
if (params.get("published") === "1") {
  showToast("Your design was published in this browser.");
  history.replaceState({}, "", location.pathname);
}
