const form = document.getElementById("createForm");
const fileInput = document.getElementById("designFile");
const uploadZone = document.getElementById("uploadZone");
const previewWrap = document.getElementById("previewWrap");
const imagePreview = document.getElementById("imagePreview");
const fileHint = document.getElementById("fileHint");
let selectedFile = null;
let previewUrl = null;

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_BYTES = 10 * 1024 * 1024;

function setFile(file) {
  if (!file) return;
  if (!EXTENSIONS[file.type]) {
    showToast("Please choose a PNG, JPG, WEBP, or GIF image.");
    fileInput.value = "";
    return;
  }
  if (file.size > MAX_BYTES) {
    showToast("That image is over 10 MB. Please choose a smaller file.");
    fileInput.value = "";
    return;
  }
  selectedFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  imagePreview.src = previewUrl;
  previewWrap.hidden = false;
  uploadZone.hidden = true;
  fileHint.textContent = file.name + " · " + (file.size / (1024 * 1024)).toFixed(2) + " MB";
}
if (fileInput) fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
if (uploadZone) {
  ["dragenter", "dragover"].forEach(type => uploadZone.addEventListener(type, event => {
    event.preventDefault(); uploadZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(type => uploadZone.addEventListener(type, event => {
    event.preventDefault(); uploadZone.classList.remove("dragover");
  }));
  uploadZone.addEventListener("drop", event => setFile(event.dataTransfer.files[0]));
}
const removeImage = document.getElementById("removeImage");
if (removeImage) removeImage.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  previewWrap.hidden = true;
  uploadZone.hidden = false;
  fileHint.textContent = "For best results, use a high-resolution image.";
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
});
const titleInput = document.getElementById("designTitle");
const descriptionInput = document.getElementById("designDescription");
if (titleInput) titleInput.addEventListener("input", () => document.getElementById("titleCounter").textContent = titleInput.value.length + " / 80");
if (descriptionInput) descriptionInput.addEventListener("input", () => document.getElementById("descriptionCounter").textContent = descriptionInput.value.length + " / 500");

// Publishing needs a signed-in user with a confirmed email. The browser check below
// is only a convenience: the database (RLS + storage policies) enforces the same rule.
const authNotice = document.getElementById("authNotice");
function canPublish(state) {
  return Boolean(state.session && window.PinDropAuth.emailConfirmed(state.session));
}
if (window.PinDropAuth && window.PinDropAuth.configured) {
  const updateNotice = () => {
    if (!authNotice) return;
    const ok = canPublish(window.PinDropAuth.getState());
    authNotice.hidden = ok;
    if (!ok) {
      authNotice.textContent = "";
      authNotice.append("Sign in with a confirmed email to publish. ");
      const link = document.createElement("a");
      link.href = "account.html";
      link.textContent = "Go to your account →";
      authNotice.appendChild(link);
    }
  };
  window.PinDropAuth.ready.then(updateNotice);
  window.PinDropAuth.onChange(updateNotice);
}

function parseTags(raw) {
  const seen = new Set();
  const tags = [];
  raw.split(",").forEach(part => {
    const tag = part.trim().replace(/^#+/, "").slice(0, 30);
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) { seen.add(key); tags.push(tag); }
  });
  return tags.slice(0, 8);
}

if (form) form.addEventListener("submit", async event => {
  event.preventDefault();
  const Auth = window.PinDropAuth;
  if (!Auth || !Auth.configured) { showToast("Publishing is unavailable right now."); return; }
  await Auth.ready;
  const { session } = Auth.getState();
  if (!canPublish(Auth.getState())) { showToast("Please sign in with a confirmed email to publish."); return; }
  if (!selectedFile) { showToast("Please upload an image of your design."); return; }
  if (!form.reportValidity()) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton ? submitButton.innerHTML : "";
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Uploading…"; }
  const restore = () => { if (submitButton) { submitButton.disabled = false; submitButton.innerHTML = originalLabel; } };

  const userId = session.user.id;
  const path = userId + "/" + crypto.randomUUID() + "." + EXTENSIONS[selectedFile.type];

  const upload = await Auth.client.storage.from("designs").upload(path, selectedFile, {
    contentType: selectedFile.type,
    cacheControl: "3600",
    upsert: false
  });
  if (upload.error) {
    restore();
    showToast("The image couldn't be uploaded. Please try again.");
    return;
  }

  const { error } = await Auth.client.from("posts").insert({
    author_id: userId,
    title: titleInput.value.trim(),
    description: descriptionInput.value.trim(),
    category: document.getElementById("designCategory").value,
    tags: parseTags(document.getElementById("designTags").value),
    open_to_battles: document.getElementById("allowBattle").checked,
    image_path: path
  });
  if (error) {
    // Don't leave an orphaned image behind.
    await Auth.client.storage.from("designs").remove([path]);
    restore();
    showToast("Your design couldn't be saved. Please check the details and try again.");
    return;
  }
  window.location.href = "index.html?submitted=1";
});
