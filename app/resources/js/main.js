let currentFileId = null;
let currentContent = "";
let currentDocumentSettings = {};
let applyingDocumentSetting = false;

const els = AppDom;

let currentExtension = null;
let activeTab = "preview";
let allFiles = [];
let openRequestToken = 0;
let rulesViewStale = true;
let cachedEditHtml = null;
let sessionInnerHtml = null;
let tabSwitchTimer = null;

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

  currentDocumentSettings = documentSettings;
  rulesViewStale = true;
  cachedEditHtml = null;
  sessionInnerHtml = null;

  els.breadcrumb.textContent = meta.name;
  els.contentFilename.textContent = meta.name;
  if (!setPreviewHtml(previewHtml)) {
    setStatus("Документ не відобразився — спробуйте ще раз", true);
  }
  els.statusEncoding.textContent = meta.extension === ".txt" ? "UTF-8" : meta.extension.toUpperCase().slice(1);

  const isEditable = meta.extension === ".docx" || meta.extension === ".txt";
  els.previewPanel.classList.toggle("is-pdf", meta.extension === ".pdf");
  els.previewPanel.classList.toggle("is-docx", meta.extension === ".docx");
  els.previewPanel.classList.toggle("is-txt", meta.extension === ".txt");
  els.previewPanel.classList.toggle("is-editable", isEditable);
  els.saveBtn.disabled = meta.extension === ".pdf";
  els.exportBtn.disabled = false;

  updateEditTabState();
  setActiveTab("preview", { skipPreviewReload: true });
  if (typeof Editor !== "undefined" && isEditable) {
    Editor.setEnabled(true);
    Editor.prepareEditable?.();
  }
  renderAllFileLists(els.fileSearch.value);
  setStatus(`Відкрито ${meta.name}`);
  return true;
}

async function uploadAndOpen(file) {
  if (!file) return false;

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
      Loading.update(job, { progress: 92, subtitle: "Відображення…" });
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

function captureSessionDocument() {
  if (currentExtension !== ".docx" || activeTab !== "preview") return;
  const html = collectEditableHtml();
  if (html?.trim()) sessionInnerHtml = html;
}

function setPreviewHtml(html) {
  if (!html || !html.trim()) {
    els.preview.innerHTML = '<p class="preview-empty">Документ порожній або не завантажився.</p>';
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
  sessionInnerHtml = null;
  cachedEditHtml = null;
  updateConditionsPanel();
  renderConditionsList();
  els.breadcrumb.textContent = "Файл не вибрано";
  els.contentFilename.textContent = "Файл не вибрано";
  els.preview.innerHTML = '<p class="preview-empty">Завантажте файл або виберіть його в боковій панелі.</p>';
  els.exportBtn.disabled = true;
  els.saveBtn.disabled = false;
  els.previewPanel.classList.remove("is-pdf", "is-docx", "is-txt", "is-editable", "is-edit");
  if (els.rulesPanel) {
    els.rulesPanel.setAttribute("aria-hidden", "true");
  }
  if (typeof Editor !== "undefined") Editor.setEnabled(false);
  rulesViewStale = true;
  updateEditTabState();
}

async function deleteFile(fileId, fileName) {
  const confirmed = await Dialogs.confirm({
    title: "Видалити файл?",
    message: `«${fileName}» буде остаточно видалено з DocFlow.`,
    detail: "Цю дію не можна скасувати. Оригінальний файл на диску також буде видалено.",
    confirmText: "Видалити",
    cancelText: "Залишити",
    variant: "danger",
  });
  if (!confirmed) return;

  const result = await window.pywebview.api.delete_file(fileId);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  if (currentFileId === fileId) clearEditor();

  await refreshFileList(els.fileSearch.value);
  setStatus(`Видалено ${fileName}`);
}

function runTabTransition(isEdit) {
  if (!els.previewPanel) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  els.previewPanel.classList.remove("is-switching-to-edit", "is-switching-to-preview");
  els.previewPanel.classList.add(
    isEdit ? "is-switching-to-edit" : "is-switching-to-preview",
    "is-tab-switching",
  );

  if (tabSwitchTimer) clearTimeout(tabSwitchTimer);
  tabSwitchTimer = setTimeout(() => {
    els.previewPanel.classList.remove(
      "is-tab-switching",
      "is-switching-to-edit",
      "is-switching-to-preview",
    );
    tabSwitchTimer = null;
  }, 320);
}

function setActiveTab(tab, options = {}) {
  const { skipPreviewReload = false } = options;
  const wasPreview = activeTab === "preview";
  const wasEdit = activeTab === "edit";

  if (wasPreview && tab !== "preview" && currentExtension === ".docx") {
    captureSessionDocument();
  }

  activeTab = tab;
  const isPreview = tab === "preview";
  const isEdit = tab === "edit";
  const isDocx = currentExtension === ".docx";
  const isTxt = currentExtension === ".txt";
  const shouldAnimate =
    isDocx && currentFileId && wasPreview !== isPreview && wasEdit !== isEdit;

  if (shouldAnimate) runTabTransition(isEdit);

  els.tabPreview.classList.toggle("is-active", isPreview);
  els.tabEdit?.classList.toggle("is-active", isEdit);
  els.preview.hidden = false;
  els.previewPanel.classList.toggle("is-edit", isEdit);

  if (els.rulesPanel) {
    els.rulesPanel.setAttribute("aria-hidden", String(!isEdit));
  }

  if (typeof Editor !== "undefined") {
    Editor.setEnabled((isDocx || isTxt) && isPreview);
  }

  updateConditionsPanel();

  if (isEdit && isDocx) {
    loadEditView();
  } else if (isPreview && isDocx && currentFileId && !skipPreviewReload) {
    const hasPreviewDoc = els.preview.querySelector(
      ".docx-editable:not(.docx-structure-mode)",
    );
    const needsReload = wasEdit || !hasPreviewDoc;
    if (needsReload) {
      reloadPreview(sessionInnerHtml);
    } else if (typeof Editor !== "undefined") {
      Editor.setEnabled(true);
      Editor.prepareEditable?.();
    }
  }

  renderConditionsList();
}

async function reloadPreview(sessionHtml = null) {
  if (!currentFileId) return;

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
  const hasVariants = currentDocumentSettings.has_contract_variants;
  if (els.tabEdit) {
    els.tabEdit.disabled = !isDocx || !hasVariants;
  }
  if (!isDocx && activeTab === "edit") setActiveTab("preview");
}

async function loadEditView() {
  if (!currentFileId || currentExtension !== ".docx") return;

  if (cachedEditHtml) {
    const html = cachedEditHtml;
    cachedEditHtml = null;
    if (setPreviewHtml(html)) {
      VariantEditor.init({
        previewEl: els.preview,
        rulesTreeEl: els.rulesTree,
        statusFn: setStatus,
      });
      VariantEditor.setRules(currentDocumentSettings.variant_rules || {
        conditions: [],
        rules: [],
        rule_items: [],
        subpoints: [],
      });
      VariantEditor.render(els.rulesTree);
      rulesViewStale = false;
      setStatus("Створіть правило або оберіть варіант для редагування наповнення");
      return;
    }
  }

  setStatus("Завантаження редактора правил…");
  const useSession = sessionInnerHtml?.trim();
  const result = useSession
    ? await window.pywebview.api.get_edit_view(
        currentFileId,
        encodeHtmlForApi(sessionInnerHtml),
      )
    : await window.pywebview.api.get_edit_view(currentFileId);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  currentDocumentSettings = result.document_settings || currentDocumentSettings;
  if (!setPreviewHtml(decodeApiHtml(result, "edit_html"))) {
    setStatus("Не вдалося завантажити документ для правил", true);
    return;
  }

  VariantEditor.init({
    previewEl: els.preview,
    rulesTreeEl: els.rulesTree,
    statusFn: setStatus,
  });
  VariantEditor.setRules(currentDocumentSettings.variant_rules);
  VariantEditor.render(els.rulesTree);
  rulesViewStale = false;
  setStatus("Створіть правило або оберіть варіант для редагування наповнення");
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
  VariantEditor.render(els.rulesTree);
  rulesViewStale = false;
  updateConditionsPanel();
  renderConditionsList();
  setStatus("Правила збережено");
}

async function handleRedetectRules() {
  if (!currentFileId) return;

  const confirmed = await Dialogs.confirm({
    title: "Визначити структуру знову?",
    message: "Автоматичне визначення перезапише поточні привʼязки варіантів.",
    confirmText: "Визначити",
    cancelText: "Скасувати",
  });
  if (!confirmed) return;

  const emptyRules = { conditions: [], rules: [], rule_items: [], subpoints: [] };
  const result = await window.pywebview.api.save_variant_rules(currentFileId, emptyRules);
  if (!result.ok) {
    setStatus(result.error, true);
    return;
  }

  await loadEditView();
  setStatus("Структуру визначено заново");
}

function collectEditableHtml() {
  if (typeof Editor !== "undefined" && Editor.getHtml) {
    return Editor.getHtml();
  }
  const editable = els.preview.querySelector(".docx-editable");
  return editable ? editable.innerHTML : "";
}

function getActiveConditionIds() {
  const rules = currentDocumentSettings.variant_rules;
  if (!rules?.rules?.length) return [];
  return [...new Set(rules.rules.map((rule) => rule.condition_id).filter(Boolean))];
}

function renderBooleanConditionCard(condition, index) {
  const inputIdBase = `condition-${condition.id}`;
  return `
    <article class="condition-card" data-condition-id="${condition.id}">
      <header class="condition-card-head">
        <span class="condition-card-label">Умова ${index + 1}</span>
        <h4 class="condition-card-title">${escapeHtml(condition.label)}?</h4>
      </header>
      <div class="condition-card-options" role="group" aria-label="${escapeHtml(condition.label)}">
        <label class="condition-option">
          <input type="checkbox" class="condition-input" id="${inputIdBase}-no" data-condition="${condition.id}" data-value="false">
          <span class="condition-option-pill">Ні</span>
        </label>
        <label class="condition-option">
          <input type="checkbox" class="condition-input" id="${inputIdBase}-yes" data-condition="${condition.id}" data-value="true">
          <span class="condition-option-pill">Так</span>
        </label>
      </div>
    </article>
  `;
}

function renderConditionsList() {
  if (!els.conditionsList) return;

  const hasConfiguredRules = Boolean(currentDocumentSettings.has_configured_rules);
  if (!hasConfiguredRules) {
    els.conditionsList.innerHTML = "";
    return;
  }

  const activeIds = new Set(getActiveConditionIds());
  const conditions = (currentDocumentSettings.variant_rules?.conditions || []).filter(
    (condition) => activeIds.has(condition.id),
  );

  if (!conditions.length) {
    els.conditionsList.innerHTML =
      '<p class="conditions-empty">Налаштуйте правила на вкладці «Правила».</p>';
    return;
  }

  els.conditionsList.innerHTML = conditions
    .map((condition, index) => {
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
}

function bindConditionEvents() {
  els.conditionsList?.querySelectorAll(".condition-input").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.dataset.condition !== "bank_employee") return;
      handleEmployeeCheckChange(input, input.dataset.value === "true");
    });
  });
}

function syncConditionInputs() {
  if (!currentDocumentSettings.has_configured_rules) return;
  const isEmployee = currentDocumentSettings.is_bank_employee;
  setEmployeeChecks(isEmployee === true ? true : isEmployee === false ? false : null);
}

function updateConditionsPanel() {
  const hasConfiguredRules = Boolean(currentDocumentSettings.has_configured_rules);
  const showOnPreview = hasConfiguredRules && activeTab === "preview";

  els.previewPanel?.classList.toggle("has-conditions", showOnPreview);
  if (els.conditionsPanel) {
    els.conditionsPanel.setAttribute("aria-hidden", String(!showOnPreview));
  }
}

function setEmployeeChecks(value) {
  const noInput = els.conditionsList?.querySelector('[data-condition="bank_employee"][data-value="false"]');
  const yesInput = els.conditionsList?.querySelector('[data-condition="bank_employee"][data-value="true"]');
  if (noInput) noInput.checked = value === false;
  if (yesInput) yesInput.checked = value === true;
}

function handleEmployeeCheckChange(targetInput, isBankEmployee) {
  if (applyingDocumentSetting) return;

  if (!targetInput.checked) {
    const prev = currentDocumentSettings.is_bank_employee;
    setEmployeeChecks(prev === true ? true : prev === false ? false : null);
    return;
  }

  setEmployeeChecks(isBankEmployee);
  handleBorrowerStatusChange(isBankEmployee);
}

async function handleBorrowerStatusChange(isBankEmployee) {
  if (!currentFileId || applyingDocumentSetting) return;
  if (currentExtension !== ".docx") return;

  applyingDocumentSetting = true;
  setStatus(
    isBankEmployee
      ? "Застосовую варіант для працівника банку…"
      : "Застосовую варіант для позичальника…",
  );

  try {
    const result = await window.pywebview.api.apply_bank_employee_setting(
      currentFileId,
      isBankEmployee,
    );

    if (!result.ok) {
      setStatus(result.error, true);
      const prev = currentDocumentSettings.is_bank_employee;
      setEmployeeChecks(prev === true ? true : prev === false ? false : null);
      return;
    }

    currentDocumentSettings = result.document_settings || {};
    setEmployeeChecks(isBankEmployee);
    rulesViewStale = true;

    if (activeTab === "preview") {
      setPreviewHtml(decodeApiHtml(result, "preview_html"));
      sessionInnerHtml = collectEditableHtml() || sessionInnerHtml;
      if (typeof Editor !== "undefined") {
        Editor.setEnabled(true);
        Editor.prepareEditable?.();
      }
    }

    setStatus(
      isBankEmployee
        ? "Залишено варіанти для позичальника-працівника"
        : "Залишено варіанти для звичайного позичальника",
    );
  } catch (error) {
    setStatus(error.message || "Помилка застосування налаштування", true);
    const prev = currentDocumentSettings.is_bank_employee;
    setEmployeeChecks(prev === true ? true : prev === false ? false : null);
  } finally {
    applyingDocumentSetting = false;
  }
}

async function openFile(fileId, { loadingJob = null, token: externalToken = null, silent = false } = {}) {
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

  if (result.document_settings && Object.keys(result.document_settings).length) {
    currentDocumentSettings = result.document_settings;
    rulesViewStale = true;
    updateConditionsPanel();
    renderConditionsList();
    updateEditTabState();
  }

  if (currentExtension === ".docx" && result.edit_html) {
    cachedEditHtml = decodeApiHtml(result, "edit_html");
    sessionInnerHtml = collectEditableHtml() || sessionInnerHtml;
    rulesViewStale = false;
  }

  await refreshFileList(els.fileSearch.value);
  setStatus(`Збережено ${result.file.name}`);
}

async function handleExport() {
  if (!currentFileId) {
    setStatus("Файл не вибрано", true);
    return;
  }

  const fileName = els.contentFilename.textContent || "Документ";
  const job = Loading.start({ title: fileName, subtitle: "Підготовка до експорту…" });

  try {
    if (currentExtension !== ".pdf") {
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
  els.exportBtn.addEventListener("click", handleExport);

  els.tabPreview.addEventListener("click", () => setActiveTab("preview"));
  els.tabEdit?.addEventListener("click", () => {
    if (!els.tabEdit.disabled) setActiveTab("edit");
  });

  els.saveRulesBtn?.addEventListener("click", handleSaveRules);
  els.redetectRulesBtn?.addEventListener("click", handleRedetectRules);
  els.addRuleBtn?.addEventListener("click", () => {
    if (typeof VariantEditor !== "undefined" && VariantEditor.addRule) {
      VariantEditor.addRule();
    }
  });

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
    setStatus("Готово");
  }
}

Splash.init();
Splash.run(bootstrapApp).then(afterSplash);
