// PinDrop shared auth layer (Supabase Auth, browser side).
//
// Loaded on every page that needs to know who is signed in. It only ever uses
// the public project URL + publishable/anon key from config.js. All real
// authorization (roles, verification, who can edit what) is enforced by the
// database (Row Level Security + SECURITY DEFINER functions), never by this file.
(function () {
  "use strict";

  const cfg = window.PINDROP_CONFIG || {};
  const isPlaceholder = value => !value || /^YOUR[-_]/i.test(String(value).trim());

  function keyIsSecret(key) {
    if (/^sb_secret_/i.test(key)) return true;
    try {
      const payload = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload && payload.role === "service_role";
    } catch (e) {
      return false;
    }
  }

  let configured = false;
  let configError = "";
  let client = null;

  if (isPlaceholder(cfg.supabaseUrl) || isPlaceholder(cfg.supabaseKey)) {
    configError = "Supabase is not configured yet. Add your project URL and publishable key to config.js (see README.md).";
  } else if (keyIsSecret(String(cfg.supabaseKey))) {
    configError = "A secret/service-role key was found in config.js. Remove it immediately and use the publishable/anon key instead.";
    console.error("[PinDrop] " + configError);
  } else if (!window.supabase || typeof window.supabase.createClient !== "function") {
    configError = "The Supabase library could not be loaded. Check your internet connection and reload.";
  } else {
    try {
      new URL(cfg.supabaseUrl);
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      });
      configured = true;
    } catch (e) {
      configError = "The Supabase project URL in config.js is not valid.";
    }
  }

  const PROFILE_COLUMNS = "id,username,display_name,bio,avatar_url,role,is_verified,created_at";
  const state = { session: null, profile: null, loaded: false };
  const listeners = [];

  function accountUrl() {
    return new URL("account.html", window.location.href).href;
  }

  function emailConfirmed(session) {
    return Boolean(session && session.user && (session.user.email_confirmed_at || session.user.confirmed_at));
  }

  async function fetchProfile(userId) {
    if (!client || !userId) return null;
    const { data, error } = await client.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
    if (error) {
      console.warn("[PinDrop] Could not load profile:", error.message);
      return null;
    }
    return data;
  }

  // ---- Avatars -----------------------------------------------------------
  // profiles.avatar_url stores a storage path ("<user-id>/<file>") inside the
  // public "avatars" bucket. paintAvatar() shows the photo, or the person's
  // initial when there is no photo (or it fails to load).
  function initialOf(name) {
    return name && name.trim() ? name.trim().charAt(0).toUpperCase() : "?";
  }
  function avatarUrl(path) {
    if (!client || !path) return null;
    const { data } = client.storage.from("avatars").getPublicUrl(path);
    return data && data.publicUrl ? data.publicUrl : null;
  }
  function paintAvatar(el, person) {
    if (!el) return;
    const name = person && person.display_name ? person.display_name : "";
    const url = person && person.avatar_url ? avatarUrl(person.avatar_url) : null;
    const key = (url || "") + "|" + name;
    if (el.dataset.avatarKey === key) return; // unchanged: don't reload the image
    el.dataset.avatarKey = key;
    el.textContent = "";
    el.classList.remove("has-photo");
    if (!url) { el.textContent = initialOf(name); return; }
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.addEventListener("error", () => {
      img.remove();
      el.classList.remove("has-photo");
      el.textContent = initialOf(name);
    });
    img.src = url;
    el.appendChild(img);
    el.classList.add("has-photo");
  }

  // Fills in simple data-* hooks so any page can show who is signed in.
  // Uses textContent only - profile text is user-supplied and never treated as HTML.
  function applyBindings() {
    if (!configured) return;
    const profile = state.profile;
    const signedIn = Boolean(state.session);
    const name = profile && profile.display_name ? profile.display_name : "";

    document.querySelectorAll("[data-auth-avatar]").forEach(el => {
      paintAvatar(el, profile);
      el.setAttribute("aria-label", signedIn ? "Your account" : "Sign in");
      el.setAttribute("title", signedIn ? name || "Your account" : "Sign in");
    });
    document.querySelectorAll("[data-profile-name]").forEach(el => {
      el.textContent = name || (signedIn ? "Your profile" : "Welcome to PinDrop");
    });
    document.querySelectorAll("[data-profile-handle]").forEach(el => {
      if (!signedIn) { el.textContent = "Sign in to see your profile"; return; }
      const handle = profile && profile.username ? "@" + profile.username : "Choose a username in Account";
      const tag = profile && profile.role === "owner" ? " · Official account" : "";
      el.textContent = handle + tag;
    });
    document.querySelectorAll("[data-profile-avatar]").forEach(el => paintAvatar(el, profile));
    document.querySelectorAll("[data-profile-badge]").forEach(el => {
      el.hidden = !(profile && profile.is_verified);
    });
    document.querySelectorAll("[data-signed-in-only]").forEach(el => { el.hidden = !signedIn; });
    document.querySelectorAll("[data-signed-out-only]").forEach(el => { el.hidden = signedIn; });
  }

  function notify(event) {
    applyBindings();
    listeners.slice().forEach(fn => {
      try { fn(event, { session: state.session, profile: state.profile }); }
      catch (e) { console.error(e); }
    });
  }

  async function refreshProfile() {
    state.profile = state.session ? await fetchProfile(state.session.user.id) : null;
    notify("PROFILE_UPDATED");
    return state.profile;
  }

  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

  if (configured) {
    client.auth.onAuthStateChange((event, session) => {
      // Do not call other Supabase methods directly inside this callback
      // (can deadlock) - defer to the next tick.
      setTimeout(async () => {
        state.session = session;
        state.profile = session ? await fetchProfile(session.user.id) : null;
        state.loaded = true;
        notify(event);
        readyResolve({ session: state.session, profile: state.profile });
      }, 0);
    });
    // Safety net in case no auth event is emitted (e.g. storage blocked).
    client.auth.getSession().then(({ data }) => {
      if (state.loaded) return;
      state.session = data && data.session ? data.session : null;
      return fetchProfile(state.session && state.session.user.id).then(profile => {
        if (state.loaded) return;
        state.profile = profile;
        state.loaded = true;
        notify("INITIAL_SESSION");
        readyResolve({ session: state.session, profile: state.profile });
      });
    }).catch(() => {
      state.loaded = true;
      readyResolve({ session: null, profile: null });
    });
  } else {
    readyResolve({ session: null, profile: null });
  }

  window.PinDropAuth = {
    configured,
    configError,
    client,
    ready,
    accountUrl,
    emailConfirmed,
    refreshProfile,
    avatarUrl,
    paintAvatar,
    getState: () => ({ session: state.session, profile: state.profile }),
    onChange(fn) { listeners.push(fn); },
    async signOut() {
      if (!client) return { error: null };
      return client.auth.signOut();
    }
  };

  document.addEventListener("DOMContentLoaded", applyBindings);
})();
