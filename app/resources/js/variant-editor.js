const VariantEditor = (() => {
  let rules = {
    conditions: [],
    rules: [],
    rule_items: [],
    subpoints: [],
  };
  let selectedVariantId = null;
  let collapsedRules = new Set();
  let collapsedSubpoints = new Set();
  let onStatus = () => {};
  let getPreviewEl = () => null;
  let rulesTreeEl = null;

  const WHEN_OPTIONS = [
    { value: "false", label: "Ні" },
    { value: "true", label: "Так" },
  ];

  const CHEVRON_SVG =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.75 5.75a.75.75 0 0 1 1.06 0L8 7.94l2.19-2.19a.75.75 0 1 1 1.06 1.06l-2.72 2.72a.75.75 0 0 1-1.06 0L4.75 6.81a.75.75 0 0 1 0-1.06Z"/></svg>';

  const ICON_DOTS =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM3 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>';

  const ICON_TRASH =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5.25V3h2.25a.75.75 0 0 1 0 1.5H12v8.25a1.75 1.75 0 0 1-1.75 1.75h-4.5A1.75 1.75 0 0 1 4 12.75V4.5H1.75a.75.75 0 0 1 0-1.5H4V2h1.5ZM5 4.5v8.25a.25.25 0 0 0 .25.25h5.5a.25.25 0 0 0 .25-.25V4.5H5Z"/></svg>';

  const ICON_CLEAR =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>';

  let menuDocumentListener = null;

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function newId(prefix) {
    return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function whenToValue(when) {
    const value = when?.bank_employee;
    if (value === true) return "true";
    if (value === false) return "false";
    return "";
  }

  function valueToWhen(value) {
    if (value === "true") return { bank_employee: true };
    if (value === "false") return { bank_employee: false };
    return { bank_employee: null };
  }

  function findSubpoint(subpointId) {
    return (rules.subpoints || []).find((sp) => sp.id === subpointId) || null;
  }

  function findRule(ruleId) {
    return (rules.rules || []).find((rule) => rule.id === ruleId) || null;
  }

  function findVariant(variantId) {
    for (const subpoint of rules.subpoints || []) {
      for (const variant of subpoint.variants || []) {
        if (variant.id === variantId) return { subpoint, variant };
      }
    }
    return null;
  }

  function getRuleItems(ruleId) {
    return (rules.rule_items || []).filter((item) => item.rule_id === ruleId);
  }

  function getAvailableSubpointsForRule(ruleId) {
    const assigned = new Set(
      getRuleItems(ruleId).map((item) => item.subpoint_id).filter(Boolean),
    );
    return (rules.subpoints || []).filter((sp) => sp.id && !assigned.has(sp.id));
  }

  function isSubpointConfigured(subpoint) {
    const variants = subpoint?.variants || [];
    if (!variants.length) return false;
    return variants.every((variant) => whenToValue(variant.when) !== "");
  }

  function getAllAssignedContentIds(excludeVariantId = null) {
    const ids = new Set();
    for (const subpoint of rules.subpoints || []) {
      for (const variant of subpoint.variants || []) {
        if (variant.id === excludeVariantId) continue;
        for (const blockId of variant.content_block_ids || []) {
          ids.add(blockId);
        }
      }
    }
    return ids;
  }

  function truncateLabel(text, limit = 72) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= limit) return clean;
    return `${clean.slice(0, limit - 1)}…`;
  }

  function renderWhenPills(variantId, currentWhen) {
    return `
      <div class="rules-when-pills" role="radiogroup" aria-label="Відповідь для варіанту">
        ${WHEN_OPTIONS.map(
          (opt) => `
            <label class="rules-when-pill">
              <input type="radio" name="when-${variantId}" value="${opt.value}" data-variant-when-radio="${variantId}" ${currentWhen === opt.value ? "checked" : ""}>
              <span>${opt.label}</span>
            </label>
          `,
        ).join("")}
      </div>
    `;
  }

  function renderKebabMenu(menuHtml) {
    return `<div class="ui-menu">${menuHtml}</div>`;
  }

  function closeAllMenus(container) {
    container?.querySelectorAll(".ui-menu.is-open").forEach((menu) => {
      menu.classList.remove("is-open");
      menu.querySelector(".ui-menu-trigger")?.setAttribute("aria-expanded", "false");
    });
  }

  function bindMenuEvents(container) {
    closeAllMenus(container);

    container.querySelectorAll(".ui-menu-trigger").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const menu = btn.closest(".ui-menu");
        if (!menu) return;
        const wasOpen = menu.classList.contains("is-open");
        closeAllMenus(container);
        if (!wasOpen) {
          menu.classList.add("is-open");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    });

    if (menuDocumentListener) {
      document.removeEventListener("click", menuDocumentListener);
    }
    menuDocumentListener = () => closeAllMenus(container);
    document.addEventListener("click", menuDocumentListener);
  }

  function ruleMenuMarkup(ruleId) {
    return renderKebabMenu(`
      <button type="button" class="ui-menu-trigger" aria-haspopup="menu" aria-expanded="false" aria-label="Дії з правилом">
        ${ICON_DOTS}
      </button>
      <div class="ui-menu-dropdown" role="menu">
        <button type="button" class="ui-menu-item ui-menu-item--danger" role="menuitem" data-delete-rule="${ruleId}">
          ${ICON_TRASH}
          <span>Видалити правило</span>
        </button>
      </div>
    `);
  }

  function subpointMenuMarkup(ruleItemId) {
    return renderKebabMenu(`
      <button type="button" class="ui-menu-trigger" aria-haspopup="menu" aria-expanded="false" aria-label="Дії з підпунктом">
        ${ICON_DOTS}
      </button>
      <div class="ui-menu-dropdown" role="menu">
        <button type="button" class="ui-menu-item ui-menu-item--danger" role="menuitem" data-remove-item="${ruleItemId}">
          ${ICON_TRASH}
          <span>Прибрати з правила</span>
        </button>
      </div>
    `);
  }

  function ensureRulesShape(nextRules) {
    const base = nextRules || {};
    return {
      conditions: base.conditions?.length
        ? base.conditions
        : [
            {
              id: "bank_employee",
              label: "Позичальник є працівником банку",
              type: "boolean",
            },
          ],
      rules: Array.isArray(base.rules) ? base.rules : [],
      rule_items: Array.isArray(base.rule_items) ? base.rule_items : [],
      subpoints: Array.isArray(base.subpoints) ? base.subpoints : [],
    };
  }

  function collapseAllRulesExcept(exceptRuleId) {
    for (const rule of rules.rules || []) {
      if (rule.id === exceptRuleId) collapsedRules.delete(rule.id);
      else collapsedRules.add(rule.id);
    }
  }

  function collapseSubpointsInRuleExcept(ruleId, exceptItemId) {
    for (const item of getRuleItems(ruleId)) {
      if (item.id === exceptItemId) collapsedSubpoints.delete(item.id);
      else collapsedSubpoints.add(item.id);
    }
  }

  function expandForVariant(variantId) {
    const found = findVariant(variantId);
    if (!found) return;

    for (const item of rules.rule_items || []) {
      if (item.subpoint_id !== found.subpoint.id) continue;
      collapsedRules.delete(item.rule_id);
      collapsedSubpoints.delete(item.id);
      break;
    }
  }

  function createRule(conditionId = "bank_employee") {
    const rule = { id: newId("rule"), condition_id: conditionId };
    rules.rules = [...(rules.rules || []), rule];
    collapseAllRulesExcept(rule.id);
    return rule;
  }

  function addSubpointToRule(ruleId, subpointId) {
    if (!ruleId || !subpointId) return null;
    if (getRuleItems(ruleId).some((item) => item.subpoint_id === subpointId)) {
      return null;
    }
    const item = { id: newId("ri"), rule_id: ruleId, subpoint_id: subpointId };
    rules.rule_items = [...(rules.rule_items || []), item];
    collapseAllRulesExcept(ruleId);
    collapseSubpointsInRuleExcept(ruleId, item.id);
    return item;
  }

  function removeRuleItem(itemId) {
    rules.rule_items = (rules.rule_items || []).filter((item) => item.id !== itemId);
    collapsedSubpoints.delete(itemId);
    selectedVariantId = null;
  }

  function deleteRule(ruleId) {
    rules.rules = (rules.rules || []).filter((rule) => rule.id !== ruleId);
    for (const item of getRuleItems(ruleId)) {
      collapsedSubpoints.delete(item.id);
    }
    rules.rule_items = (rules.rule_items || []).filter(
      (item) => item.rule_id !== ruleId,
    );
    collapsedRules.delete(ruleId);
    selectedVariantId = null;
  }

  function refreshHighlights() {
    const preview = getPreviewEl();
    if (!preview) return;

    preview.querySelectorAll("[data-block-id]").forEach((block) => {
      block.classList.remove(
        "docx-block--subpoint",
        "docx-block--variant-active",
        "docx-block--variant-inactive",
        "docx-block--content-active",
        "docx-block--content-inactive",
        "docx-block--selected",
      );
    });

    const activeSubpointIds = new Set(
      (rules.rule_items || [])
        .map((item) => item.subpoint_id)
        .filter((id) => {
          const subpoint = findSubpoint(id);
          return subpoint && isSubpointConfigured(subpoint);
        }),
    );

    for (const subpoint of rules.subpoints || []) {
      if (!activeSubpointIds.has(subpoint.id)) continue;

      const spBlock = preview.querySelector(
        `[data-block-id="${subpoint.header_block_id}"]`,
      );
      if (spBlock) spBlock.classList.add("docx-block--subpoint");

      for (const variant of subpoint.variants || []) {
        const headerBlock = preview.querySelector(
          `[data-block-id="${variant.header_block_id}"]`,
        );
        if (headerBlock) {
          headerBlock.classList.add(
            variant.id === selectedVariantId
              ? "docx-block--variant-active"
              : "docx-block--variant-inactive",
          );
        }

        for (const blockId of variant.content_block_ids || []) {
          const block = preview.querySelector(`[data-block-id="${blockId}"]`);
          if (!block) continue;
          block.classList.add(
            variant.id === selectedVariantId
              ? "docx-block--content-active"
              : "docx-block--content-inactive",
          );
        }
      }
    }

    if (selectedVariantId) {
      const found = findVariant(selectedVariantId);
      if (found) {
        [
          found.variant.header_block_id,
          ...(found.variant.content_block_ids || []),
        ].forEach((blockId) => {
          const block = preview.querySelector(`[data-block-id="${blockId}"]`);
          if (block) block.classList.add("docx-block--selected");
        });
      }
    }
  }

  function renderSubpointBlock(subpoint, spIndex, ruleItemId) {
    const configured = isSubpointConfigured(subpoint);
    const isCollapsed = collapsedSubpoints.has(ruleItemId);

    const parts = [
      `<section class="rules-subpoint ${configured ? "is-configured" : "is-pending"} ${isCollapsed ? "is-collapsed" : ""}" data-rule-item-id="${ruleItemId}">`,
      `<header class="rules-subpoint-head">`,
      `<div class="rules-subpoint-head-row">`,
      `<button type="button" class="rules-collapse-btn rules-collapse-btn--sub" data-toggle-subpoint="${ruleItemId}" aria-expanded="${!isCollapsed}" aria-label="Згорнути підпункт ${spIndex + 1}">`,
      CHEVRON_SVG,
      `</button>`,
      `<span class="rules-subpoint-badge">Підпункт ${spIndex + 1}</span>`,
      configured
        ? `<span class="rules-subpoint-status is-ok">Готово</span>`
        : `<span class="rules-subpoint-status is-pending">Оберіть Так або Ні</span>`,
      `<div class="rules-head-actions">${subpointMenuMarkup(ruleItemId)}</div>`,
      `</div>`,
      `<p class="rules-subpoint-title" title="${escapeHtml(subpoint.label || "")}">${escapeHtml(subpoint.label || "")}</p>`,
      `</header>`,
      `<div class="rules-collapsible-body"><div class="rules-collapsible-inner">`,
      `<div class="rules-variants">`,
    ];

    (subpoint.variants || []).forEach((variant, varIndex) => {
      const contentCount = (variant.content_block_ids || []).length;
      const isSelected = variant.id === selectedVariantId;
      const currentWhen = whenToValue(variant.when);
      parts.push(`
        <article class="rules-variant ${isSelected ? "is-selected" : ""} ${currentWhen ? "is-assigned" : "is-unassigned"}" data-variant-id="${variant.id}">
          <button type="button" class="rules-variant-select" data-variant-id="${variant.id}">
            <span class="rules-variant-num">${varIndex + 1}</span>
            <span class="rules-variant-copy">
              <span class="rules-variant-label">Варіант ${varIndex + 1}</span>
              <span class="rules-variant-text" title="${escapeHtml(variant.label || "")}">${escapeHtml(truncateLabel(variant.label))}</span>
            </span>
          </button>
          <div class="rules-variant-when-row">
            <span class="rules-variant-when-label">Показувати, якщо відповідь</span>
            ${renderWhenPills(variant.id, currentWhen)}
          </div>
          ${isSelected ? `<p class="rules-variant-hint">Клікніть абзаци в документі праворуч${contentCount ? ` · ${contentCount} обрано` : ""}</p>` : ""}
          ${isSelected && contentCount ? `
            <div class="rules-variant-tools">
              <button type="button" class="rules-icon-btn" data-clear-content="${variant.id}" title="Очистити наповнення" aria-label="Очистити наповнення варіанту ${varIndex + 1}">
                ${ICON_CLEAR}
              </button>
            </div>
          ` : ""}
        </article>
      `);
    });

    parts.push("</div></div></div></section>");
    return parts.join("");
  }

  function renderRuleCard(rule, ruleIndex) {
    const condition = (rules.conditions || []).find(
      (item) => item.id === rule.condition_id,
    );
    const conditionOptions = (rules.conditions || [])
      .map(
        (item) =>
          `<option value="${item.id}" ${item.id === rule.condition_id ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
      )
      .join("");

    const items = getRuleItems(rule.id);
    const available = getAvailableSubpointsForRule(rule.id);
    const isCollapsed = collapsedRules.has(rule.id);
    const configuredCount = items.filter((item) => {
      const subpoint = findSubpoint(item.subpoint_id);
      return subpoint && isSubpointConfigured(subpoint);
    }).length;

    const parts = [
      `<section class="rules-rule-card ${isCollapsed ? "is-collapsed" : ""}" data-rule-id="${rule.id}">`,
      `<header class="rules-rule-head">`,
      `<button type="button" class="rules-collapse-btn" data-toggle-rule="${rule.id}" aria-expanded="${!isCollapsed}" aria-label="Згорнути правило ${ruleIndex + 1}">`,
      CHEVRON_SVG,
      `</button>`,
      `<div class="rules-rule-head-main">`,
      `<div class="rules-rule-head-top">`,
      `<span class="rules-rule-badge">Правило ${ruleIndex + 1}</span>`,
      `<span class="rules-rule-summary">${items.length} пункт(ів) · ${configuredCount} налашт.</span>`,
      `</div>`,
      `<label class="rules-rule-condition">`,
      `<span>Умова</span>`,
      `<select data-rule-condition="${rule.id}" aria-label="Умова для правила ${ruleIndex + 1}">`,
      conditionOptions,
      `</select>`,
      `</label>`,
      `</div>`,
      `<div class="rules-head-actions">${ruleMenuMarkup(rule.id)}</div>`,
      `</header>`,
      `<div class="rules-collapsible-body"><div class="rules-collapsible-inner">`,
    ];

    if (condition) {
      parts.push(
        `<p class="rules-rule-help">Оберіть для кожного варіанту відповідь <strong>Так</strong> або <strong>Ні</strong>, потім клікніть текст у документі.</p>`,
      );
    }

    if (items.length) {
      parts.push('<div class="rules-rule-items">');
      items.forEach((item, index) => {
        const subpoint = findSubpoint(item.subpoint_id);
        if (subpoint) {
          parts.push(renderSubpointBlock(subpoint, index, item.id));
        }
      });
      parts.push("</div>");
    } else {
      parts.push(
        '<p class="rules-rule-empty">Додайте підпункт з документа та налаштуйте варіанти.</p>',
      );
    }

    if (available.length) {
      parts.push(`
        <label class="rules-add-item">
          <span>Додати пункт</span>
          <select data-add-subpoint="${rule.id}">
            <option value="">— оберіть підпункт —</option>
            ${available
              .map(
                (sp, index) =>
                  `<option value="${sp.id}">Підпункт ${items.length + index + 1}: ${escapeHtml(sp.label || "")}</option>`,
              )
              .join("")}
          </select>
        </label>
      `);
    }

    parts.push("</div></div></section>");
    return parts.join("");
  }

  function renderRulesTree(container) {
    if (!container) return;

    if (!rules.subpoints?.length) {
      container.innerHTML =
        '<p class="rules-empty">У документі не знайдено червоних підпунктів з варіантами.</p>';
      return;
    }

    const parts = ['<div class="rules-tree">'];

    if (!rules.rules?.length) {
      parts.push(`
        <p class="rules-empty rules-empty--soft">
          Створіть правило, оберіть умову та додайте підпункти з документа.
          Після налаштування варіантів (Так/Ні) умова зʼявиться у «Перегляді».
        </p>
      `);
    } else {
      rules.rules.forEach((rule, index) => {
        parts.push(renderRuleCard(rule, index));
      });
    }

    parts.push("</div>");
    container.innerHTML = parts.join("");
    bindRulesTreeEvents(container);
    bindMenuEvents(container);
  }

  function addRule() {
    if (!rules.subpoints?.length) {
      onStatus("У документі немає підпунктів для правил", true);
      return;
    }
    const defaultCondition = rules.conditions?.[0]?.id || "bank_employee";
    createRule(defaultCondition);
    if (rulesTreeEl) renderRulesTree(rulesTreeEl);
    onStatus("Правило створено — попередні згорнуто");
  }

  function bindRulesTreeEvents(container) {
    container.querySelectorAll("[data-toggle-rule]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ruleId = btn.dataset.toggleRule;
        if (collapsedRules.has(ruleId)) collapsedRules.delete(ruleId);
        else collapsedRules.add(ruleId);
        renderRulesTree(container);
      });
    });

    container.querySelectorAll("[data-toggle-subpoint]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const itemId = btn.dataset.toggleSubpoint;
        if (collapsedSubpoints.has(itemId)) collapsedSubpoints.delete(itemId);
        else collapsedSubpoints.add(itemId);
        renderRulesTree(container);
      });
    });

    container.querySelectorAll("[data-delete-rule]").forEach((btn) => {
      btn.addEventListener("click", () => {
        deleteRule(btn.dataset.deleteRule);
        renderRulesTree(container);
        refreshHighlights();
        onStatus("Правило видалено");
      });
    });

    container.querySelectorAll("[data-rule-condition]").forEach((select) => {
      select.addEventListener("change", () => {
        const rule = findRule(select.dataset.ruleCondition);
        if (!rule) return;
        rule.condition_id = select.value;
      });
    });

    container.querySelectorAll("[data-add-subpoint]").forEach((select) => {
      select.addEventListener("change", () => {
        const subpointId = select.value;
        if (!subpointId) return;
        const added = addSubpointToRule(select.dataset.addSubpoint, subpointId);
        if (!added) return;
        renderRulesTree(container);
        refreshHighlights();
        onStatus("Підпункт додано — інші згорнуто");
      });
    });

    container.querySelectorAll("[data-remove-item]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeRuleItem(btn.dataset.removeItem);
        renderRulesTree(container);
        refreshHighlights();
        onStatus("Підпункт прибрано з правила");
      });
    });

    container.querySelectorAll(".rules-variant-select").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedVariantId = btn.dataset.variantId;
        expandForVariant(selectedVariantId);
        renderRulesTree(container);
        refreshHighlights();
        onStatus("Клікніть абзаци в документі праворуч, щоб додати наповнення");
      });
    });

    container.querySelectorAll("[data-variant-when-radio]").forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        const found = findVariant(input.dataset.variantWhenRadio);
        if (!found) return;
        found.variant.when = valueToWhen(input.value);
        renderRulesTree(container);
        refreshHighlights();
      });
    });

    container.querySelectorAll("[data-clear-content]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const found = findVariant(btn.dataset.clearContent);
        if (!found) return;
        found.variant.content_block_ids = [];
        renderRulesTree(container);
        refreshHighlights();
      });
    });
  }

  function bindDocumentClicks(preview) {
    if (!preview) return;

    preview.addEventListener("click", (event) => {
      const block = event.target.closest("[data-block-id]");
      if (!block || !selectedVariantId) return;

      event.preventDefault();
      event.stopPropagation();

      const blockId = block.dataset.blockId;
      const found = findVariant(selectedVariantId);
      if (!found) return;
      if (blockId === found.variant.header_block_id) return;
      if (blockId === found.subpoint.header_block_id) return;

      const ids = found.variant.content_block_ids || [];
      const index = ids.indexOf(blockId);
      if (index >= 0) {
        ids.splice(index, 1);
      } else {
        const taken = getAllAssignedContentIds(selectedVariantId);
        if (taken.has(blockId)) {
          onStatus("Цей блок уже в іншому варіанті", true);
          return;
        }
        ids.push(blockId);
      }
      found.variant.content_block_ids = ids;
      renderRulesTree(rulesTreeEl);
      refreshHighlights();
    });
  }

  return {
    init({ previewEl, rulesTreeEl: treeEl, statusFn }) {
      getPreviewEl = () => previewEl;
      rulesTreeEl = treeEl;
      onStatus = statusFn || (() => {});
      if (treeEl) bindDocumentClicks(previewEl);
    },

    setRules(nextRules) {
      rules = ensureRulesShape(nextRules);
      selectedVariantId = null;
      collapsedRules = new Set();
      collapsedSubpoints = new Set();
    },

    getRules() {
      return rules;
    },

    hasConfiguredRules() {
      return (rules.rule_items || []).some((item) => {
        const subpoint = findSubpoint(item.subpoint_id);
        return subpoint && isSubpointConfigured(subpoint);
      });
    },

    render(treeEl) {
      if (treeEl) rulesTreeEl = treeEl;
      renderRulesTree(rulesTreeEl);
      refreshHighlights();
    },

    addRule,

    refreshHighlights,
  };
})();
