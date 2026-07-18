const Dialogs = (() => {
  let root = null;
  let titleEl = null;
  let messageEl = null;
  let detailEl = null;
  let footerEl = null;
  let resolveFn = null;
  let lastFocus = null;
  let dismissResult = false;

  function ensure() {
    if (root) return;

    root = document.createElement("div");
    root.className = "dialog-overlay";
    root.hidden = true;
    root.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div class="dialog-header">
          <div class="dialog-icon" id="dialog-icon" aria-hidden="true"></div>
          <div class="dialog-header-text">
            <h2 class="dialog-title" id="dialog-title"></h2>
            <p class="dialog-message" id="dialog-message"></p>
          </div>
        </div>
        <p class="dialog-detail" id="dialog-detail"></p>
        <div class="dialog-footer" id="dialog-footer"></div>
      </div>
    `;

    document.body.appendChild(root);

    titleEl = root.querySelector("#dialog-title");
    messageEl = root.querySelector("#dialog-message");
    detailEl = root.querySelector("#dialog-detail");
    footerEl = root.querySelector("#dialog-footer");

    root.addEventListener("click", (event) => {
      if (event.target === root) close(dismissResult);
    });

    document.addEventListener("keydown", (event) => {
      if (root.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close(dismissResult);
      }
    });
  }

  function escapeHtmlAttr(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function buildConditionForm(existing = null) {
    const form = document.createElement("div");
    form.className = "dialog-form";
    form.innerHTML = `
      <label class="dialog-field">
        <span class="dialog-field-label">Назва умови</span>
        <input type="text" class="dialog-field-input" id="dialog-cond-label" placeholder="Наприклад: Позичальник є VIP-клієнтом" maxlength="120">
      </label>
      <div class="dialog-field">
        <span class="dialog-field-label">Варіанти відповіді</span>
        <div class="dialog-option-list" id="dialog-cond-options"></div>
        <button type="button" class="btn btn-sm dialog-add-option-btn" id="dialog-cond-add-option">+ Додати варіант</button>
      </div>
    `;

    const optionsEl = form.querySelector("#dialog-cond-options");
    const labelInput = form.querySelector("#dialog-cond-label");

    function addOptionRow(value = "") {
      const row = document.createElement("div");
      row.className = "dialog-option-row";
      row.innerHTML = `
        <input type="text" class="dialog-field-input dialog-option-input" value="${escapeHtmlAttr(value)}" maxlength="40" placeholder="Варіант відповіді">
        <button type="button" class="dialog-option-remove" aria-label="Прибрати варіант" title="Прибрати">×</button>
      `;
      row.querySelector(".dialog-option-remove").addEventListener("click", () => {
        if (optionsEl.children.length <= 1) return;
        row.remove();
      });
      optionsEl.appendChild(row);
    }

    const initialOptions = existing?.options?.length
      ? existing.options.map((option) => option.label)
      : existing?.type === "boolean"
        ? ["Так", "Ні"]
        : ["Так", "Ні"];

    initialOptions.forEach(addOptionRow);
    if (existing?.label) labelInput.value = existing.label;

    form.querySelector("#dialog-cond-add-option").addEventListener("click", () => {
      addOptionRow();
      optionsEl.lastElementChild?.querySelector("input")?.focus();
    });

    function readPayload() {
      const label = labelInput.value.trim();
      const optionLabels = [...optionsEl.querySelectorAll(".dialog-option-input")]
        .map((input) => input.value.trim())
        .filter(Boolean);

      if (!label) {
        labelInput.focus();
        return null;
      }
      if (!optionLabels.length) return null;

      const seen = new Set();
      const options = optionLabels.map((optionLabel, index) => {
        let value = optionLabel
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-+|-+$/g, "");
        if (!value) value = `opt-${index + 1}`;
        let unique = value;
        let suffix = 2;
        while (seen.has(unique)) {
          unique = `${value}-${suffix}`;
          suffix += 1;
        }
        seen.add(unique);
        return { value: unique, label: optionLabel };
      });

      const isBoolean =
        options.length === 2 &&
        options.some((option) => option.label.toLowerCase() === "так") &&
        options.some((option) => option.label.toLowerCase() === "ні");

      return {
        label,
        type: isBoolean ? "boolean" : "choice",
        options: isBoolean ? undefined : options,
      };
    }

    return { form, labelInput, readPayload };
  }

  function openConditionDialog({ title, message, confirmText, existing = null }) {
    ensure();

    lastFocus = document.activeElement;
    dismissResult = null;

    titleEl.textContent = title;
    messageEl.textContent = message;
    detailEl.hidden = true;

    const iconEl = root.querySelector("#dialog-icon");
    iconEl.className = "dialog-icon dialog-icon--default";
    iconEl.innerHTML = iconFor("default");

    footerEl.innerHTML = "";
    footerEl.classList.remove("dialog-footer--triple");

    root.querySelector(".dialog-form")?.remove();
    const { form, labelInput, readPayload } = buildConditionForm(existing);
    detailEl.insertAdjacentElement("afterend", form);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-sm dialog-btn-cancel";
    cancelBtn.textContent = "Скасувати";
    cancelBtn.addEventListener("click", () => close(null));

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-sm btn-primary dialog-btn-confirm";
    confirmBtn.textContent = confirmText;
    confirmBtn.addEventListener("click", () => {
      const payload = readPayload();
      if (!payload) return;

      if (existing?.id) {
        close({ ...existing, ...payload, id: existing.id });
        return;
      }

      close({
        id: `cond-${Math.random().toString(16).slice(2, 10)}`,
        ...payload,
      });
    });

    footerEl.append(cancelBtn, confirmBtn);
    root.hidden = false;
    document.body.classList.add("dialog-open");
    labelInput.focus();

    return new Promise((resolve) => {
      resolveFn = (result) => {
        form.remove();
        resolve(result);
      };
    });
  }

  function promptConditionCreate() {
    return openConditionDialog({
      title: "Нова умова",
      message: "Створіть умову та варіанти відповідей для правил документа.",
      confirmText: "Створити",
    });
  }

  function promptConditionEdit(existing) {
    return openConditionDialog({
      title: "Редагувати умову",
      message: "Оновіть назву та варіанти відповідей.",
      confirmText: "Зберегти",
      existing,
    });
  }

  function close(result) {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.classList.remove("dialog-open");
    footerEl?.classList.remove("dialog-footer--triple");
    root.querySelector(".dialog-form")?.remove();
    footerEl?.classList.remove("dialog-footer--triple");
    const done = resolveFn;
    resolveFn = null;
    if (lastFocus) lastFocus.focus();
    done?.(result);
  }

  function iconFor(variant) {
    if (variant === "danger") {
      return `<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M4.47 4.47A.75.75 0 0 1 5.28 4H10c.2 0 .38.078.513.22l3.25 3.25a.75.75 0 0 1 0 1.06l-6.75 6.75a.75.75 0 0 1-1.06 0L1.22 9.28a.75.75 0 0 1 0-1.06l3.25-3.25A.75.75 0 0 1 4.47 4.47ZM8 5.5 5.5 8v3.5h3V8L8 5.5Zm-.75 5.25h1.5V9.5h-1.5v1.25Z"/></svg>`;
    }
    if (variant === "success") {
      return `<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>`;
    }
    return `<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5A6.5 6.5 0 1 0 14.5 8 6.508 6.508 0 0 0 8 1.5ZM4.75 6.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm5.5 0a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5ZM8 5.25a.75.75 0 0 1 .75.75v.5a.75.75 0 0 1-1.5 0v-.5A.75.75 0 0 1 8 5.25Z"/></svg>`;
  }

  function open(options) {
    ensure();

    const {
      title,
      message = "",
      detail = "",
      variant = "default",
      confirmText = "Підтвердити",
      cancelText = "Скасувати",
      showCancel = true,
    } = options;

    lastFocus = document.activeElement;
    dismissResult = false;
    titleEl.textContent = title;
    messageEl.textContent = message;
    detailEl.textContent = detail;
    detailEl.hidden = !detail;

    const iconEl = root.querySelector("#dialog-icon");
    iconEl.className = `dialog-icon dialog-icon--${variant}`;
    iconEl.innerHTML = iconFor(variant);

    footerEl.innerHTML = "";

    if (showCancel) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn btn-sm dialog-btn-cancel";
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener("click", () => close(false));
      footerEl.appendChild(cancelBtn);
    }

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = `btn btn-sm ${variant === "danger" ? "btn-danger" : "btn-primary"} dialog-btn-confirm`;
    confirmBtn.textContent = confirmText;
    confirmBtn.addEventListener("click", () => close(true));
    footerEl.appendChild(confirmBtn);

    root.hidden = false;
    document.body.classList.add("dialog-open");
    confirmBtn.focus();

    return new Promise((resolve) => {
      resolveFn = resolve;
    });
  }

  function confirm(options) {
    return open({ showCancel: true, ...options });
  }

  function confirmUnsaved({ title, message, detail = "", fileName = "" } = {}) {
    ensure();

    lastFocus = document.activeElement;
    dismissResult = "cancel";
    titleEl.textContent = title || "DocFlow";
    messageEl.textContent = message || "Зберегти зміни?";
    detailEl.textContent = detail || fileName;
    detailEl.hidden = !(detail || fileName);

    const iconEl = root.querySelector("#dialog-icon");
    iconEl.className = "dialog-icon dialog-icon--default";
    iconEl.innerHTML = iconFor("default");

    footerEl.innerHTML = "";
    footerEl.classList.add("dialog-footer--triple");

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-sm dialog-btn-cancel";
    cancelBtn.textContent = "Скасувати";
    cancelBtn.addEventListener("click", () => close("cancel"));

    const discardBtn = document.createElement("button");
    discardBtn.type = "button";
    discardBtn.className = "btn btn-sm dialog-btn-discard";
    discardBtn.textContent = "Не зберігати";
    discardBtn.addEventListener("click", () => close("discard"));

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-sm btn-primary dialog-btn-save";
    saveBtn.textContent = "Зберегти";
    saveBtn.addEventListener("click", () => close("save"));

    footerEl.append(cancelBtn, discardBtn, saveBtn);

    root.hidden = false;
    document.body.classList.add("dialog-open");
    saveBtn.focus();

    return new Promise((resolve) => {
      resolveFn = resolve;
    });
  }

  function alert(options) {
    return open({
      showCancel: false,
      confirmText: options.confirmText || "Гаразд",
      ...options,
    });
  }

  return { confirm, confirmUnsaved, alert, promptConditionCreate, promptConditionEdit };
})();
