// PinDrop account page extras: "Your designs" (with review status) and the staff review queue.
// All user-supplied text is written with textContent. What each person may see or
// change is enforced by the database (RLS + moderate_post()); hiding the review
// panel for non-staff here is only a convenience.
(function () {
  "use strict";

  const Auth = window.PinDropAuth;
  if (!Auth || !Auth.configured) return;

  const $ = id => document.getElementById(id);
  const mineList = $("myDesignsList");
  const queueList = $("reviewList");
  if (!mineList || !queueList) return;

  const BUCKET = "designs";
  const STAFF = ["moderator", "admin", "owner"];
  const STATUS_LABEL = { pending: "In review", approved: "Published", rejected: "Not approved" };
  let loadedFor = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function when(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  async function signedUrls(paths) {
    const map = {};
    if (!paths.length) return map;
    const { data, error } = await Auth.client.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (!error && data) data.forEach(item => { if (item.signedUrl) map[item.path] = item.signedUrl; });
    return map;
  }
  function thumb(url, alt) {
    if (!url) return el("div", "design-thumb design-thumb-empty", "No preview");
    const img = document.createElement("img");
    img.className = "design-thumb";
    img.src = url;
    img.alt = alt;
    img.loading = "lazy";
    return img;
  }

  // ------------------------------------------------------------ your designs
  async function loadMine(userId) {
    mineList.textContent = "";
    const note = el("p", "field-hint", "Loading your designs…");
    mineList.appendChild(note);
    const { data, error } = await Auth.client
      .from("posts")
      .select("id,title,status,created_at,image_path,like_count,comment_count")
      .eq("author_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) { note.textContent = "Couldn't load your designs."; return; }
    if (!data.length) { note.textContent = "You haven't posted anything yet."; return; }
    mineList.textContent = "";
    const urls = await signedUrls(data.map(post => post.image_path));

    data.forEach(post => {
      const row = el("div", "design-row");
      row.appendChild(thumb(urls[post.image_path], post.title));
      const info = el("div", "design-info");
      info.appendChild(el("div", "post-user", post.title));
      const meta = el("div", "small-meta", when(post.created_at) + (post.status === "approved" ? " · ♥ " + post.like_count + " · ▢ " + post.comment_count : ""));
      info.appendChild(meta);
      info.appendChild(el("span", "status-chip status-" + post.status, STATUS_LABEL[post.status] || post.status));
      row.appendChild(info);

      const del = el("button", "secondary-button", "Delete");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!window.confirm("Delete “" + post.title + "”? This can't be undone.")) return;
        del.disabled = true;
        const removed = await Auth.client.from("posts").delete().eq("id", post.id);
        if (removed.error) { del.disabled = false; return showToast("Couldn't delete that design. Please try again."); }
        await Auth.client.storage.from(BUCKET).remove([post.image_path]);
        row.remove();
        if (!mineList.querySelector(".design-row")) mineList.appendChild(el("p", "field-hint", "You haven't posted anything yet."));
      });
      row.appendChild(del);
      mineList.appendChild(row);
    });
  }

  // ------------------------------------------------------------ review queue
  async function loadQueue() {
    queueList.textContent = "";
    const note = el("p", "field-hint", "Loading…");
    queueList.appendChild(note);
    const { data, error } = await Auth.client
      .from("posts")
      .select("id,title,description,category,image_path,created_at,author:profiles!posts_author_id_fkey(display_name,username)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) { note.textContent = "Couldn't load the review queue."; return; }
    if (!data.length) { note.textContent = "Nothing waiting for review. 🎉"; return; }
    queueList.textContent = "";
    const urls = await signedUrls(data.map(post => post.image_path));

    data.forEach(post => {
      const card = el("div", "review-card");
      card.appendChild(thumb(urls[post.image_path], post.title));
      const info = el("div", "design-info");
      info.appendChild(el("div", "post-user", post.title));
      const by = (post.author && post.author.display_name) || "Creator";
      info.appendChild(el("div", "small-meta", by + (post.author && post.author.username ? " (@" + post.author.username + ")" : "") + " · " + post.category + " · " + when(post.created_at)));
      if (post.description) info.appendChild(el("p", "post-copy", post.description));
      card.appendChild(info);

      const actions = el("div", "review-actions");
      const approve = el("button", "primary", "Approve");
      const reject = el("button", "secondary-button", "Reject");
      approve.type = reject.type = "button";
      actions.appendChild(approve);
      actions.appendChild(reject);
      card.appendChild(actions);

      async function decide(status, reason) {
        approve.disabled = reject.disabled = true;
        const { error: rpcError } = await Auth.client.rpc("moderate_post", { target_post: post.id, new_status: status, reason: reason || null });
        if (rpcError) {
          approve.disabled = reject.disabled = false;
          return showToast(rpcError.message || "Couldn't save that decision.");
        }
        card.remove();
        showToast(status === "approved" ? "Design approved." : "Design rejected.");
        if (!queueList.querySelector(".review-card")) queueList.appendChild(el("p", "field-hint", "Nothing waiting for review. 🎉"));
      }
      approve.addEventListener("click", () => decide("approved"));
      reject.addEventListener("click", () => {
        const reason = window.prompt("Reason for rejecting (optional, kept in the audit log):", "");
        if (reason === null) return;
        decide("rejected", reason.trim().slice(0, 300));
      });
      queueList.appendChild(card);
    });
  }

  // ------------------------------------------------------------------ render
  function render() {
    const { session, profile } = Auth.getState();
    const reviewPanel = $("reviewPanel");
    const isStaff = Boolean(profile && STAFF.includes(profile.role));
    if (reviewPanel) reviewPanel.hidden = !isStaff;

    const key = session && Auth.emailConfirmed(session) ? session.user.id + ":" + (isStaff ? "s" : "u") : null;
    if (!key) { loadedFor = null; return; }
    if (key === loadedFor) return;
    loadedFor = key;
    loadMine(session.user.id);
    if (isStaff) loadQueue();
  }

  const refreshQueue = $("reviewRefresh");
  if (refreshQueue) refreshQueue.addEventListener("click", loadQueue);

  Auth.ready.then(render);
  Auth.onChange(render);
})();
