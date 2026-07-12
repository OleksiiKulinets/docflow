const Dialogs = (() => {
  let root = null;
  let titleEl = null;
  let messageEl = null;
  let detailEl = null;
  let footerEl = null;
  let resolveFn = null;
  let lastFocus = null;

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
      if (event.target === root) close(false);
    });

    document.addEventListener("keydown", (event) => {
      if (root.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    });
  }

  function close(result) {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.classList.remove("dialog-open");
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

  function alert(options) {
    return open({
      showCancel: false,
      confirmText: options.confirmText || "Гаразд",
      ...options,
    });
  }

  return { confirm, alert };
})();
