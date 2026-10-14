const form = document.getElementById("createForm");
const fileInput = document.getElementById("designFile");
const uploadZone = document.getElementById("uploadZone");
const previewWrap = document.getElementById("previewWrap");
const imagePreview = document.getElementById("imagePreview");
const fileHint = document.getElementById("fileHint");
let selectedFile = null;
let previewUrl = null;

function setFile(file) {
  if (!file) return;
  const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!allowed.includes(file.type)) {
    showToast("Please choose a PNG, JPG, WEBP, or GIF image.");
    fileInput.value = "";
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
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

function readPosts() {
  try { return JSON.parse(localStorage.getItem("pindrop.posts") || "[]"); }
  catch { return []; }
}
if (form) form.addEventListener("submit", event => {
  event.preventDefault();
  if (!selectedFile) { showToast("Please upload an image of your design."); return; }
  if (!form.reportValidity()) return;

  const reader = new FileReader();
  reader.onload = () => {
    const post = {
      id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      title: titleInput.value.trim(),
      description: descriptionInput.value.trim(),
      category: document.getElementById("designCategory").value,
      tags: document.getElementById("designTags").value.split(",").map(tag => tag.trim()).filter(Boolean),
      openToBattles: document.getElementById("allowBattle").checked,
      image: reader.result,
      createdAt: new Date().toISOString()
    };
    const posts = readPosts();
    posts.unshift(post);
    try {
      localStorage.setItem("pindrop.posts", JSON.stringify(posts));
      localStorage.setItem("pindrop.lastPublished", post.id);
      window.location.href = "index.html?published=1";
    } catch (error) {
      showToast("This image may be too large for browser storage. Try a smaller image.");
    }
  };
  reader.onerror = () => showToast("The image could not be read. Please try again.");
  reader.readAsDataURL(selectedFile);
});
