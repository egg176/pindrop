// PinDrop account page: sign up, sign in, password reset, profile, admin verification.
// All user-supplied text is written with textContent / value, never innerHTML.
(function () {
  "use strict";

  const Auth = window.PinDropAuth;
  const $ = id => document.getElementById(id);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

  const panels = {
    out: $("panelSignedOut"),
    recovery: $("panelRecovery"),
    verify: $("panelVerify"),
    in: $("panelSignedIn")
  };

  let recoveryMode = false;
  let pendingEmail = "";
  let filledForUser = null;
  let adminTarget = null;

  // ---------------------------------------------------------------- helpers
  function showMessage(el, type, text) {
    el.className = "form-message " + type;
    el.textContent = text;
    el.hidden = false;
  }
  function clearMessage(el) {
    el.hidden = true;
    el.textContent = "";
  }
  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel || "Please wait…";
      button.disabled = true;
    } else {
      if (button.dataset.label) button.textContent = button.dataset.label;
      button.disabled = false;
    }
  }
  function friendly(error) {
    const code = error && error.code;
    const message = (error && error.message) || "";
    const map = {
      invalid_credentials: "Incorrect email or password.",
      email_not_confirmed: "Please confirm your email first. Check your inbox for the link.",
      weak_password: "That password is too weak. Use at least 8 characters and avoid common passwords.",
      same_password: "Your new password must be different from the old one.",
      over_email_send_rate_limit: "Too many emails were requested. Please wait a few minutes and try again.",
      over_request_rate_limit: "Too many attempts. Please wait a moment and try again.",
      signup_disabled: "Sign-ups are currently disabled.",
      user_banned: "This account can't be used right now.",
      session_not_found: "Your session has expired. Please sign in again."
    };
    if (code && map[code]) return map[code];
    if (/failed to fetch|networkerror|load failed/i.test(message)) return "Couldn't reach the server. Check your connection and try again.";
    if (/invalid login credentials/i.test(message)) return map.invalid_credentials;
    if (/email not confirmed/i.test(message)) return map.email_not_confirmed;
    if (/rate limit/i.test(message)) return map.over_email_send_rate_limit;
    return message || "Something went wrong. Please try again.";
  }
  function showPanel(name) {
    Object.keys(panels).forEach(key => { panels[key].hidden = key !== name; });
  }
  function initial(name) {
    return name ? name.trim().charAt(0).toUpperCase() : "?";
  }

  // ------------------------------------------------- config / URL messages
  if (!Auth || !Auth.configured) {
    const notice = $("configNotice");
    notice.textContent = (Auth && Auth.configError) || "Account features are unavailable.";
    notice.hidden = false;
    showPanel("none");
    return;
  }

  (function showLinkErrors() {
    const raw = (location.hash && location.hash.length > 1 ? location.hash.slice(1) : "") || location.search.slice(1);
    const params = new URLSearchParams(raw);
    const description = params.get("error_description");
    if (description) {
      showMessage($("pageMessage"), "error", description.replace(/\+/g, " ") + " You can request a new link below.");
      history.replaceState({}, "", location.pathname);
    }
  })();

  // ------------------------------------------------------------------ tabs
  const forms = { signin: $("signInForm"), signup: $("signUpForm"), reset: $("resetForm") };
  function selectTab(name) {
    Object.keys(forms).forEach(key => { forms[key].hidden = key !== name; });
    document.querySelectorAll(".auth-tab").forEach(tab => {
      tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
    });
    document.querySelector(".auth-tabs").hidden = name === "reset";
  }
  document.querySelectorAll(".auth-tab").forEach(tab => tab.addEventListener("click", () => selectTab(tab.dataset.tab)));
  $("forgotLink").addEventListener("click", () => {
    $("resetEmail").value = $("signInEmail").value.trim();
    selectTab("reset");
  });
  $("backToSignIn").addEventListener("click", () => selectTab("signin"));

  // --------------------------------------------------------------- sign up
  $("signUpForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("signUpMessage");
    clearMessage(message);
    const name = $("signUpName").value.trim();
    const email = $("signUpEmail").value.trim();
    const password = $("signUpPassword").value;
    const confirm = $("signUpConfirm").value;

    if (name.length < 1 || name.length > 50) return showMessage(message, "error", "Please enter a display name (up to 50 characters).");
    if (/pindrop/i.test(name)) return showMessage(message, "error", "Display names containing “PinDrop” are reserved for the official account.");
    if (!EMAIL_RE.test(email)) return showMessage(message, "error", "Please enter a valid email address.");
    if (password.length < 8) return showMessage(message, "error", "Your password needs at least 8 characters.");
    if (password !== confirm) return showMessage(message, "error", "The two passwords don't match.");

    setBusy($("signUpButton"), true, "Creating account…");
    const { data, error } = await Auth.client.auth.signUp({
      email,
      password,
      options: { data: { display_name: name }, emailRedirectTo: Auth.accountUrl() }
    });
    setBusy($("signUpButton"), false);

    if (error) return showMessage(message, "error", friendly(error));

    if (data && data.session) {
      // A session straight after sign-up means "Confirm email" is switched off in Supabase.
      showMessage(message, "error", "Your Supabase project is not requiring email confirmation. Turn on “Confirm email” in Authentication settings before launching PinDrop.");
      return;
    }
    pendingEmail = email;
    // Same wording whether or not the address already has an account (avoids revealing which emails are registered).
    showMessage(message, "success", "Check your inbox. If this address can be used for a new account, we've sent a confirmation link. Confirm it, then sign in.");
    $("signUpForm").reset();
  });

  // --------------------------------------------------------------- sign in
  $("signInForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("signInMessage");
    clearMessage(message);
    $("resendRow").hidden = true;
    const email = $("signInEmail").value.trim();
    const password = $("signInPassword").value;
    if (!EMAIL_RE.test(email)) return showMessage(message, "error", "Please enter a valid email address.");
    if (!password) return showMessage(message, "error", "Please enter your password.");

    setBusy($("signInButton"), true, "Signing in…");
    const { error } = await Auth.client.auth.signInWithPassword({ email, password });
    setBusy($("signInButton"), false);

    if (error) {
      showMessage(message, "error", friendly(error));
      if (error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message || "")) {
        pendingEmail = email;
        $("resendRow").hidden = false;
      }
      return;
    }
    $("signInForm").reset();
    // The auth state listener renders the signed-in view.
  });

  async function resendConfirmation(email, messageEl, button) {
    if (!email) return showMessage(messageEl, "error", "Enter your email address first.");
    setBusy(button, true, "Sending…");
    const { error } = await Auth.client.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: Auth.accountUrl() }
    });
    setBusy(button, false);
    if (error) return showMessage(messageEl, "error", friendly(error));
    showMessage(messageEl, "success", "If that address is waiting for confirmation, a new link is on its way.");
  }
  $("resendButton").addEventListener("click", () => resendConfirmation(pendingEmail || $("signInEmail").value.trim(), $("signInMessage"), $("resendButton")));
  $("verifyResend").addEventListener("click", () => {
    const { session } = Auth.getState();
    resendConfirmation(session && session.user.email, $("verifyMessage"), $("verifyResend"));
  });

  // -------------------------------------------------------- password reset
  $("resetForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("resetMessage");
    clearMessage(message);
    const email = $("resetEmail").value.trim();
    if (!EMAIL_RE.test(email)) return showMessage(message, "error", "Please enter a valid email address.");

    setBusy($("resetButton"), true, "Sending…");
    const { error } = await Auth.client.auth.resetPasswordForEmail(email, { redirectTo: Auth.accountUrl() });
    setBusy($("resetButton"), false);

    if (error && (error.code === "over_email_send_rate_limit" || error.status === 429)) {
      return showMessage(message, "error", friendly(error));
    }
    // Neutral on purpose: never reveal whether an account exists for this email.
    showMessage(message, "success", "If an account exists for that address, a password reset link is on its way. The link works for a limited time.");
  });

  $("recoveryForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("recoveryMessage");
    clearMessage(message);
    const password = $("newPassword").value;
    if (password.length < 8) return showMessage(message, "error", "Your password needs at least 8 characters.");
    if (password !== $("newPasswordConfirm").value) return showMessage(message, "error", "The two passwords don't match.");

    setBusy($("recoveryButton"), true, "Updating…");
    const { error } = await Auth.client.auth.updateUser({ password });
    setBusy($("recoveryButton"), false);
    if (error) return showMessage(message, "error", friendly(error));

    recoveryMode = false;
    $("recoveryForm").reset();
    showMessage($("pageMessage"), "success", "Your password was updated. You're signed in.");
    render();
  });

  // ----------------------------------------------------------- sign out
  async function signOut() {
    const { error } = await Auth.signOut();
    if (error) return showMessage($("pageMessage"), "error", friendly(error));
    filledForUser = null;
    showMessage($("pageMessage"), "success", "You've been signed out.");
  }
  $("signOutButton").addEventListener("click", signOut);
  $("verifySignOut").addEventListener("click", signOut);

  // ------------------------------------------------------------- profile
  const bio = $("profileBio");
  bio.addEventListener("input", () => { $("bioCounter").textContent = bio.value.length + " / 300"; });

  function fillProfile(profile, user) {
    Auth.paintAvatar($("accountAvatar"), profile);
    $("accountName").textContent = (profile && profile.display_name) || "Your name";
    $("accountBadge").hidden = !(profile && profile.is_verified);
    $("accountHandle").textContent = profile && profile.username ? "@" + profile.username : "No username yet";
    $("accountEmail").textContent = user.email || "";
    const role = $("accountRole");
    const labels = { owner: "Official owner", admin: "Admin", moderator: "Moderator" };
    if (profile && labels[profile.role]) { role.textContent = labels[profile.role]; role.hidden = false; }
    else role.hidden = true;

    $("adminPanel").hidden = !(profile && (profile.role === "admin" || profile.role === "owner"));

    if (filledForUser !== user.id) {
      $("profileName").value = (profile && profile.display_name) || "";
      $("profileUsername").value = (profile && profile.username) || "";
      bio.value = (profile && profile.bio) || "";
      $("bioCounter").textContent = bio.value.length + " / 300";
      filledForUser = user.id;
    }
  }

  $("profileForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("profileMessage");
    clearMessage(message);
    const { session } = Auth.getState();
    if (!session) return showMessage(message, "error", "Please sign in again.");

    const displayName = $("profileName").value.trim();
    const username = $("profileUsername").value.trim().toLowerCase();
    const bioText = bio.value.trim();

    if (displayName.length < 1 || displayName.length > 50) return showMessage(message, "error", "Display name must be 1–50 characters.");
    if (username && !USERNAME_RE.test(username)) return showMessage(message, "error", "Usernames use 3–20 lowercase letters, numbers or underscores.");
    if (bioText.length > 300) return showMessage(message, "error", "Bio can be up to 300 characters.");

    setBusy($("profileButton"), true, "Saving…");
    const { data, error } = await Auth.client
      .from("profiles")
      .update({ display_name: displayName, username: username || null, bio: bioText })
      .eq("id", session.user.id)
      .select("id")
      .maybeSingle();
    setBusy($("profileButton"), false);

    if (error) {
      if (error.code === "23505") return showMessage(message, "error", "That username is already taken. Try another.");
      if (error.code === "23514") return showMessage(message, "error", "Please check your username, display name and bio, then try again.");
      if (error.code === "P0001") return showMessage(message, "error", error.message);
      return showMessage(message, "error", friendly(error));
    }
    if (!data) return showMessage(message, "error", "Your profile could not be saved. Make sure your email is confirmed, then try again.");

    filledForUser = null;
    await Auth.refreshProfile();
    showMessage(message, "success", "Profile saved.");
  });

  // ----------------------------------------------------- admin verification
  // This panel is a convenience only. The database function admin_set_verification()
  // re-checks the caller's role, so hiding/showing it here is not a security boundary.
  function renderAdminTarget() {
    const box = $("adminResult");
    if (!adminTarget) { box.hidden = true; return; }
    Auth.paintAvatar($("adminResultAvatar"), adminTarget);
    $("adminResultName").textContent = adminTarget.display_name;
    $("adminResultBadge").hidden = !adminTarget.is_verified;
    $("adminResultHandle").textContent = "@" + adminTarget.username + " · " + adminTarget.role;
    const button = $("adminToggleButton");
    button.textContent = adminTarget.is_verified ? "Remove verification" : "Grant verification";
    button.className = adminTarget.is_verified ? "secondary-button" : "primary";
    button.disabled = adminTarget.role === "owner";
    box.hidden = false;
  }

  $("adminLookupForm").addEventListener("submit", async event => {
    event.preventDefault();
    const message = $("adminMessage");
    clearMessage(message);
    adminTarget = null;
    renderAdminTarget();
    const username = $("adminUsername").value.trim().toLowerCase().replace(/^@/, "");
    if (!USERNAME_RE.test(username)) return showMessage(message, "error", "Enter a valid username to look up.");

    setBusy($("adminLookupButton"), true, "Looking up…");
    const { data, error } = await Auth.client
      .from("profiles")
      .select("id,username,display_name,role,is_verified,avatar_url")
      .eq("username", username)
      .maybeSingle();
    setBusy($("adminLookupButton"), false);

    if (error) return showMessage(message, "error", friendly(error));
    if (!data) return showMessage(message, "error", "No creator with that username.");
    adminTarget = data;
    renderAdminTarget();
  });

  $("adminToggleButton").addEventListener("click", async () => {
    if (!adminTarget) return;
    const message = $("adminMessage");
    clearMessage(message);
    const makeVerified = !adminTarget.is_verified;
    const label = makeVerified ? "Grant the blue checkmark to " : "Remove the blue checkmark from ";
    if (!window.confirm(label + adminTarget.display_name + " (@" + adminTarget.username + ")?")) return;

    setBusy($("adminToggleButton"), true, "Saving…");
    const { error } = await Auth.client.rpc("admin_set_verification", {
      target_id: adminTarget.id,
      make_verified: makeVerified,
      reason: null
    });
    setBusy($("adminToggleButton"), false);
    if (error) return showMessage(message, "error", error.message || friendly(error));

    adminTarget.is_verified = makeVerified;
    renderAdminTarget();
    showMessage(message, "success", makeVerified ? "Verification granted." : "Verification removed.");
  });

  // -------------------------------------------------------------- render
  function render() {
    const { session, profile } = Auth.getState();
    const title = $("accountTitle");
    const subtitle = $("accountSubtitle");

    if (recoveryMode && session) {
      title.textContent = "Reset password";
      subtitle.textContent = "Choose a new password for your account.";
      return showPanel("recovery");
    }
    if (!session) {
      title.textContent = "Welcome to PinDrop";
      subtitle.textContent = "Sign in or create an account to share designs and join battles.";
      return showPanel("out");
    }
    if (!Auth.emailConfirmed(session)) {
      title.textContent = "One more step";
      subtitle.textContent = "Confirm your email address to start using PinDrop.";
      $("verifyText").textContent = "We sent a confirmation link to " + (session.user.email || "your email") + ".";
      return showPanel("verify");
    }
    title.textContent = "Your account";
    subtitle.textContent = "Manage your profile and how you appear on PinDrop.";
    fillProfile(profile, session.user);
    showPanel("in");
  }

  Auth.onChange(event => {
    if (event === "PASSWORD_RECOVERY") recoveryMode = true;
    if (event === "SIGNED_OUT") { recoveryMode = false; adminTarget = null; renderAdminTarget(); }
    if (event === "SIGNED_IN" && !$("pageMessage").hidden && $("pageMessage").classList.contains("success") === false) {
      clearMessage($("pageMessage"));
    }
    render();
  });

  Auth.ready.then(render);
})();
