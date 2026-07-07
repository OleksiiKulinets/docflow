let currentFileId = null;
let currentContent = "";

const els = {
  uploadInput: document.getElementById("upload-input"),
  fileSearch: document.getElementById("file-search"),
  searchWrap: document.getElementById("header-search-wrap"),
  searchDropdown: document.getElementById("search-dropdown"),
  fileList: document.getElementById("file-list"),
  fileListEmpty: document.getElementById("file-list-empty"),
  sidebarFileList: document.getElementById("sidebar-file-list"),
  sidebarFileEmpty: document.getElementById("sidebar-file-empty"),
  fileCount: document.getElementById("file-count"),
  saveBtn: document.getElementById("save-btn"),
  exportBtn: document.getElementById("export-btn"),
  breadcrumb: document.querySelector(".breadcrumb-current"),
  contentFilename: document.querySelector(".content-filename"),
  previewPanel: document.getElementById("preview-panel"),
  preview: document.getElementById("preview"),
  rawEditor: document.getElementById("raw-editor"),
  tabPreview: document.getElementById("tab-preview"),
  tabRaw: document.getElementById("tab-raw"),
  statusText: document.getElementById("status-text"),
  statusEncoding: document.getElementById("status-encoding"),
};

let currentExtension = null;
let activeTab = "preview";
let allFiles = [];

function setStatus(message, isError = false) {
  els.statusText.textContent = message;
  els.statusText.classList.toggle("is-error", isError);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileIcon(ext) {
  const icons = { ".txt": "📄", ".docx": "📝", ".pdf": "📕" };
  return icons[ext] || "📁";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setDropdownOpen(isOpen) {
  els.searchDropdown.hidden = !isOpen;
  els.fileSearch.setAttribute("aria-expanded", String(isOpen));
  els.searchWrap.classList.toggle("is-open", isOpen);
}

function filterFiles(query = "") {
  const q = query.trim().toLowerCase();
  if (!q) return allFiles;
  return allFiles.filter((file) => file.name.toLowerCase().includes(q));
}

function renderSearchResults(files) {
  els.fileList.innerHTML = "";

  if (!files.length) {
    els.fileListEmpty.hidden = false;
    els.fileListEmpty.textContent = els.fileSearch.value.trim()
      ? "No files found"
      : "No uploaded files yet";
    return;
  }

  els.fileListEmpty.hidden = true;

  files.forEach((file) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "file-item";
    item.dataset.id = file.id;
    if (file.id === currentFileId) item.classList.add("is-active");

    item.innerHTML = `
      <span class="file-item-icon" aria-hidden="true">${fileIcon(file.extension)}</span>
      <span class="file-item-body">
        <span class="file-item-name">${escapeHtml(file.name)}</span>
        <span class="file-item-meta">${formatSize(file.size)}</span>
      </span>
    `;

    item.addEventListener("click", () => {
      openFile(file.id);
      setDropdownOpen(false);
    });

    els.fileList.appendChild(item);
  });
}

function renderSidebarFiles(files) {
  els.sidebarFileList.innerHTML = "";
  els.fileCount.textContent = String(allFiles.length);

  if (!files.length) {
    els.sidebarFileEmpty.hidden = false;
    els.sidebarFileEmpty.textContent = allFiles.length
      ? "No matching files"
      : "No files uploaded yet";
    return;
  }

  els.sidebarFileEmpty.hidden = true;

  files.forEach((file) => {
    const row = document.createElement("div");
    row.className = "sidebar-file-item";
    if (file.id === currentFileId) row.classList.add("is-active");

    row.innerHTML = `
      <button type="button" class="sidebar-file-open" data-id="${file.id}">
        <span class="sidebar-file-icon" aria-hidden="true">${fileIcon(file.extension)}</span>
        <span class="sidebar-file-info">
          <span class="sidebar-file-name">${escapeHtml(file.name)}</span>
          <span class="sidebar-file-meta">${formatSize(file.size)} · ${formatDate(file.uploaded_at)}</span>
        </span>
      </button>
      <button type="button" class="sidebar-file-delete" data-id="${file.id}" title="Delete file" aria-label="Delete ${escapeHtml(file.name)}">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5.25V3h2.25a.75.75 0 0 1 0 1.5H12v8.25a1.75 1.75 0 0 1-1.75 1.75h-4.5A1.75 1.75 0 0 1 4 12.75V4.5H1.75a.75.75 0 0 1 0-1.5H4V2h1.5ZM5 4.5v8.25a.25.25 0 0 0 .25.25h5.5a.25.25 0 0 0 .25-.25V4.5H5Z"/>
        </svg>
      </button>
    `;

    row.querySelector(".sidebar-file-open").addEventListener("click", () => openFile(file.id));
    row.querySelector(".sidebar-file-delete").addEventListener("click", (event) => {
      event.stopPropagation();
      deleteFile(file.id, file.name);
    });

    els.sidebarFileList.appendChild(row);
  });
}

function renderAllFileLists(query = "") {
  const filtered = filterFiles(query);
  renderSearchResults(filtered);
  renderSidebarFiles(filtered);
}

async function refreshFileList(query = "") {
  const result = await window.pywebview.api.list_files("");
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  allFiles = result.files;
  renderAllFileLists(query);
}

function clearEditor() {
  currentFileId = null;
  currentExtension = null;
  currentContent = "";
  els.breadcrumb.textContent = "No file selected";
  els.contentFilename.textContent = "No file selected";
  els.preview.innerHTML = '<p class="preview-empty">Upload a file or select one from the sidebar.</p>';
  els.rawEditor.value = "";
  els.exportBtn.disabled = true;
  els.saveBtn.disabled = false;
  els.previewPanel.classList.remove("is-pdf", "is-docx", "is-txt", "is-editable");
  if (typeof Editor !== "undefined") Editor.setEnabled(false);
}

async function deleteFile(fileId, fileName) {
  if (!window.confirm(`Delete "${fileName}"?`)) return;

  const result = await window.pywebview.api.delete_file(fileId);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  if (currentFileId === fileId) clearEditor();

  await refreshFileList(els.fileSearch.value);
  setStatus(`Deleted ${fileName}`);
}

function setActiveTab(tab) {
  activeTab = tab;
  const isPreview = tab === "preview";

  els.tabPreview.classList.toggle("is-active", isPreview);
  els.tabRaw.classList.toggle("is-active", !isPreview);
  els.preview.hidden = !isPreview;
  els.rawEditor.hidden = isPreview;
  els.previewPanel.classList.toggle("is-raw", !isPreview);

  const isEditable = currentExtension === ".docx" || currentExtension === ".txt";
  if (typeof Editor !== "undefined") {
    Editor.setEnabled(isEditable && isPreview);
  }
}

function updateRawTabState() {
  const isTxt = currentExtension === ".txt";
  els.tabRaw.disabled = !isTxt;
  if (!isTxt && activeTab === "raw") setActiveTab("preview");
}

function collectEditableHtml() {
  if (typeof Editor !== "undefined" && Editor.getHtml) {
    return Editor.getHtml();
  }
  const editable = els.preview.querySelector(".docx-editable");
  return editable ? editable.innerHTML : "";
}

async function openFile(fileId) {
  const result = await window.pywebview.api.get_file(fileId);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  currentFileId = fileId;
  currentContent = result.content ?? "";
  currentExtension = result.meta.extension;
  const { meta, preview_html: previewHtml } = result;

  els.breadcrumb.textContent = meta.name;
  els.contentFilename.textContent = meta.name;
  els.preview.innerHTML = previewHtml;
  els.rawEditor.value = currentContent;
  els.statusEncoding.textContent = meta.extension === ".txt" ? "UTF-8" : meta.extension.toUpperCase().slice(1);

  const isEditable = meta.extension === ".docx" || meta.extension === ".txt";
  els.previewPanel.classList.toggle("is-pdf", meta.extension === ".pdf");
  els.previewPanel.classList.toggle("is-docx", meta.extension === ".docx");
  els.previewPanel.classList.toggle("is-txt", meta.extension === ".txt");
  els.previewPanel.classList.toggle("is-editable", isEditable);
  els.saveBtn.disabled = meta.extension === ".pdf";
  els.exportBtn.disabled = false;

  if (typeof Editor !== "undefined") {
    Editor.setEnabled(isEditable && activeTab === "preview");
    if (isEditable) Editor.prepareEditable?.();
  }

  updateRawTabState();
  setActiveTab("preview");
  renderAllFileLists(els.fileSearch.value);
  setStatus(`Opened ${meta.name}`);
}

async function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  setStatus(`Uploading ${file.name}…`);

  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(",")[1];
    const result = await window.pywebview.api.upload_file(file.name, base64);

    if (!result.ok) {
      setStatus(result.error, true);
      return;
    }

    els.fileSearch.value = "";
    await refreshFileList();
    await openFile(result.file.id);
    setStatus(`Uploaded ${result.file.name}`);
    event.target.value = "";
  };

  reader.onerror = () => setStatus("Failed to read file", true);
  reader.readAsDataURL(file);
}

async function handleSave() {
  if (!currentFileId) {
    setStatus("No file selected", true);
    return;
  }

  if (currentExtension === ".pdf") {
    setStatus("PDF files cannot be edited", true);
    return;
  }

  let result;

  if (currentExtension === ".docx" || (currentExtension === ".txt" && activeTab === "preview")) {
    result = await window.pywebview.api.save_file(currentFileId, null, collectEditableHtml());
  } else {
    result = await window.pywebview.api.save_file(currentFileId, els.rawEditor.value, null);
    if (result.ok) currentContent = els.rawEditor.value;
  }

  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  const reopened = await window.pywebview.api.get_file(currentFileId);
  if (reopened.ok) {
    els.preview.innerHTML = reopened.preview_html;
    if (reopened.content != null) {
      currentContent = reopened.content;
      els.rawEditor.value = reopened.content;
    }
  }

  await refreshFileList(els.fileSearch.value);
  setStatus(`Saved ${result.file.name}`);
}

async function handleExport() {
  if (!currentFileId) {
    setStatus("No file selected", true);
    return;
  }

  if (currentExtension !== ".pdf") {
    const html = collectEditableHtml();
    if (html || currentExtension === ".txt") {
      const saveFirst = await window.pywebview.api.save_file(
        currentFileId,
        currentExtension === ".txt" && activeTab === "raw" ? els.rawEditor.value : null,
        html || null,
      );
      if (!saveFirst.ok) {
        setStatus(saveFirst.error, true);
        return;
      }
    }
  }

  const result = await window.pywebview.api.export_file(currentFileId);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  if (result.cancelled) {
    setStatus("Download cancelled");
    return;
  }

  setStatus(`Downloaded ${result.file.name}`);
}

function bindEvents() {
  els.uploadInput.addEventListener("change", handleUpload);
  els.saveBtn.addEventListener("click", handleSave);
  els.exportBtn.addEventListener("click", handleExport);

  els.tabPreview.addEventListener("click", () => setActiveTab("preview"));
  els.tabRaw.addEventListener("click", () => {
    if (!els.tabRaw.disabled) setActiveTab("raw");
  });

  els.rawEditor.addEventListener("input", () => {
    currentContent = els.rawEditor.value;
  });

  els.fileSearch.addEventListener("input", () => {
    renderAllFileLists(els.fileSearch.value);
    setDropdownOpen(true);
  });

  els.fileSearch.addEventListener("focus", () => {
    renderAllFileLists(els.fileSearch.value);
    setDropdownOpen(true);
  });

  document.addEventListener("click", (event) => {
    if (!els.searchWrap.contains(event.target)) setDropdownOpen(false);
  });

  els.fileSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setDropdownOpen(false);
      els.fileSearch.blur();
    }
  });
}

function waitForApi() {
  return new Promise((resolve) => {
    if (window.pywebview?.api) {
      resolve();
      return;
    }
    window.addEventListener("pywebviewready", resolve, { once: true });
  });
}

async function init() {
  bindEvents();
  await waitForApi();
  await refreshFileList();
  setStatus("Ready");
}

init();
