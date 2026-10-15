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

// After publishing, create.js sends people back here. New designs are reviewed first.
const params = new URLSearchParams(location.search);
if (params.get("submitted") === "1") {
  showToast("Design submitted! It will appear in the feed once it has been reviewed.");
  history.replaceState({}, "", location.pathname);
}
