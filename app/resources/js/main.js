let currentFileId = null;
let currentFileName = null;
let currentContent = "";
let currentDocumentSettings = {};
let applyingDocumentSetting = false;

const els = AppDom;

let currentExtension = null;
let activeTab = "preview";
let allFiles = [];
let openRequestToken = 0;
let rulesViewStale = true;
let rulesEditorLoaded = false;
let cachedEditHtml = null;
let cachedPreviewHtml = null;
let sessionInnerHtml = null;
let appCloseInProgress = false;

const decodeApiHtml = ApiClient.decodeHtml;
const encodeHtmlForApi = ApiClient.encodeHtml;

function isAllowedFile(file) {
  return AppUtils.isAllowedFile(file);
}

function readFileAsBase64(file, onProgress) {
  return AppUtils.readFileAsBase64(file, onProgress);
}

function applyFileResult(result, { fileId, token } = {}) {
  if (token != null && token !== openRequestToken) return false;

  const meta = result.meta || result.file;
  if (!meta) return false;

  currentFileId = fileId || meta.id;
  currentContent = result.content ?? "";
  currentExtension = meta.extension;
  const documentSettings = result.document_settings || {};
  const previewHtml = decodeApiHtml(result, "preview_html");

  currentDocumentSettings = {
    ...documentSettings,
    condition_values: {},
  };
  delete currentDocumentSettings.is_bank_employee;
  rulesViewStale = true;
  cachedEditHtml = null;
  cachedPreviewHtml = null;
  sessionInnerHtml = null;

  els.breadcrumb.textContent = meta.name;
  currentFileName = meta.name;
  if (!setPreviewHtml(previewHtml)) {
    setStatus("Документ не відобразився — спробуйте ще раз", true);
  } else {
    cachedPreviewHtml = previewHtml;
  }
  els.statusEncoding.textContent = meta.extension === ".txt" ? "UTF-8" : meta.extension.toUpperCase().slice(1);

  const isEditable = meta.extension === ".docx" || meta.extension === ".txt";
  els.previewPanel.classList.toggle("is-pdf", meta.extension === ".pdf");
  els.previewPanel.classList.toggle("is-docx", meta.extension === ".docx");
  els.previewPanel.classList.toggle("is-txt", meta.extension === ".txt");
  els.previewPanel.classList.toggle("is-editable", isEditable);
  els.saveBtn.disabled = meta.extension === ".pdf";
  updateDocumentActions();

  updateEditTabState();
  void setActiveTab("preview", { skipPreviewReload: true });
  if (typeof Editor !== "undefined" && isEditable) {
    Editor.setEnabled(true);
    Editor.prepareEditable?.();
  }
  renderAllFileLists(els.fileSearch.value);
  setStatus(`Відкрито ${meta.name}`);
  requestAnimationFrame(() => Unsaved.reset());
  return true;
}

async function uploadAndOpen(file) {
  if (!file) return false;

  if (!(await confirmDiscardUnsaved())) return false;

  if (!isAllowedFile(file)) {
    setStatus("Підтримуються лише файли DOCX, TXT і PDF", true);
    return false;
  }

  const job = Loading.start({ title: file.name, subtitle: "Читання файлу…" });
  const token = ++openRequestToken;

  try {
    const base64 = await readFileAsBase64(file, (ratio) => {
      Loading.update(job, {
        progress: Math.round(ratio * 28),
        subtitle: "Читання файлу…",
      });
    });

    Loading.update(job, { progress: 32, subtitle: "Завантаження на сервер…" });
    const result = await window.pywebview.api.upload_file(file.name, base64);

    if (!result.ok) {
      setStatus(result.error, true);
      Loading.fail(job, result.error);
      return false;
    }

    const entry = result.file || result.meta;
    const fileId = entry?.id;
    if (!fileId) {
      setStatus("Файл завантажено, але не вдалося відкрити", true);
      await refreshFileList();
      Loading.fail(job);
      return false;
    }

    Loading.update(job, { progress: 78, subtitle: "Підготовка перегляду…" });

    els.fileSearch.value = "";
    allFiles = [entry, ...allFiles.filter((item) => item.id !== fileId)];
    renderAllFileLists("");

    const hasPreview = Boolean(result.preview_html || result.html_encoding?.preview_html);
    if (hasPreview && token === openRequestToken) {
      if (job) Loading.update(job, { progress: 92, subtitle: "Відображення…" });
      applyFileResult(result, { fileId, token });
      Loading.complete(job, "Завантажено");
    } else if (hasPreview) {
      Loading.complete(job, "Завантажено");
    } else {
      await openFile(fileId, { loadingJob: job, token });
    }

    return true;
  } catch (error) {
    setStatus(error.message || "Помилка завантаження", true);
    Loading.fail(job);
    return false;
  } finally {
    els.uploadInput.value = "";
  }
}

function setStatus(message, isError = false) {
  els.statusText.textContent = message;
  els.statusText.classList.toggle("is-error", isError);
}

function formatSize(bytes) {
  return AppUtils.formatSize(bytes);
}

function formatDate(iso) {
  return AppUtils.formatDate(iso);
}

const FILE_TYPE_META = {
  ".docx": { label: "DOCX", tone: "docx" },
  ".pdf": { label: "PDF", tone: "pdf" },
  ".txt": { label: "TXT", tone: "txt" },
};

function fileIconMarkup(ext) {
  const meta = FILE_TYPE_META[ext] || { label: "FILE", tone: "file" };
  return `<span class="file-type-badge file-type-badge--${meta.tone}">${meta.label}</span>`;
}

function escapeHtml(text) {
  return AppUtils.escapeHtml(text);
}

function getDocumentTitle(fallback = "Документ") {
  return currentFileName || fallback;
}

function captureSessionDocument() {
  if (currentExtension !== ".docx" || activeTab !== "preview") return null;
  const html = collectEditableHtml();
  if (html != null) {
    sessionInnerHtml = html;
    rulesViewStale = true;
    invalidatePreviewCache();
  }
  return sessionInnerHtml;
}

async function syncDocumentSource({ html = null, quiet = false } = {}) {
  if (!currentFileId || currentExtension !== ".docx") return true;

  const payloadHtml =
    html ||
    (activeTab === "preview" ? collectEditableHtml() : null) ||
    sessionInnerHtml ||
    cachedPreviewHtml;
  if (!payloadHtml?.trim()) return true;

  sessionInnerHtml = payloadHtml;

  const result = await window.pywebview.api.sync_document_source(
    currentFileId,
    encodeHtmlForApi(payloadHtml),
  );

  if (!result.ok) {
    if (!quiet) setStatus(result.error, true);
    return false;
  }

  currentDocumentSettings = result.document_settings || currentDocumentSettings;
  cachedPreviewHtml = decodeApiHtml(result, "preview_html");
  if (result.edit_html) {
    cachedEditHtml = decodeApiHtml(result, "edit_html");
  }
  rulesViewStale = true;
  return true;
}

function workspaceEmptyMarkup({
  title = "Почніть з документа",
  hint = "Оберіть файл зліва або перетягніть його в зону завантаження",
  showGuide = true,
} = {}) {
  const visual = showGuide
    ? `
      <div class="workspace-empty-visual" aria-hidden="true">
        <span class="workspace-empty-glow"></span>
        <svg class="workspace-empty-route" viewBox="0 0 260 88" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path class="workspace-empty-route-path" d="M236 44C180 44 140 44 92 44C62 44 42 44 24 44"/>
          <circle class="workspace-empty-route-dot" r="4" cx="0" cy="0"/>
        </svg>
        <span class="workspace-empty-doc"></span>
      </div>`
    : "";

  return `
    <div class="workspace-empty" role="status" aria-live="polite">
      ${visual}
      <h2 class="workspace-empty-title">${escapeHtml(title)}</h2>
      <p class="workspace-empty-hint">${escapeHtml(hint)}</p>
    </div>
  `;
}

function emptyPreviewMarkup(options = {}) {
  return workspaceEmptyMarkup(options);
}

function showWelcomePreview() {
  if (!els.preview) return;
  els.preview.innerHTML = emptyPreviewMarkup();
}

function setPreviewHtml(html) {
  if (!html || !html.trim()) {
    els.preview.innerHTML = emptyPreviewMarkup({
      title: "Документ порожній",
      hint: "Файл відкрито, але вміст не завантажився",
      showGuide: false,
    });
    return false;
  }
  els.preview.innerHTML = html;
  els.preview.scrollTop = 0;
  els.preview.scrollLeft = 0;
  return true;
}

function updateSearchClearButton() {
  const hasQuery = Boolean(els.fileSearch?.value.trim());
  if (els.fileSearchClear) els.fileSearchClear.hidden = !hasQuery;
}

function filterFiles(query = "") {
  const q = query.trim().toLowerCase();
  if (!q) return allFiles;
  return allFiles.filter((file) => file.name.toLowerCase().includes(q));
}

function renderSidebarFiles(files) {
  els.sidebarFileList.innerHTML = "";
  els.fileCount.textContent = String(allFiles.length);
  updateSearchClearButton();

  if (!files.length) {
    els.sidebarFileEmpty.hidden = false;
    els.sidebarFileEmpty.textContent = allFiles.length
      ? "Немає відповідних файлів"
      : "Ще немає файлів";
    return;
  }

  els.sidebarFileEmpty.hidden = true;

  files.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "sidebar-file-item";
    row.style.setProperty("--item-index", String(index));
    if (file.id === currentFileId) row.classList.add("is-active");

    row.innerHTML = `
      <button type="button" class="sidebar-file-open" data-id="${file.id}">
        <span class="sidebar-file-icon" aria-hidden="true">${fileIconMarkup(file.extension)}</span>
        <span class="sidebar-file-info">
          <span class="sidebar-file-name">${escapeHtml(file.name)}</span>
          <span class="sidebar-file-meta">${formatSize(file.size)} · ${formatDate(file.uploaded_at)}</span>
        </span>
      </button>
      <button type="button" class="sidebar-file-delete" data-id="${file.id}" title="Видалити файл" aria-label="Видалити ${escapeHtml(file.name)}">
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
  currentDocumentSettings = {};
  rulesViewStale = true;
  rulesEditorLoaded = false;
  sessionInnerHtml = null;
  cachedEditHtml = null;

  updateConditionsPanel();
  renderConditionsList();
  els.breadcrumb.textContent = "Файл не вибрано";
  currentFileName = null;
  els.preview.innerHTML = emptyPreviewMarkup();
  updateDocumentActions();
  els.saveBtn.disabled = false;
  els.previewPanel.classList.remove("is-pdf", "is-docx", "is-txt", "is-editable", "is-edit");
  if (els.rulesPanel) {
    els.rulesPanel.setAttribute("aria-hidden", "true");
  }
  if (typeof Editor !== "undefined") Editor.setEnabled(false);
  rulesViewStale = true;
  updateEditTabState();
  Unsaved.reset();
}

async function deleteFile(fileId, fileName) {
  if (currentFileId === fileId && !(await confirmDiscardUnsaved())) return;

  const confirmed = await Dialogs.confirm({
    title: "Видалити файл?",
    message: `«${fileName}» буде остаточно видалено з DocFlow.`,
    detail: "Цю дію не можна скасувати. Оригінальний файл на диску також буде видалено.",
    confirmText: "Видалити",
    cancelText: "Залишити",
    variant: "danger",
  });
  if (!confirmed) return;

  const job = Loading.start({ title: fileName, subtitle: "Видалення…" });

  try {
    Loading.update(job, { indeterminate: true, subtitle: "Видалення файлу…" });
    const result = await window.pywebview.api.delete_file(fileId);
    if (!result.ok) {
      setStatus(result.error, true);
      Loading.fail(job, result.error);
      return;
    }

    Loading.update(job, { progress: 72, subtitle: "Оновлення списку…" });
    if (currentFileId === fileId) clearEditor();

    await refreshFileList(els.fileSearch.value);
    setStatus(`Видалено ${fileName}`);
    Loading.complete(job, "Видалено");
  } catch (error) {
    setStatus(error.message || "Помилка видалення", true);
    Loading.fail(job);
  }
}

function invalidatePreviewCache() {
  cachedPreviewHtml = null;
}

function runTabTransition(isEdit) {
  void isEdit;
}

const TAB_TRANSITION_MS = 170;
let savedPreviewScrollTop = 0;
let savedRulesPanelScrollTop = 0;

function beginTabTransition() {
  els.previewPanel?.classList.add("is-tab-transitioning");
}

function endTabTransition() {
  window.setTimeout(() => {
    els.previewPanel?.classList.remove("is-tab-transitioning");
  }, TAB_TRANSITION_MS);
}

function captureTabScrollPositions(wasPreview, wasEdit) {
  if (wasPreview && els.preview) {
    savedPreviewScrollTop = els.preview.scrollTop;
  }
  if (wasEdit && els.rulesPanelScroll) {
    savedRulesPanelScrollTop = els.rulesPanelScroll.scrollTop;
  }
}

function restoreTabScrollPositions(isPreview, isEdit) {
  requestAnimationFrame(() => {
    if (isPreview && els.preview) {
      els.preview.scrollTop = savedPreviewScrollTop;
    }
    if (isEdit && els.rulesPanelScroll) {
      els.rulesPanelScroll.scrollTop = savedRulesPanelScrollTop;
    }
  });
}

async function setActiveTab(tab, options = {}) {
  const { skipPreviewReload = false } = options;
  const wasPreview = activeTab === "preview";
  const wasEdit = activeTab === "edit";

  captureTabScrollPositions(wasPreview, wasEdit);
  beginTabTransition();

  let pendingSyncHtml = null;
  if (wasPreview && tab !== "preview" && currentExtension === ".docx") {
    pendingSyncHtml = captureSessionDocument() || collectEditableHtml() || sessionInnerHtml;
  }

  activeTab = tab;
  const isPreview = tab === "preview";
  const isEdit = tab === "edit";
  const isDocx = currentExtension === ".docx";
  const isTxt = currentExtension === ".txt";

  els.tabPreview.classList.toggle("is-active", isPreview);
  els.tabEdit?.classList.toggle("is-active", isEdit);
  els.preview.hidden = false;
  els.previewPanel.classList.toggle("is-edit", isEdit);

  if (els.rulesPanel) {
    els.rulesPanel.setAttribute("aria-hidden", String(!isEdit));
  }
  updateRulesPanelResizerVisibility();

  if (typeof Editor !== "undefined") {
    Editor.setEnabled((isDocx || isTxt) && isPreview);
  }

  if (wasEdit && isPreview && rulesEditorLoaded && typeof VariantEditor !== "undefined") {
    currentDocumentSettings = {
      ...currentDocumentSettings,
      variant_rules: VariantEditor.getRules(),
      has_configured_rules: VariantEditor.hasConfiguredRules(),
      active_condition_ids: VariantEditor.getActiveConditionIds(),
    };
  }

  updateConditionsPanel();

  if (isEdit && isDocx) {
    const synced = await syncDocumentSource({ html: pendingSyncHtml, quiet: true });
    if (!synced) {
      setStatus("Не вдалося синхронізувати зміни з документом", true);
    } else {
      const editHtml = cachedEditHtml;
      cachedEditHtml = null;
      const shouldSyncRulesBaseline = rulesViewStale;
      if (!mountRulesEditor(editHtml, { syncRulesBaseline: shouldSyncRulesBaseline })) {
        await loadEditView({ force: true });
      }
    }
  } else if (isPreview && isDocx && currentFileId && !skipPreviewReload) {
    if (wasEdit) {
      await persistRulesFromEditor({ quiet: true });
      await reloadPreviewFromServer();
    } else {
      restorePreviewFromCacheOrReload(false);
    }
  }

  renderConditionsList();
  restoreTabScrollPositions(isPreview, isEdit);
  endTabTransition();
}

async function reloadPreviewFromServer() {
  if (!currentFileId) return;

  if (sessionInnerHtml?.trim()) {
    await syncDocumentSource({ html: sessionInnerHtml, quiet: true });
  }

  const result = await window.pywebview.api.get_file(currentFileId);
  if (!result.ok) {
    setStatus(result.error || "Не вдалося завантажити перегляд", true);
    return;
  }

  currentDocumentSettings = result.document_settings || currentDocumentSettings;
  const html = decodeApiHtml(result, "preview_html");
  if (!setPreviewHtml(html)) {
    setStatus("Перегляд документа порожній", true);
    return;
  }
  cachedPreviewHtml = html;
  sessionInnerHtml = html;
  rulesViewStale = false;
  if (typeof Editor !== "undefined") {
    Editor.setEnabled(true);
    Editor.prepareEditable?.();
  }
  updateConditionsPanel();
  updateDocumentActions();
}

function restorePreviewFromCacheOrReload(wasEdit) {
  const hasPreviewDoc = els.preview.querySelector(".docx-editable:not(.docx-structure-mode)");

  if (!rulesViewStale && cachedPreviewHtml?.trim()) {
    setPreviewHtml(cachedPreviewHtml);
    if (typeof Editor !== "undefined") {
      Editor.setEnabled(true);
      Editor.prepareEditable?.();
    }
    return;
  }

  if (wasEdit || rulesViewStale || !hasPreviewDoc) {
    reloadPreview(sessionInnerHtml);
    return;
  }

  if (typeof Editor !== "undefined") {
    Editor.setEnabled(true);
    Editor.prepareEditable?.();
  }
}

async function persistRulesFromEditor({ quiet = false } = {}) {
  if (!currentFileId || !rulesEditorLoaded || typeof VariantEditor === "undefined") {
    return true;
  }

  const rules = VariantEditor.getRules();
  const result = await window.pywebview.api.save_variant_rules(currentFileId, rules);
  if (!result.ok) {
    if (!quiet) setStatus(result.error, true);
    return false;
  }

  currentDocumentSettings = result.document_settings || currentDocumentSettings;
  rulesViewStale = false;
  Unsaved.syncRulesBaseline?.();
  return true;
}

async function reloadPreview(sessionHtml = null) {
  if (!currentFileId) return;

  if (rulesEditorLoaded) {
    await persistRulesFromEditor({ quiet: true });
  }

  const useSession = typeof sessionHtml === "string" && sessionHtml.trim();
  const result = useSession
    ? await window.pywebview.api.get_preview_from_html(
        currentFileId,
        encodeHtmlForApi(sessionHtml),
      )
    : await window.pywebview.api.get_file(currentFileId);

  if (!result.ok) {
    setStatus(result.error || "Не вдалося завантажити перегляд", true);
    return;
  }

  currentDocumentSettings = result.document_settings || currentDocumentSettings;
  if (!setPreviewHtml(decodeApiHtml(result, "preview_html"))) {
    setStatus("Перегляд документа порожній", true);
    return;
  }
  cachedPreviewHtml = decodeApiHtml(result, "preview_html");
  if (typeof Editor !== "undefined") {
    Editor.setEnabled(true);
    Editor.prepareEditable?.();
  }
  updateConditionsPanel();
  renderConditionsList();
  updateEditTabState();
}

function updateEditTabState() {
  const isDocx = currentExtension === ".docx";
  if (els.tabEdit) {
    els.tabEdit.disabled = !isDocx;
  }
  if (!isDocx && activeTab === "edit") void setActiveTab("preview");
}

let sidebarCollapsed = localStorage.getItem("docflow-sidebar-collapsed") === "1";

function applySidebarState() {
  els.page?.classList.toggle("is-sidebar-collapsed", sidebarCollapsed);
  if (els.sidebarToggle) {
    els.sidebarToggle.hidden = sidebarCollapsed;
    els.sidebarToggle.setAttribute("aria-expanded", String(!sidebarCollapsed));
  }
  if (els.sidebarExpand) {
    els.sidebarExpand.hidden = !sidebarCollapsed;
    els.sidebarExpand.setAttribute("aria-expanded", String(sidebarCollapsed));
  }
}

function setSidebarCollapsed(collapsed) {
  sidebarCollapsed = collapsed;
  localStorage.setItem("docflow-sidebar-collapsed", collapsed ? "1" : "0");
  applySidebarState();
}

function toggleSidebar() {
  setSidebarCollapsed(!sidebarCollapsed);
}

const RULES_PANEL_WIDTH_KEY = "docflow-rules-panel-width";
const RULES_PANEL_WIDTH_DEFAULT = 420;
const RULES_PANEL_WIDTH_MIN = 300;
const RULES_PANEL_WIDTH_MAX = 760;

let rulesPanelResizeState = null;

function getRulesPanelMaxWidth() {
  const panelWidth = els.previewPanel?.clientWidth || window.innerWidth;
  return Math.min(RULES_PANEL_WIDTH_MAX, Math.max(RULES_PANEL_WIDTH_MIN, Math.round(panelWidth * 0.72)));
}

function applyRulesPanelWidth(width) {
  const max = getRulesPanelMaxWidth();
  const next = Math.max(RULES_PANEL_WIDTH_MIN, Math.min(max, Math.round(width)));
  els.previewPanel?.style.setProperty("--rules-panel-width", `${next}px`);
  return next;
}

function loadRulesPanelWidth() {
  const saved = Number.parseInt(localStorage.getItem(RULES_PANEL_WIDTH_KEY) || "", 10);
  if (Number.isFinite(saved)) return applyRulesPanelWidth(saved);
  return applyRulesPanelWidth(RULES_PANEL_WIDTH_DEFAULT);
}

function updateRulesPanelResizerVisibility() {
  const visible = activeTab === "edit" && els.rulesPanel?.getAttribute("aria-hidden") === "false";
  if (!els.rulesPanelResizer) return;
  els.rulesPanelResizer.hidden = !visible;
  els.rulesPanelResizer.setAttribute("aria-hidden", String(!visible));
}

function initRulesPanelResize() {
  if (!els.rulesPanelResizer || !els.rulesPanel || !els.previewPanel) return;

  loadRulesPanelWidth();
  updateRulesPanelResizerVisibility();

  const finishResize = () => {
    if (!rulesPanelResizeState) return;
    rulesPanelResizeState = null;
    document.body.classList.remove("is-resizing-rules-panel");
    els.rulesPanel?.classList.remove("is-resizing");
    els.rulesPanelResizer?.classList.remove("is-dragging");
    const width = els.rulesPanel?.getBoundingClientRect().width;
    if (width) localStorage.setItem(RULES_PANEL_WIDTH_KEY, String(Math.round(width)));
  };

  els.rulesPanelResizer.addEventListener("mousedown", (event) => {
    if (els.rulesPanelResizer.hidden) return;
    rulesPanelResizeState = {
      startX: event.clientX,
      startWidth: els.rulesPanel.getBoundingClientRect().width,
    };
    document.body.classList.add("is-resizing-rules-panel");
    els.rulesPanel.classList.add("is-resizing");
    els.rulesPanelResizer.classList.add("is-dragging");
    event.preventDefault();
  });

  els.rulesPanelResizer.addEventListener("dblclick", () => {
    const width = applyRulesPanelWidth(RULES_PANEL_WIDTH_DEFAULT);
    localStorage.setItem(RULES_PANEL_WIDTH_KEY, String(width));
    setStatus("Ширину панелі правил скинуто");
  });

  els.rulesPanelResizer.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 40 : 16;
    const current = els.rulesPanel.getBoundingClientRect().width || RULES_PANEL_WIDTH_DEFAULT;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const width = applyRulesPanelWidth(current - step);
      localStorage.setItem(RULES_PANEL_WIDTH_KEY, String(width));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const width = applyRulesPanelWidth(current + step);
      localStorage.setItem(RULES_PANEL_WIDTH_KEY, String(width));
    } else if (event.key === "Home") {
      event.preventDefault();
      const width = applyRulesPanelWidth(RULES_PANEL_WIDTH_DEFAULT);
      localStorage.setItem(RULES_PANEL_WIDTH_KEY, String(width));
    }
  });

  window.addEventListener("mousemove", (event) => {
    if (!rulesPanelResizeState) return;
    const delta = event.clientX - rulesPanelResizeState.startX;
    applyRulesPanelWidth(rulesPanelResizeState.startWidth + delta);
  });

  window.addEventListener("mouseup", finishResize);
  window.addEventListener("blur", finishResize);
  window.addEventListener("resize", () => {
    const current = els.rulesPanel?.getBoundingClientRect().width;
    if (current) applyRulesPanelWidth(current);
  });
}

let loadEditViewPromise = null;

async function loadEditView({ force = false } = {}) {
  if (!currentFileId || currentExtension !== ".docx") return;

  if (loadEditViewPromise) {
    await loadEditViewPromise;
    return;
  }

  loadEditViewPromise = loadEditViewImpl({ force });
  try {
    await loadEditViewPromise;
  } finally {
    loadEditViewPromise = null;
  }
}

function mountRulesEditor(editHtml, { syncRulesBaseline = false } = {}) {
  if (!editHtml?.trim()) return false;
  if (!setPreviewHtml(editHtml)) return false;

  VariantEditor.init({
    previewEl: els.preview,
    conditionsEl: els.rulesConditions,
    rulesTreeEl: els.rulesTree,
    modeBannerEl: els.rulesModeBanner,
    rulesEditorEl: els.rulesEditor,
    statusFn: setStatus,
    onRulesChange: syncPreviewConditionsFromEditor,
  });
  VariantEditor.setRules(currentDocumentSettings.variant_rules || {
    schema_version: 3,
    conditions: [],
    rules: [],
    entries: [],
  });
  VariantEditor.render();
  rulesEditorLoaded = true;
  rulesViewStale = false;
  setStatus("Створіть умову, правило та пункти з документа");
  if (syncRulesBaseline) Unsaved.syncRulesBaseline?.();
  return true;
}

async function loadEditViewImpl({ force = false } = {}) {
  if (!force && rulesEditorLoaded && !rulesViewStale) {
    return;
  }

  const syncRules = rulesViewStale;

  if (!force && cachedEditHtml) {
    const html = cachedEditHtml;
    cachedEditHtml = null;
    if (mountRulesEditor(html, { syncRulesBaseline: syncRules })) {
      return;
    }
  }

  setStatus("Завантаження редактора правил…");
  const result = await window.pywebview.api.get_edit_view(currentFileId);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  currentDocumentSettings = result.document_settings || currentDocumentSettings;
  const editHtml = decodeApiHtml(result, "edit_html");
  cachedEditHtml = editHtml;
  if (!mountRulesEditor(editHtml, { syncRulesBaseline: syncRules })) {
    setStatus("Не вдалося завантажити документ для правил", true);
  }
}

async function handleSaveRules() {
  if (!currentFileId) return;

  const rules = VariantEditor.getRules();
  setStatus("Збереження правил…");
  const result = await window.pywebview.api.save_variant_rules(currentFileId, rules);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  currentDocumentSettings = result.document_settings || currentDocumentSettings;
  setPreviewHtml(decodeApiHtml(result, "edit_html"));
  VariantEditor.setRules(currentDocumentSettings.variant_rules);
  VariantEditor.render();
  invalidatePreviewCache();
  rulesViewStale = true;
  updateConditionsPanel();
  renderConditionsList();
  setStatus("Правила збережено");
  Unsaved.reset();
}

async function ensureRulesEditorReady() {
  if (!currentFileId || currentExtension !== ".docx") return false;
  if (activeTab !== "edit") return false;
  if (!rulesEditorLoaded) {
    await loadEditView();
  }
  return rulesEditorLoaded;
}

async function handleAddCondition() {
  if (!currentFileId || currentExtension !== ".docx") {
    setStatus("Спочатку відкрийте DOCX-документ", true);
    return;
  }

  if (activeTab !== "edit") {
    void setActiveTab("edit");
  }
  await ensureRulesEditorReady();

  if (!rulesEditorLoaded || typeof VariantEditor === "undefined" || !VariantEditor.addConditionAsync) {
    setStatus("Не вдалося завантажити редактор правил", true);
    return;
  }

  await VariantEditor.addConditionAsync();
}

async function handleAddRule() {
  if (!currentFileId || currentExtension !== ".docx") {
    setStatus("Спочатку відкрийте DOCX-документ", true);
    return;
  }

  if (activeTab !== "edit") {
    void setActiveTab("edit");
    await ensureRulesEditorReady();
  } else if (!rulesEditorLoaded) {
    await ensureRulesEditorReady();
  }

  if (!rulesEditorLoaded || typeof VariantEditor === "undefined" || !VariantEditor.addRuleAsync) {
    setStatus("Не вдалося завантажити редактор правил", true);
    return;
  }

  await VariantEditor.addRuleAsync();
}

async function handleRedetectRules() {
  if (!currentFileId) return;

  const confirmed = await Dialogs.confirm({
    title: "Скинути всі правила?",
    message: "Усі умови, правила та пункти будуть очищені. Документ не зміниться.",
    confirmText: "Скинути",
    cancelText: "Скасувати",
    variant: "danger",
  });
  if (!confirmed) return;

  const emptyRules = { schema_version: 3, conditions: [], rules: [], entries: [] };
  const result = await window.pywebview.api.save_variant_rules(currentFileId, emptyRules);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  await loadEditView();
  setStatus("Правила очищено");
}

function applySaveResult(result) {
  if (result.document_settings && Object.keys(result.document_settings).length) {
    currentDocumentSettings = result.document_settings;
    rulesViewStale = true;
    updateConditionsPanel();
    renderConditionsList();
    updateEditTabState();
  }

  if (currentExtension === ".docx") {
    if (result.edit_html) {
      cachedEditHtml = decodeApiHtml(result, "edit_html");
      rulesViewStale = false;
    }
    const previewHtml = decodeApiHtml(result, "preview_html");
    if (previewHtml && activeTab === "preview") {
      setPreviewHtml(previewHtml);
      cachedPreviewHtml = previewHtml;
      sessionInnerHtml = previewHtml;
      if (typeof Editor !== "undefined") {
        Editor.setEnabled(true);
        Editor.prepareEditable?.();
      }
    } else if (activeTab === "preview") {
      sessionInnerHtml = collectEditableHtml() || sessionInnerHtml;
    }
  }
}
function collectEditableHtml() {
  if (typeof Editor !== "undefined" && Editor.getHtml) {
    return Editor.getHtml();
  }
  const editable = els.preview.querySelector(".docx-editable");
  return editable ? editable.innerHTML : "";
}

async function saveAllPendingChanges({ quiet = false } = {}) {
  if (!currentFileId || currentExtension === ".pdf") return true;

  if (Unsaved.htmlChanged()) {
    let htmlToSave = collectEditableHtml();
    if (currentExtension === ".docx" && activeTab === "edit" && sessionInnerHtml?.trim()) {
      htmlToSave = sessionInnerHtml;
    }
    if (htmlToSave) {
      const result = await window.pywebview.api.save_file(currentFileId, null, htmlToSave);
      if (!result.ok) {
        if (!quiet) setStatus(result.error, true);
        return false;
      }
      applySaveResult(result);
      await refreshFileList(els.fileSearch.value);
    }
  }

  if (Unsaved.rulesChanged()) {
    if (typeof VariantEditor === "undefined" || !VariantEditor.getRules) return true;
    const result = await window.pywebview.api.save_variant_rules(
      currentFileId,
      VariantEditor.getRules(),
    );
    if (!result.ok) {
      if (!quiet) setStatus(result.error, true);
      return false;
    }
    currentDocumentSettings = result.document_settings || currentDocumentSettings;
    setPreviewHtml(decodeApiHtml(result, "edit_html"));
    rulesViewStale = false;
  }

  Unsaved.reset();
  if (!quiet) setStatus("Збережено");
  return true;
}

async function confirmDiscardUnsaved() {
  if (!Unsaved.hasChanges()) return true;

  const fileName = getDocumentTitle();
  const choice = await Dialogs.confirmUnsaved({
    title: "DocFlow",
    message: "Зберегти зміни в документі?",
    fileName,
  });

  if (choice === "cancel") return false;
  if (choice === "discard") {
    Unsaved.reset();
    return true;
  }
  if (choice === "save") {
    return saveAllPendingChanges({ quiet: true });
  }
  return false;
}

function getConditionValues() {
  return { ...(currentDocumentSettings.condition_values || {}) };
}

function documentNeedsApproval() {
  if (currentExtension !== ".docx") return false;
  const rules = getEffectiveVariantRules();
  if (!(rules.entries || []).length) return false;
  const activeIds =
    currentDocumentSettings.active_condition_ids?.length
      ? currentDocumentSettings.active_condition_ids
      : getActiveConditionIdsFromRules(rules);
  return activeIds.length > 0;
}

function allActiveConditionsChosen() {
  const { activeIds } = getPreviewConditionsContext();
  if (!activeIds.length) return false;
  const values = getConditionValues();
  return activeIds.every((id) => values[id] !== undefined && values[id] !== null);
}

function updateDocumentActions() {
  const hasFile = Boolean(currentFileId);
  const needsApproval = documentNeedsApproval();
  const approved = Boolean(currentDocumentSettings.approved);
  const pending = Boolean(currentDocumentSettings.approval_pending);
  const canApprove = needsApproval && allActiveConditionsChosen() && !approved && !pending;

  if (els.toolbarWorkflow) {
    els.toolbarWorkflow.hidden = !needsApproval;
  }
  if (els.toolbarWorkflowSep) {
    els.toolbarWorkflowSep.hidden = !needsApproval;
  }

  const showExport = hasFile && (!needsApproval || approved);
  if (els.toolbarExport) {
    els.toolbarExport.hidden = !showExport;
  }
  if (els.toolbarExportSep) {
    els.toolbarExportSep.hidden = !showExport;
  }

  if (els.approveBtn) {
    els.approveBtn.hidden = !needsApproval || approved;
    if (pending) {
      els.approveBtn.textContent = "Підтвердити";
      els.approveBtn.disabled = false;
    } else {
      els.approveBtn.textContent = "Затвердити";
      els.approveBtn.disabled = !canApprove;
    }
  }

  if (els.unapproveBtn) {
    if (pending) {
      els.unapproveBtn.hidden = false;
      els.unapproveBtn.textContent = "Ні";
    } else if (approved) {
      els.unapproveBtn.hidden = false;
      els.unapproveBtn.textContent = "Скасувати";
    } else {
      els.unapproveBtn.hidden = true;
    }
  }

  if (els.exportBtn) {
    els.exportBtn.disabled = !showExport;
    els.exportBtn.title = showExport ? "" : "З’явиться після підтвердження";
  }

  els.previewPanel?.classList.toggle("is-approved", approved && needsApproval);
  els.previewPanel?.classList.toggle("is-approval-pending", pending && needsApproval);
}

function getPreviewConditionOptions(condition) {
  return (condition.options || []).filter((option) => {
    const label = String(option.label || "").trim();
    return label !== "—" && label !== "-";
  });
}

function buildConditionValuesPayload(nextChange = null) {
  const values = { ...getConditionValues() };
  if (nextChange?.clearId) {
    delete values[nextChange.clearId];
  } else if (nextChange?.conditionId) {
    values[nextChange.conditionId] = nextChange.value;
  }
  return values;
}

function getEffectiveVariantRules() {
  if (
    rulesEditorLoaded &&
    typeof VariantEditor !== "undefined" &&
    VariantEditor.getRules
  ) {
    return VariantEditor.getRules();
  }
  return currentDocumentSettings.variant_rules || {
    schema_version: 3,
    conditions: [],
    rules: [],
    entries: [],
  };
}

function getPreviewConditionsContext() {
  const variantRules = getEffectiveVariantRules();
  const activeIds =
    rulesEditorLoaded && typeof VariantEditor !== "undefined" && VariantEditor.getActiveConditionIds
      ? VariantEditor.getActiveConditionIds()
      : (currentDocumentSettings.active_condition_ids ||
          getActiveConditionIdsFromRules(variantRules));

  const hasConfigured =
    rulesEditorLoaded && typeof VariantEditor !== "undefined" && VariantEditor.hasConfiguredRules
      ? VariantEditor.hasConfiguredRules()
      : Boolean(currentDocumentSettings.has_configured_rules);

  const conditions = (variantRules.conditions || []).filter((condition) =>
    activeIds.includes(condition.id),
  );

  return { variantRules, activeIds, hasConfigured, conditions };
}

function getActiveConditionIdsFromRules(variantRules) {
  if (!variantRules?.rules?.length) return [];
  return [
    ...new Set(
      variantRules.rules
        .filter(
          (rule) =>
            rule.condition_id &&
            (variantRules.entries || []).some((entry) => entry.rule_id === rule.id),
        )
        .map((rule) => rule.condition_id),
    ),
  ];
}

function syncPreviewConditionsFromEditor() {
  if (!rulesEditorLoaded || typeof VariantEditor === "undefined") return;
  currentDocumentSettings = {
    ...currentDocumentSettings,
    variant_rules: VariantEditor.getRules(),
    has_configured_rules: VariantEditor.hasConfiguredRules(),
    active_condition_ids: VariantEditor.getActiveConditionIds(),
  };
  updateConditionsPanel();
  renderConditionsList();
  updateDocumentActions();
}

function getActiveConditionIds() {
  return getPreviewConditionsContext().activeIds;
}

function renderBooleanConditionCard(condition, index) {
  const inputIdBase = `condition-${condition.id}`;
  return `
    <article class="condition-card" data-condition-id="${condition.id}">
      <header class="condition-card-head">
        <span class="condition-card-label">Умова ${index + 1}</span>
        <h4 class="condition-card-title">${escapeHtml(condition.label)}?</h4>
      </header>
      <div class="condition-card-options segment-control segment-control--branch" role="radiogroup" aria-label="${escapeHtml(condition.label)}">
        <label class="condition-option segment-option segment-option--no">
          <input type="checkbox" class="condition-input" id="${inputIdBase}-no" data-condition="${condition.id}" data-value="false">
          <span class="condition-option-pill segment-option-label">Ні</span>
        </label>
        <label class="condition-option segment-option segment-option--yes">
          <input type="checkbox" class="condition-input" id="${inputIdBase}-yes" data-condition="${condition.id}" data-value="true">
          <span class="condition-option-pill segment-option-label">Так</span>
        </label>
      </div>
    </article>
  `;
}

function renderChoiceConditionCard(condition, index) {
  const options = getPreviewConditionOptions(condition);
  return `
    <article class="condition-card" data-condition-id="${condition.id}">
      <header class="condition-card-head">
        <span class="condition-card-label">Умова ${index + 1}</span>
        <h4 class="condition-card-title">${escapeHtml(condition.label)}?</h4>
      </header>
      <div class="condition-card-options segment-control condition-card-options--multi" role="radiogroup" aria-label="${escapeHtml(condition.label)}">
        ${options
          .map(
            (option, optionIndex) => `
              <label class="condition-option segment-option">
                <input type="checkbox" class="condition-input" id="condition-${condition.id}-${optionIndex}" data-condition="${condition.id}" data-value="${escapeHtml(option.value)}">
                <span class="condition-option-pill segment-option-label">${escapeHtml(option.label)}</span>
              </label>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderConditionsList() {
  if (!els.conditionsList) return;

  const { activeIds, hasConfigured, conditions } = getPreviewConditionsContext();

  if (!activeIds.length || !conditions.length) {
    els.conditionsList.innerHTML = "";
    updateConditionsPanel();
    return;
  }

  const hint = !hasConfigured
    ? '<p class="rules-empty rules-empty--soft conditions-setup-hint">Дозаповніть правила (група або маркер), потім оберіть Так/Ні.</p>'
    : currentDocumentSettings.approved
      ? '<p class="rules-empty rules-empty--soft conditions-setup-hint">Документ затверджено — можна експортувати.</p>'
      : currentDocumentSettings.approval_pending
        ? '<p class="rules-empty rules-empty--soft conditions-setup-hint">Перегляд без інструкцій. Натисніть «Підтвердити» або «Ні», щоб повернутися.</p>'
        : '<p class="rules-empty rules-empty--soft conditions-setup-hint">Оберіть Так/Ні — підсвітиться варіант. Потім «Затвердити».</p>';

  els.conditionsList.innerHTML =
    hint +
    conditions
    .map((condition, index) => {
      if (condition.type === "choice" || (condition.options?.length > 2)) {
        return renderChoiceConditionCard(condition, index);
      }
      if (condition.type === "boolean") {
        return renderBooleanConditionCard(condition, index);
      }
      return `
        <article class="condition-card condition-card--unsupported" data-condition-id="${condition.id}">
          <header class="condition-card-head">
            <span class="condition-card-label">Умова ${index + 1}</span>
            <h4 class="condition-card-title">${escapeHtml(condition.label)}</h4>
          </header>
          <p class="conditions-empty">Тип умови ще не підтримується в інтерфейсі.</p>
        </article>
      `;
    })
    .join("");

  bindConditionEvents();
  syncConditionInputs();

  const lockConditions =
    currentDocumentSettings.approval_pending || currentDocumentSettings.approved;
  els.conditionsList?.querySelectorAll(".condition-input").forEach((input) => {
    input.disabled = lockConditions;
  });

  updateDocumentActions();
}

function bindConditionEvents() {
  els.conditionsList?.querySelectorAll(".condition-input").forEach((input) => {
    input.addEventListener("change", () => {
      const conditionId = input.dataset.condition;
      if (!conditionId) return;
      handleConditionChange(conditionId, input);
    });
  });
}

function syncConditionInputs() {
  const values = getConditionValues();

  els.conditionsList?.querySelectorAll(".condition-card").forEach((card) => {
    const conditionId = card.dataset.conditionId;
    const currentValue = values[conditionId];
    const inputs = card.querySelectorAll(".condition-input");
    inputs.forEach((input) => {
      if (currentValue === undefined || currentValue === null) {
        input.checked = false;
        return;
      }
      const raw = input.dataset.value;
      const conditionMeta = getEffectiveVariantRules().conditions?.find(
        (item) => item.id === conditionId,
      );
      if (conditionMeta?.type === "boolean" || conditionId === "bank_employee") {
        input.checked =
          (raw === "true" && currentValue === true) ||
          (raw === "false" && currentValue === false);
        return;
      }
      input.checked = String(currentValue) === String(raw);
    });
  });
}

function handleConditionChange(conditionId, targetInput) {
  if (applyingDocumentSetting) return;

  if (!targetInput.checked) {
    const card = targetInput.closest(".condition-card");
    const anyChecked = card?.querySelector(".condition-input:checked");
    if (!anyChecked) {
      handleConditionValueClear(conditionId);
    } else {
      syncConditionInputs();
    }
    return;
  }

  const card = targetInput.closest(".condition-card");
  card?.querySelectorAll(".condition-input").forEach((input) => {
    if (input !== targetInput) input.checked = false;
  });

  let parsedValue = targetInput.dataset.value;
  const conditionMeta = getEffectiveVariantRules().conditions?.find(
    (item) => item.id === conditionId,
  );
  if (conditionMeta?.type === "boolean" || conditionId === "bank_employee") {
    parsedValue = parsedValue === "true";
  }

  handleConditionValueChange(conditionId, parsedValue);
}

async function handleConditionValueClear(conditionId) {
  if (!currentFileId || applyingDocumentSetting) return;
  if (currentExtension !== ".docx") return;

  if (currentDocumentSettings.approval_pending) {
    await cancelApprovalPreviewFlow({ quiet: true });
  }

  applyingDocumentSetting = true;
  try {
    setStatus("Скидання умови…");

    if (!(await persistRulesFromEditor({ quiet: true }))) {
      syncConditionInputs();
      return;
    }

    const rules = getEffectiveVariantRules();
    const result = await window.pywebview.api.clear_condition_setting(
      currentFileId,
      conditionId,
      rules,
      buildConditionValuesPayload({ clearId: conditionId }),
    );

    if (!result.ok) {
      setStatus(result.error, true);
      syncConditionInputs();
      return;
    }

    currentDocumentSettings = result.document_settings || currentDocumentSettings;
    rulesViewStale = true;
    invalidatePreviewCache();

    if (rulesEditorLoaded && currentDocumentSettings.variant_rules) {
      VariantEditor.setRules(currentDocumentSettings.variant_rules);
      VariantEditor.render();
      rulesViewStale = false;
    }

    if (activeTab === "preview") {
      const html = decodeApiHtml(result, "preview_html");
      setPreviewHtml(html);
      cachedPreviewHtml = html;
      sessionInnerHtml = collectEditableHtml() || sessionInnerHtml;
      if (typeof Editor !== "undefined") {
        Editor.setEnabled(true);
        Editor.prepareEditable?.();
      }
    }

    updateConditionsPanel();
    renderConditionsList();
    setStatus("Показано обидва варіанти — умову не обрано");
  } catch (error) {
    setStatus(error.message || "Помилка скидання умови", true);
    syncConditionInputs();
  } finally {
    applyingDocumentSetting = false;
  }
}

async function handleConditionValueChange(conditionId, value) {
  if (!currentFileId || applyingDocumentSetting) return;
  if (currentExtension !== ".docx") return;

  if (currentDocumentSettings.approval_pending) {
    await cancelApprovalPreviewFlow({ quiet: true });
  }

  applyingDocumentSetting = true;
  const jobLabel =
    conditionId === "bank_employee"
      ? value
        ? "Працівник банку"
        : "Звичайний позичальник"
      : String(value);

  try {
    setStatus(`Застосування: ${jobLabel}…`);

    if (!(await persistRulesFromEditor({ quiet: true }))) {
      syncConditionInputs();
      return;
    }

    const rules = getEffectiveVariantRules();
    const result = await window.pywebview.api.apply_condition_setting(
      currentFileId,
      conditionId,
      value,
      rules,
      buildConditionValuesPayload({ conditionId, value }),
    );

    if (!result.ok) {
      setStatus(result.error, true);
      syncConditionInputs();
      return;
    }

    currentDocumentSettings = result.document_settings || currentDocumentSettings;
    rulesViewStale = true;
    invalidatePreviewCache();

    if (rulesEditorLoaded && currentDocumentSettings.variant_rules) {
      VariantEditor.setRules(currentDocumentSettings.variant_rules);
      VariantEditor.render();
      rulesViewStale = false;
    }

    if (activeTab === "preview") {
      const html = decodeApiHtml(result, "preview_html");
      setPreviewHtml(html);
      cachedPreviewHtml = html;
      sessionInnerHtml = collectEditableHtml() || sessionInnerHtml;
      if (typeof Editor !== "undefined") {
        Editor.setEnabled(true);
        Editor.prepareEditable?.();
      }
    }

    updateConditionsPanel();
    renderConditionsList();

    if (!currentDocumentSettings.has_configured_rules) {
      setStatus("Умову збережено. Дозаповніть правила — обидва варіанти маркера/групи.", true);
    } else {
      setStatus("Документ оновлено за обраною умовою");
    }
  } catch (error) {
    setStatus(error.message || "Помилка застосування умови", true);
    syncConditionInputs();
  } finally {
    applyingDocumentSetting = false;
  }
}

function updateConditionsPanel() {
  const { activeIds } = getPreviewConditionsContext();
  const showOnPreview = activeTab === "preview" && activeIds.length > 0;

  els.previewPanel?.classList.toggle("has-conditions", showOnPreview);
  if (els.conditionsPanel) {
    els.conditionsPanel.setAttribute("aria-hidden", String(!showOnPreview));
  }
}

async function openFile(fileId, { loadingJob = null, token: externalToken = null, silent = false } = {}) {
  if (!(await confirmDiscardUnsaved())) return;

  const token = externalToken ?? ++openRequestToken;
  const known = allFiles.find((item) => item.id === fileId);
  const job = silent
    ? loadingJob
    : loadingJob ||
      Loading.start({
        title: known?.name || "Документ",
        subtitle: "Завантаження…",
      });

  try {
    if (job && !loadingJob) {
      Loading.update(job, { indeterminate: true, subtitle: "Отримання з сервера…" });
    } else if (job && loadingJob) {
      Loading.update(job, { progress: 82, subtitle: "Отримання з сервера…" });
    }

    const result = await window.pywebview.api.get_file(fileId);
    if (!result.ok) {
      if (token === openRequestToken) setStatus(result.error, true);
      if (job) Loading.fail(job, result.error);
      return;
    }

    if (token !== openRequestToken) {
      if (job && !loadingJob) Loading.cancel(job);
      return;
    }

    if (job) Loading.update(job, { progress: 92, subtitle: "Відображення…" });
    applyFileResult(result, { fileId, token });
    if (job) Loading.complete(job, `Відкрито ${result.meta?.name || known?.name || "документ"}`);
  } catch (error) {
    if (token === openRequestToken) setStatus(error.message || "Помилка відкриття", true);
    if (job) Loading.fail(job);
  }
}

async function handleUpload(event) {
  const file = event.target.files?.[0];
  await uploadAndOpen(file);
}

function bindDropZone(element) {
  if (!element) return;

  element.addEventListener("dragenter", (event) => {
    event.preventDefault();
    element.classList.add("is-dragover");
  });

  element.addEventListener("dragover", (event) => {
    event.preventDefault();
    element.classList.add("is-dragover");
  });

  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) {
      element.classList.remove("is-dragover");
    }
  });

  element.addEventListener("drop", async (event) => {
    event.preventDefault();
    element.classList.remove("is-dragover");
    const file = event.dataTransfer?.files?.[0];
    await uploadAndOpen(file);
  });
}

async function handleSave() {
  if (!currentFileId) {
    setStatus("Файл не вибрано", true);
    return;
  }

  if (currentExtension === ".pdf") {
    setStatus("Файли PDF не можна редагувати", true);
    return;
  }

  if (currentExtension === ".docx" && activeTab === "edit") {
    setStatus("Збережіть текст у вкладці «Перегляд»", true);
    return;
  }

  setStatus("Збереження…");
  let result;

  if (currentExtension === ".docx" || currentExtension === ".txt") {
    result = await window.pywebview.api.save_file(currentFileId, null, collectEditableHtml());
  } else {
    setStatus("Цей тип файлу не можна зберегти", true);
    return;
  }

  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  applySaveResult(result);
  await refreshFileList(els.fileSearch.value);
  setStatus(`Збережено ${result.file.name}`);
  Unsaved.reset();
}

async function applyWorkflowResult(result, statusMessage) {
  if (!result.ok) {
    setStatus(result.error, true);
    return false;
  }

  currentDocumentSettings = result.document_settings || currentDocumentSettings;
  rulesViewStale = true;
  invalidatePreviewCache();

  if (rulesEditorLoaded && currentDocumentSettings.variant_rules) {
    VariantEditor.setRules(currentDocumentSettings.variant_rules);
    VariantEditor.render();
    rulesViewStale = false;
  }

  if (activeTab === "preview") {
    const html = decodeApiHtml(result, "preview_html");
    setPreviewHtml(html);
    cachedPreviewHtml = html;
    sessionInnerHtml = collectEditableHtml() || sessionInnerHtml;
    if (typeof Editor !== "undefined") {
      Editor.setEnabled(true);
      Editor.prepareEditable?.();
    }
  }

  updateConditionsPanel();
  renderConditionsList();
  updateDocumentActions();
  Unsaved.reset();
  if (statusMessage) setStatus(statusMessage);
  return true;
}

async function cancelApprovalPreviewFlow({ quiet = false } = {}) {
  if (!currentFileId || !currentDocumentSettings.approval_pending) return true;

  if (!(await persistRulesFromEditor({ quiet: true }))) return false;

  const result = await window.pywebview.api.cancel_approval_preview(
    currentFileId,
    getEffectiveVariantRules(),
    buildConditionValuesPayload(),
  );

  if (!result.ok) {
    if (!quiet) setStatus(result.error, true);
    return false;
  }

  return applyWorkflowResult(
    result,
    quiet ? "" : "Повернуто режим редагування з інструкціями",
  );
}

async function handleApprove() {
  if (!currentFileId || currentExtension !== ".docx") {
    setStatus("Файл не вибрано", true);
    return;
  }

  if (!documentNeedsApproval()) {
    setStatus("У цьому документі немає правил для затвердження", true);
    return;
  }

  if (currentDocumentSettings.approved) {
    setStatus("Документ уже затверджено");
    return;
  }

  if (!allActiveConditionsChosen()) {
    setStatus("Оберіть усі умови (Так/Ні) перед затвердженням", true);
    return;
  }

  if (!(await persistRulesFromEditor({ quiet: true }))) return;

  const rules = getEffectiveVariantRules();
  const payload = buildConditionValuesPayload();
  const fileName = getDocumentTitle();

  if (!currentDocumentSettings.approval_pending) {
    const job = Loading.start({ title: fileName, subtitle: "Формування перегляду…" });
    try {
      const result = await window.pywebview.api.preview_approval_document(
        currentFileId,
        rules,
        payload,
      );
      if (!(await applyWorkflowResult(result, "Перегляньте документ без інструкцій"))) {
        Loading.fail(job, result.error);
        return;
      }
      Loading.complete(job, "Готово до підтвердження");
    } catch (error) {
      setStatus(error.message || "Помилка перегляду", true);
      Loading.fail(job);
    }
    return;
  }

  const confirmed = await Dialogs.confirm({
    title: "Підтвердити документ?",
    message: "Документ буде готовий до експорту.",
    detail: "Ні — поверне червоні інструкції для продовження редагування.",
    confirmText: "Так",
    cancelText: "Ні",
  });

  if (!confirmed) {
    await cancelApprovalPreviewFlow();
    return;
  }

  const job = Loading.start({ title: fileName, subtitle: "Затвердження документа…" });
  try {
    const result = await window.pywebview.api.approve_document(currentFileId, rules, payload);
    if (!(await applyWorkflowResult(result, "Документ затверджено — можна експортувати"))) {
      Loading.fail(job, result.error);
      return;
    }
    Loading.complete(job, "Затверджено");
  } catch (error) {
    setStatus(error.message || "Помилка затвердження", true);
    Loading.fail(job);
  }
}

async function handleUnapprove() {
  if (!currentFileId || currentExtension !== ".docx") {
    setStatus("Файл не вибрано", true);
    return;
  }

  if (currentDocumentSettings.approval_pending) {
    await cancelApprovalPreviewFlow();
    return;
  }

  if (!currentDocumentSettings.approved) {
    setStatus("Документ ще не затверджено", true);
    return;
  }

  const fileName = getDocumentTitle();
  const job = Loading.start({ title: fileName, subtitle: "Скасування затвердження…" });

  try {
    if (!(await persistRulesFromEditor({ quiet: true }))) {
      Loading.fail(job);
      return;
    }

    const result = await window.pywebview.api.revert_document_approval(
      currentFileId,
      getEffectiveVariantRules(),
      buildConditionValuesPayload(),
    );

    if (!(await applyWorkflowResult(result, "Затвердження скасовано — можна продовжувати редагування"))) {
      Loading.fail(job, result.error);
      return;
    }
    Loading.complete(job, "Скасовано");
  } catch (error) {
    setStatus(error.message || "Помилка скасування", true);
    Loading.fail(job);
  }
}

async function handleExport() {
  if (!currentFileId) {
    setStatus("Файл не вибрано", true);
    return;
  }

  const fileName = getDocumentTitle();
  const job = Loading.start({ title: fileName, subtitle: "Підготовка до експорту…" });

  try {
    if (documentNeedsApproval() && !currentDocumentSettings.approved) {
      setStatus("Спочатку затвердіть документ на вкладці «Перегляд»", true);
      Loading.fail(job);
      return;
    }

    if (currentExtension !== ".pdf" && !documentNeedsApproval()) {
      const html = collectEditableHtml();
      if (html) {
        Loading.update(job, { indeterminate: true, subtitle: "Збереження змін…" });
        const saveFirst = await window.pywebview.api.save_file(currentFileId, null, html);
        if (!saveFirst.ok) {
          setStatus(saveFirst.error, true);
          Loading.fail(job, saveFirst.error);
          return;
        }
      }
    }

    Loading.update(job, { indeterminate: true, subtitle: "Оберіть місце збереження…" });
    const result = await window.pywebview.api.export_file(currentFileId);

    if (!result.ok) {
      setStatus(result.error, true);
      Loading.fail(job, result.error);
      return;
    }

    if (result.cancelled) {
      setStatus("Експорт скасовано");
      Loading.cancel(job);
      return;
    }

    setStatus(`Експортовано ${result.file.name}`);
    Loading.complete(job, "Експортовано");
  } catch (error) {
    setStatus(error.message || "Помилка експорту", true);
    Loading.fail(job);
  }
}

function bindEvents() {
  els.uploadInput.addEventListener("change", handleUpload);
  bindDropZone(els.uploadBox);
  els.saveBtn.addEventListener("click", handleSave);
  els.approveBtn?.addEventListener("click", handleApprove);
  els.unapproveBtn?.addEventListener("click", handleUnapprove);
  els.exportBtn.addEventListener("click", handleExport);

  els.tabPreview.addEventListener("click", () => {
    void setActiveTab("preview");
  });
  els.tabEdit?.addEventListener("click", () => {
    if (!els.tabEdit.disabled) void setActiveTab("edit");
  });

  els.saveRulesBtn?.addEventListener("click", handleSaveRules);
  els.redetectRulesBtn?.addEventListener("click", handleRedetectRules);
  els.addRuleBtn?.addEventListener("click", handleAddRule);
  els.addConditionBtn?.addEventListener("click", handleAddCondition);
  els.sidebarToggle?.addEventListener("click", toggleSidebar);
  els.sidebarExpand?.addEventListener("click", toggleSidebar);

  els.fileSearch.addEventListener("input", () => {
    renderAllFileLists(els.fileSearch.value);
  });

  els.fileSearchClear?.addEventListener("click", () => {
    els.fileSearch.value = "";
    renderAllFileLists("");
    els.fileSearch.focus();
  });

  els.fileSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      els.fileSearch.value = "";
      renderAllFileLists("");
      els.fileSearch.blur();
    }
  });
}

function waitForApi() {
  return ApiClient.waitForApi();
}

async function bootstrapApp({ setStatus, setProgress } = {}) {
  bindEvents();
  Theme.init();
  applySidebarState();
  initRulesPanelResize();

  setProgress?.(38);
  setStatus?.("Підключення до застосунку…");
  await waitForApi();

  setProgress?.(68);
  setStatus?.("Завантаження документів…");
  await refreshFileList();

  setProgress?.(92);
  setStatus?.("Підготовка робочого простору…");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function afterSplash() {
  if (allFiles.length > 0) {
    await openFile(allFiles[0].id, { silent: true });
  } else {
    showWelcomePreview();
    setStatus("Готово");
  }
}

Splash.init();
Splash.run(bootstrapApp).then(afterSplash);

Unsaved.bind({
  getCurrentFileId: () => currentFileId,
  getCurrentExtension: () => currentExtension,
  getActiveTab: () => activeTab,
  getSessionInnerHtml: () => sessionInnerHtml,
  captureHtml: collectEditableHtml,
  captureRules: () => {
    if (typeof VariantEditor !== "undefined" && VariantEditor.getRules) {
      return JSON.stringify(VariantEditor.getRules());
    }
    const rules = currentDocumentSettings?.variant_rules;
    return rules ? JSON.stringify(rules) : "";
  },
});

function releaseClosePrompt() {
  appCloseInProgress = false;
  window.pywebview?.api?.cancel_close_prompt?.();
}

window.DocFlow = {
  async handleAppClose() {
    if (appCloseInProgress) return;
    appCloseInProgress = true;

    try {
      if (!Unsaved.hasChanges()) {
        await window.pywebview.api.prepare_close();
        return;
      }

      const fileName = getDocumentTitle();
      const choice = await Dialogs.confirmUnsaved({
        title: "DocFlow",
        message: "Зберегти зміни в документі?",
        fileName,
      });

      if (choice === "cancel") {
        releaseClosePrompt();
        return;
      }

      if (choice === "save") {
        const saved = await saveAllPendingChanges({ quiet: true });
        if (!saved) {
          releaseClosePrompt();
          return;
        }
      }

      await window.pywebview.api.prepare_close();
    } catch (error) {
      releaseClosePrompt();
      console.error("DocFlow.handleAppClose failed:", error);
    }
  },
};
