// PinDrop feed: approved posts, likes and comments from Supabase.
//
// Everything user-supplied is written with textContent / attributes, never innerHTML.
// Who may see or do what is enforced by the database (RLS); this file only
// presents the result. Pending/rejected posts never reach this page because the
// feed asks for status = 'approved' (and RLS would hide other people's anyway).
(function () {
  "use strict";

  const feed = document.getElementById("feed");
  const Auth = window.PinDropAuth;
  if (!feed || !Auth) return;

  const emptyState = document.getElementById("emptyState");
  const PAGE_SIZE = 30;
  const BUCKET = "designs";
  let lastUserId = undefined;

  // ---------------------------------------------------------------- helpers
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const ICONS = {
    heart: '<path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"/>',
    comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    share: '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'
  };
  function icon(name) {
    const wrap = document.createElement("span");
    wrap.className = "ico-wrap";
    wrap.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
    return wrap;
  }
  function avatar(person, className) {
    const node = el("div", className);
    Auth.paintAvatar(node, person);
    return node;
  }
  function timeAgo(iso) {
    const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h";
    const days = Math.floor(hours / 24);
    if (days < 30) return days + "d";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function currentUserId() {
    const { session } = Auth.getState();
    return session && session.user ? session.user.id : null;
  }
  function canAct() {
    const { session } = Auth.getState();
    return Boolean(session && Auth.emailConfirmed(session));
  }
  function needSignIn(action) {
    showToast("Sign in with a confirmed email to " + action + ".");
  }
  function setEmpty(message) {
    if (!emptyState) return;
    emptyState.textContent = message;
    emptyState.hidden = false;
  }
  function refreshEmpty(defaultMessage) {
    if (!emptyState) return;
    const anyVisible = Boolean(feed.querySelector(".post:not([hidden])"));
    if (!anyVisible && defaultMessage) emptyState.textContent = defaultMessage;
    emptyState.hidden = anyVisible;
  }

  // ----------------------------------------------------------- post element
  function buildComment(comment, post, list, countEl) {
    const row = el("div", "comment-row");
    row.appendChild(avatar(comment.author, "avatar small"));
    const body = el("div", "comment-body");
    const head = el("div", "comment-head");
    head.appendChild(el("strong", "", (comment.author && comment.author.display_name) || "Creator"));
    head.appendChild(el("span", "small-meta", " · " + timeAgo(comment.created_at)));
    body.appendChild(head);
    body.appendChild(el("p", "comment-text", comment.body));
    row.appendChild(body);

    const uid = currentUserId();
    if (uid && uid === comment.author_id) {
      const del = el("button", "comment-delete", "Delete");
      del.type = "button";
      del.addEventListener("click", async () => {
        if (!window.confirm("Delete your comment?")) return;
        del.disabled = true;
        const { error } = await Auth.client.from("comments").delete().eq("id", comment.id);
        if (error) { del.disabled = false; return showToast("Couldn't delete the comment. Please try again."); }
        row.remove();
        post.comment_count = Math.max(0, post.comment_count - 1);
        countEl.textContent = String(post.comment_count);
      });
      row.appendChild(del);
    }
    return row;
  }

  function buildCommentSection(post, countEl) {
    const section = el("div", "comments");
    const list = el("div", "comment-list");
    const status = el("p", "small-meta", "Loading comments…");
    section.appendChild(status);
    section.appendChild(list);

    const form = el("form", "comment-form");
    const input = el("input", "text-field");
    input.type = "text";
    input.maxLength = 500;
    input.placeholder = "Add a comment…";
    input.setAttribute("aria-label", "Add a comment");
    const send = el("button", "primary", "Post");
    send.type = "submit";
    form.appendChild(input);
    form.appendChild(send);
    section.appendChild(form);

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (!canAct()) return needSignIn("comment");
      send.disabled = true;
      const { data, error } = await Auth.client
        .from("comments")
        .insert({ post_id: post.id, author_id: currentUserId(), body: text })
        .select("id,body,created_at,author_id,author:profiles!comments_author_id_fkey(display_name,username,avatar_url)")
        .single();
      send.disabled = false;
      if (error) return showToast("Couldn't post your comment. Please try again.");
      input.value = "";
      status.hidden = true;
      list.appendChild(buildComment(data, post, list, countEl));
      post.comment_count += 1;
      countEl.textContent = String(post.comment_count);
    });

    async function load() {
      const { data, error } = await Auth.client
        .from("comments")
        .select("id,body,created_at,author_id,author:profiles!comments_author_id_fkey(display_name,username,avatar_url)")
        .eq("post_id", post.id)
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) { status.textContent = "Couldn't load comments."; return; }
      list.textContent = "";
      data.forEach(comment => list.appendChild(buildComment(comment, post, list, countEl)));
      status.textContent = data.length ? "" : "No comments yet. Be the first.";
      status.hidden = data.length > 0;
    }
    section.load = load;
    return section;
  }

  function buildPost(post, imageUrl, liked) {
    const article = el("article", "post");
    article.id = "post-" + post.id;
    article.dataset.category = post.category;
    article.postData = post;
    article.dataset.search = [post.title, post.description, post.category, (post.author && post.author.display_name) || "", (post.author && post.author.username) || "", ...(post.tags || [])].join(" ").toLowerCase();

    const head = el("div", "post-head");
    head.appendChild(avatar(post.author, "avatar"));
    const who = el("div", "post-who");
    const name = el("div", "post-user", (post.author && post.author.display_name) || "Creator");
    if (post.author && post.author.is_verified) {
      const badge = el("span", "verified-badge", "✓");
      badge.setAttribute("aria-label", "Verified creator");
      badge.title = "Verified creator";
      name.appendChild(badge);
    }
    who.appendChild(name);
    who.appendChild(el("div", "post-sub", post.title));
    head.appendChild(who);
    article.appendChild(head);

    const media = el("div", "post-media");
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = post.title;
      image.loading = "lazy";
      image.className = "post-image";
      media.appendChild(image);
    }
    article.appendChild(media);

    if (post.description) article.appendChild(el("p", "post-copy", post.description));
    if (post.tags && post.tags.length) {
      article.appendChild(el("p", "small-meta post-tags", post.tags.map(tag => "#" + tag.replace(/\s+/g, "")).join("  ")));
    }

    const actions = el("div", "post-actions");
    const like = el("button", "action like" + (liked ? " liked" : ""));
    like.type = "button";
    like.setAttribute("aria-label", "Like");
    const likeCount = el("span", "count", String(post.like_count));
    like.appendChild(icon("heart"));
    like.appendChild(likeCount);

    const comment = el("button", "action comment");
    comment.type = "button";
    comment.setAttribute("aria-label", "Comments");
    const commentCount = el("span", "count", String(post.comment_count));
    comment.appendChild(icon("comment"));
    comment.appendChild(commentCount);

    const share = el("button", "action share");
    share.type = "button";
    share.setAttribute("aria-label", "Copy link");
    share.appendChild(icon("share"));

    actions.appendChild(like);
    actions.appendChild(comment);
    actions.appendChild(share);
    actions.appendChild(el("span", "post-time", timeAgo(post.created_at)));
    article.appendChild(actions);

    let isLiked = liked;
    let busy = false;
    like.addEventListener("click", async () => {
      if (busy) return;
      if (!canAct()) return needSignIn("like designs");
      busy = true;
      const wantLike = !isLiked;
      // Optimistic update, rolled back if the database refuses.
      isLiked = wantLike;
      post.like_count += wantLike ? 1 : -1;
      like.classList.toggle("liked", wantLike);
      likeCount.textContent = String(post.like_count);
      const uid = currentUserId();
      const { error } = wantLike
        ? await Auth.client.from("likes").insert({ post_id: post.id, user_id: uid })
        : await Auth.client.from("likes").delete().eq("post_id", post.id).eq("user_id", uid);
      if (error && error.code !== "23505") {
        isLiked = !wantLike;
        post.like_count += wantLike ? -1 : 1;
        like.classList.toggle("liked", isLiked);
        likeCount.textContent = String(post.like_count);
        showToast("Couldn't update your like. Please try again.");
      }
      busy = false;
    });

    let commentSection = null;
    comment.addEventListener("click", () => {
      if (commentSection) {
        commentSection.hidden = !commentSection.hidden;
        return;
      }
      commentSection = buildCommentSection(post, commentCount);
      article.appendChild(commentSection);
      commentSection.load();
    });

    share.addEventListener("click", async () => {
      const url = location.origin + location.pathname + "#post-" + post.id;
      try { await navigator.clipboard.writeText(url); showToast("Post link copied."); }
      catch { showToast("Copy the page address to share this design."); }
    });

    return article;
  }

  // ------------------------------------------------------------------ sort
  const sortSelect = document.getElementById("sortSelect");
  function applySort() {
    const posts = Array.from(feed.querySelectorAll(".post"));
    const byLikes = sortSelect && sortSelect.value === "likes";
    posts.sort((a, b) => {
      const pa = a.postData, pb = b.postData;
      if (byLikes && pb.like_count !== pa.like_count) return pb.like_count - pa.like_count;
      return new Date(pb.created_at) - new Date(pa.created_at);
    });
    posts.forEach(node => feed.appendChild(node));
  }
  if (sortSelect) sortSelect.addEventListener("change", applySort);

  // ------------------------------------------------------------------ load
  async function loadFeed() {
    if (!Auth.configured) {
      feed.textContent = "";
      if (emptyState) feed.appendChild(emptyState);
      return setEmpty("The feed is unavailable right now.");
    }
    const { data: posts, error } = await Auth.client
      .from("posts")
      .select("id,title,description,category,tags,image_path,like_count,comment_count,created_at,author:profiles!posts_author_id_fkey(display_name,username,is_verified,avatar_url)")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);

    feed.textContent = "";
    if (emptyState) feed.appendChild(emptyState);
    if (error) return setEmpty("Couldn't load designs. Please refresh and try again.");
    if (!posts.length) return setEmpty("No designs yet. Be the first to share one!");

    // Images live in a private bucket: ask for short-lived signed links.
    const urlByPath = {};
    const signed = await Auth.client.storage.from(BUCKET).createSignedUrls(posts.map(post => post.image_path), 3600);
    if (!signed.error && signed.data) {
      signed.data.forEach(item => { if (item.signedUrl) urlByPath[item.path] = item.signedUrl; });
    }

    // Which of these has the signed-in user already liked?
    const liked = new Set();
    const uid = currentUserId();
    if (uid) {
      const likes = await Auth.client.from("likes").select("post_id").in("post_id", posts.map(post => post.id));
      if (!likes.error && likes.data) likes.data.forEach(row => liked.add(row.post_id));
    }

    posts.forEach(post => feed.appendChild(buildPost(post, urlByPath[post.image_path], liked.has(post.id))));
    applySort();
    refreshEmpty();

    if (location.hash && location.hash.startsWith("#post-")) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView({ block: "start" });
    }
  }

  Auth.ready.then(() => {
    lastUserId = currentUserId();
    loadFeed();
  });
  // Reload only when the signed-in user actually changes (not on token refreshes).
  Auth.onChange(() => {
    const uid = currentUserId();
    if (lastUserId === undefined || uid === lastUserId) return;
    lastUserId = uid;
    loadFeed();
  });
})();
