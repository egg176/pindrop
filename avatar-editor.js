// PinDrop profile picture editor (account page).
//
// Flow: choose a photo -> drag / zoom to crop -> the browser resizes it to a 512x512
// square -> upload to the public "avatars" bucket at "<user-id>/<random-id>.<ext>"
// -> call set_my_avatar() so profiles.avatar_url points at it -> delete the old file.
//
// Who may upload where (own folder, confirmed email, png/jpg/webp, 2 MB) and who may
// change profiles.avatar_url (only set_my_avatar) is enforced by the database and
// storage policies. The checks here are for friendly error messages only.
(function () {
  "use strict";

  const Auth = window.PinDropAuth;
  if (!Auth || !Auth.configured) return;

  const $ = id => document.getElementById(id);
  const fileInput = $("avatarFile");
  if (!fileInput) return;

  const stage = $("avatarStage");
  const canvas = $("avatarCanvas");
  const zoomInput = $("avatarZoom");
  const chooseBtn = $("avatarChoose");
  const saveBtn = $("avatarSave");
  const cancelBtn = $("avatarCancel");
  const removeBtn = $("avatarRemove");
  const message = $("avatarMessage");
  const ctx = canvas.getContext("2d");

  const BUCKET = "avatars";
  const VIEW = canvas.width;            // size of the on-screen cropper (px)
  const OUT = 512;                      // size of the saved picture (px)
  const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
  const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
  const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // matches the bucket limit
  const MIN_SIDE = 128;

  let img = null;
  let objectUrl = null;
  let zoom = 1;
  let offX = 0;                         // pan offset, in cropper pixels
  let offY = 0;
  let busy = false;

  // ---------------------------------------------------------------- helpers
  function show(type, text) {
    message.className = "form-message " + type;
    message.textContent = text;
    message.hidden = false;
  }
  function clearMessage() {
    message.hidden = true;
    message.textContent = "";
  }
  function setBusy(on, label) {
    busy = on;
    [chooseBtn, saveBtn, cancelBtn, removeBtn].forEach(b => { b.disabled = on; });
    if (on) {
      saveBtn.dataset.label = saveBtn.textContent;
      if (label) saveBtn.textContent = label;
    } else if (saveBtn.dataset.label) {
      saveBtn.textContent = saveBtn.dataset.label;
    }
  }
  function currentProfile() {
    return Auth.getState().profile;
  }
  function fail(error, fallback) {
    // Messages raised on purpose by set_my_avatar() are written for people; anything else is generic.
    const code = error && error.code;
    if (error && error.message && (code === "42501" || code === "22023")) return error.message;
    return fallback;
  }

  // ---------------------------------------------------------------- cropper
  function clamp() {
    const w = img.naturalWidth * (VIEW / Math.min(img.naturalWidth, img.naturalHeight)) * zoom;
    const h = img.naturalHeight * (VIEW / Math.min(img.naturalWidth, img.naturalHeight)) * zoom;
    const maxX = Math.max(0, (w - VIEW) / 2);
    const maxY = Math.max(0, (h - VIEW) / 2);
    offX = Math.min(maxX, Math.max(-maxX, offX));
    offY = Math.min(maxY, Math.max(-maxY, offY));
  }

  // Draws the picture into any square canvas context of the given size.
  function render(c, size) {
    const base = size / Math.min(img.naturalWidth, img.naturalHeight);
    const scale = base * zoom;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const k = size / VIEW;
    c.fillStyle = "#fff"; // transparent PNGs get a white background
    c.fillRect(0, 0, size, size);
    c.drawImage(img, (size - w) / 2 + offX * k, (size - h) / 2 + offY * k, w, h);
  }
  function draw() {
    if (img) render(ctx, VIEW);
  }

  let drag = null;
  canvas.addEventListener("pointerdown", event => {
    if (!img) return;
    drag = { x: event.clientX, y: event.clientY, ox: offX, oy: offY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!drag) return;
    const factor = VIEW / canvas.getBoundingClientRect().width;
    offX = drag.ox + (event.clientX - drag.x) * factor;
    offY = drag.oy + (event.clientY - drag.y) * factor;
    clamp();
    draw();
  });
  ["pointerup", "pointercancel"].forEach(type => canvas.addEventListener(type, () => { drag = null; }));
  canvas.addEventListener("keydown", event => {
    if (!img) return;
    const step = 10;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (!moves[event.key]) return;
    event.preventDefault();
    offX += moves[event.key][0];
    offY += moves[event.key][1];
    clamp();
    draw();
  });
  zoomInput.addEventListener("input", () => {
    if (!img) return;
    zoom = parseFloat(zoomInput.value) || 1;
    clamp();
    draw();
  });

  // ------------------------------------------------------------ choose file
  function resetEditor() {
    img = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    zoom = 1; offX = 0; offY = 0;
    zoomInput.value = "1";
    stage.hidden = true;
    saveBtn.hidden = true;
    cancelBtn.hidden = true;
    updateControls();
  }

  function openFile(file) {
    clearMessage();
    if (!ALLOWED.includes(file.type)) return show("error", "Please choose a PNG, JPG or WEBP image.");
    if (file.size > MAX_SOURCE_BYTES) return show("error", "That file is over 10 MB. Please choose a smaller image.");

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (Math.min(image.naturalWidth, image.naturalHeight) < MIN_SIDE) {
        URL.revokeObjectURL(url);
        return show("error", "That image is too small. Please use one that is at least " + MIN_SIDE + " × " + MIN_SIDE + " pixels.");
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = url;
      img = image;
      zoom = 1; offX = 0; offY = 0;
      zoomInput.value = "1";
      stage.hidden = false;
      saveBtn.hidden = false;
      cancelBtn.hidden = false;
      draw();
      updateControls();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      show("error", "We couldn't read that image. Try a different file.");
    };
    image.src = url;
  }

  chooseBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) openFile(file);
  });
  cancelBtn.addEventListener("click", () => { clearMessage(); resetEditor(); });

  // ------------------------------------------------------------------- save
  function toBlob(source, type, quality) {
    return new Promise(resolve => source.toBlob(resolve, type, quality));
  }
  async function exportBlob() {
    const out = document.createElement("canvas");
    out.width = out.height = OUT;
    render(out.getContext("2d"), OUT);
    let blob = await toBlob(out, "image/webp", 0.9);
    // Some browsers can't encode WEBP and silently return PNG, so fall back to JPEG.
    if (!blob || blob.type !== "image/webp") blob = await toBlob(out, "image/jpeg", 0.9);
    return blob;
  }
  function removeFile(path) {
    // Cleanup only: a failure here must never block the user.
    return Auth.client.storage.from(BUCKET).remove([path]).catch(() => {});
  }

  saveBtn.addEventListener("click", async () => {
    if (busy || !img) return;
    clearMessage();
    const { session, profile } = Auth.getState();
    if (!session || !Auth.emailConfirmed(session)) return show("error", "Please confirm your email before adding a picture.");

    const oldPath = profile && profile.avatar_url; // read now, before the profile refreshes
    setBusy(true, "Saving…");
    try {
      const blob = await exportBlob();
      if (!blob) throw new Error("We couldn't prepare that image. Try a different one.");
      if (blob.size > MAX_OUTPUT_BYTES) throw new Error("That picture is too large. Try a smaller image.");

      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      const path = session.user.id + "/" + crypto.randomUUID() + "." + ext;

      const upload = await Auth.client.storage.from(BUCKET).upload(path, blob, {
        contentType: blob.type,
        cacheControl: "31536000", // safe: every upload gets a brand-new file name
        upsert: false
      });
      if (upload.error) throw new Error("The picture couldn't be uploaded. Please try again.");

      const { error } = await Auth.client.rpc("set_my_avatar", { new_path: path });
      if (error) {
        await removeFile(path); // don't leave an orphaned upload behind
        throw new Error(fail(error, "Your picture couldn't be saved. Please try again."));
      }

      if (oldPath && oldPath !== path) await removeFile(oldPath);
      await Auth.refreshProfile();
      resetEditor();
      show("success", "Profile picture updated.");
    } catch (error) {
      show("error", error.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  });

  // ----------------------------------------------------------------- remove
  removeBtn.addEventListener("click", async () => {
    if (busy) return;
    const profile = currentProfile();
    if (!profile || !profile.avatar_url) return;
    const oldPath = profile.avatar_url;
    if (!window.confirm("Remove your profile picture?")) return;
    clearMessage();
    setBusy(true);
    try {
      const { error } = await Auth.client.rpc("set_my_avatar", { new_path: null });
      if (error) throw new Error(fail(error, "Couldn't remove your picture. Please try again."));
      await removeFile(oldPath);
      await Auth.refreshProfile();
      show("success", "Profile picture removed.");
    } catch (error) {
      show("error", error.message);
    } finally {
      setBusy(false);
    }
  });

  // --------------------------------------------------------------- controls
  function updateControls() {
    const profile = currentProfile();
    const hasPhoto = Boolean(profile && profile.avatar_url);
    chooseBtn.textContent = hasPhoto ? "Change photo" : "Choose photo";
    removeBtn.hidden = !hasPhoto || Boolean(img);
  }

  Auth.ready.then(updateControls);
  Auth.onChange(event => {
    if (event === "SIGNED_OUT") { clearMessage(); resetEditor(); }
    updateControls();
  });
})();
