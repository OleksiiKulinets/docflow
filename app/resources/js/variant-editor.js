const VariantEditor = (() => {
  const KIND_SECTION = "section";
  const KIND_VARIANT = "variant";
  const KIND_OPTIONAL = "optional";

  const WHEN_OPTIONS = [
    { value: "false", label: "Ні" },
    { value: "true", label: "Так" },
  ];

  let rules = { schema_version: 3, conditions: [], rules: [], entries: [] };
  let selectedEntryId = null;
  let pendingAdd = null;
  let collapsedRules = new Set();
  let expandedContentIds = new Set();
  let documentClicksBound = false;
  let editorEventsBound = false;
  let onStatus = () => {};
  let onRulesChange = () => {};
  let getPreviewEl = () => null;
  let conditionsEl = null;
  let rulesTreeEl = null;
  let modeBannerEl = null;
  let rulesEditorEl = null;
  let scrollFlashTimer = null;

  const CHEVRON =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.75 5.75a.75.75 0 0 1 1.06 0L8 7.94l2.19-2.19a.75.75 0 1 1 1.06 1.06l-2.72 2.72a.75.75 0 0 1-1.06 0L4.75 6.81a.75.75 0 0 1 0-1.06Z"/></svg>';
  const ICON_TRASH =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5.25V3h2.25a.75.75 0 0 1 0 1.5H12v8.25a1.75 1.75 0 0 1-1.75 1.75h-4.5A1.75 1.75 0 0 1 4 12.75V4.5H1.75a.75.75 0 0 1 0-1.5H4V2h1.5ZM5 4.5v8.25a.25.25 0 0 0 .25.25h5.5a.25.25 0 0 0 .25-.25V4.5H5Z"/></svg>';
  const ICON_EDIT =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM9.75 4.81 3.5 11.06V12.5h1.44l6.25-6.25L9.75 4.81Z"/></svg>';

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function newId(prefix) {
    return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function truncate(text, limit = 72) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
  }

  function ensureRulesShape(nextRules) {
    const base = nextRules || {};
    return {
      schema_version: 3,
      conditions: Array.isArray(base.conditions) ? base.conditions : [],
      rules: Array.isArray(base.rules) ? base.rules : [],
      entries: Array.isArray(base.entries) ? base.entries : [],
    };
  }

  function findCondition(conditionId) {
    return (rules.conditions || []).find((item) => item.id === conditionId) || null;
  }

  function findRule(ruleId) {
    return (rules.rules || []).find((rule) => rule.id === ruleId) || null;
  }

  function findEntry(entryId) {
    return (rules.entries || []).find((entry) => entry.id === entryId) || null;
  }

  function entriesForRule(ruleId) {
    return (rules.entries || []).filter((entry) => entry.rule_id === ruleId);
  }

  function getChildren(entryId) {
    return (rules.entries || []).filter((item) => item.parent_id === entryId);
  }

  function isGroup(entry) {
    return entry?.kind === KIND_SECTION;
  }

  function isMarker(entry) {
    return entry?.kind === KIND_OPTIONAL;
  }

  function isVariant(entry) {
    return entry?.kind === KIND_VARIANT;
  }

  function getParent(entry) {
    return entry?.parent_id ? findEntry(entry.parent_id) : null;
  }

  function isMarkerVariant(entry) {
    return isVariant(entry) && isMarker(getParent(entry));
  }

  function isGroupVariant(entry) {
    return isVariant(entry) && isGroup(getParent(entry));
  }

  function whenToValue(when, condition) {
    if (!condition) return "";
    const raw = when?.[condition.id];
    if (raw === null || raw === undefined) return "";
    if (typeof raw === "boolean") return raw ? "true" : "false";
    return String(raw);
  }

  function valueToWhen(value, condition, previousWhen = {}) {
    const when = { ...(previousWhen || {}) };
    if (!condition || !value) {
      if (condition) when[condition.id] = null;
      return when;
    }
    if (condition.type === "boolean") {
      when[condition.id] = value === "true";
    } else {
      when[condition.id] = value;
    }
    return when;
  }

  function getConditionOptions(condition) {
    if (condition?.options?.length) {
      return condition.options
        .filter((option) => {
          const label = String(option.label || "").trim();
          return label !== "—" && label !== "-";
        })
        .map((option) => ({
          value: option.value,
          label: option.label,
        }));
    }
    return WHEN_OPTIONS;
  }

  function getMarkerBranchOptions(condition) {
    const options = getConditionOptions(condition);
    if (!options.length) {
      return { yes: "true", no: "false", yesLabel: "Так", noLabel: "Ні" };
    }
    const yes = options[0];
    const no = options[1] || options[0];
    return {
      yes: String(yes.value),
      no: String(no.value),
      yesLabel: yes.label || "Так",
      noLabel: no.label || "Ні",
    };
  }

  function getWhenLabel(entry, condition) {
    const value = whenToValue(entry.when, condition);
    if (!value) return "";
    const option = getConditionOptions(condition).find((opt) => String(opt.value) === value);
    return option?.label || value;
  }

  function createMarkerForkVariant(ruleId, markerId, condition, branchValue, branchLabel) {
    return {
      id: newId("entry"),
      rule_id: ruleId,
      header_block_id: "",
      label: branchLabel,
      kind: KIND_VARIANT,
      parent_id: markerId,
      when: valueToWhen(branchValue, condition),
      content_block_ids: [],
    };
  }

  function ensureMarkerFork(marker) {
    const rule = findRule(marker.rule_id);
    const condition = rule ? findCondition(rule.condition_id) : null;
    if (!condition) return { yes: null, no: null };

    const branch = getMarkerBranchOptions(condition);
    const children = getChildren(marker.id).filter(isVariant);
    let yes = children.find((entry) => whenToValue(entry.when, condition) === branch.yes);
    let no = children.find((entry) => whenToValue(entry.when, condition) === branch.no);
    const toAdd = [];

    if (!yes) {
      yes = createMarkerForkVariant(marker.rule_id, marker.id, condition, branch.yes, branch.yesLabel);
      toAdd.push(yes);
    }
    if (!no) {
      no = createMarkerForkVariant(marker.rule_id, marker.id, condition, branch.no, branch.noLabel);
      toAdd.push(no);
    }
    if (toAdd.length) rules.entries = [...(rules.entries || []), ...toAdd];

    const keepIds = new Set([yes.id, no.id]);
    rules.entries = (rules.entries || []).filter(
      (entry) => !(entry.parent_id === marker.id && isVariant(entry) && !keepIds.has(entry.id)),
    );

    yes = findEntry(yes.id);
    no = findEntry(no.id);

    if (yes) {
      yes.when = valueToWhen(branch.yes, condition);
      yes.label = branch.yesLabel;
      yes.header_block_id = "";
      yes.parent_id = marker.id;
      yes.kind = KIND_VARIANT;
    }
    if (no) {
      no.when = valueToWhen(branch.no, condition);
      no.label = branch.noLabel;
      no.header_block_id = "";
      no.parent_id = marker.id;
      no.kind = KIND_VARIANT;
    }

    return { yes, no };
  }

  function cleanupLegacyRuleEntries(rule) {
    const roots = entriesForRule(rule.id).filter((entry) => !entry.parent_id);
    if (!roots.some(isMarker)) return;
    rules.entries = (rules.entries || []).filter(
      (entry) => !(entry.rule_id === rule.id && !entry.parent_id && isVariant(entry)),
    );
  }

  function syncMarkerForks(rule) {
    if (!rule?.condition_id) return;
    cleanupLegacyRuleEntries(rule);
    for (const entry of entriesForRule(rule.id)) {
      if (isMarker(entry)) ensureMarkerFork(entry);
    }
  }

  function entryIsConfigured(entry, conditionId) {
    if (!conditionId) return false;
    const condition = findCondition(conditionId);

    if (isMarker(entry)) {
      const { yes, no } = ensureMarkerFork(entry);
      return Boolean(
        yes &&
          no &&
          whenToValue(yes.when, condition) !== "" &&
          whenToValue(no.when, condition) !== "" &&
          ((yes.content_block_ids || []).length > 0 ||
            (no.content_block_ids || []).length > 0),
      );
    }

    if (isGroup(entry)) {
      const children = getChildren(entry.id).filter(isVariant);
      if (!children.length) return false;
      return children.every((child) => entryIsConfigured(child, conditionId));
    }

    if (isVariant(entry)) {
      if (isMarkerVariant(entry)) {
        return (entry.content_block_ids || []).length > 0;
      }
      if (whenToValue(entry.when, condition) === "") return false;
      return (entry.content_block_ids || []).length > 0;
    }

    return false;
  }

  function ruleIsConfigured(rule) {
    if (!rule?.condition_id) return false;
    const roots = entriesForRule(rule.id).filter((entry) => !entry.parent_id);
    if (!roots.length) return false;
    return roots.every((entry) => entryIsConfigured(entry, rule.condition_id));
  }

  function getSelectedGroupForRule(ruleId) {
    const selected = findEntry(selectedEntryId);
    if (!selected || selected.rule_id !== ruleId) return null;
    if (isGroup(selected)) return selected;
    if (isGroupVariant(selected)) return getParent(selected);
    return null;
  }

  function getSiblingForkContentIds(entry) {
    const parent = getParent(entry);
    if (!parent || !isMarker(parent)) return new Set();
    const ids = new Set();
    for (const sibling of getChildren(parent.id)) {
      if (sibling.id === entry.id || !isVariant(sibling)) continue;
      for (const blockId of sibling.content_block_ids || []) ids.add(blockId);
    }
    return ids;
  }

  function getAllAssignedContentIds(excludeEntryId = null) {
    const ids = new Set();
    for (const entry of rules.entries || []) {
      if (entry.id === excludeEntryId) continue;
      for (const blockId of entry.content_block_ids || []) ids.add(blockId);
    }
    return ids;
  }

  function getUsedHeaderBlockIds(excludeEntryId = null) {
    const ids = new Set();
    for (const entry of rules.entries || []) {
      if (entry.id === excludeEntryId) continue;
      if (entry.header_block_id) ids.add(entry.header_block_id);
    }
    return ids;
  }

  function getBlockText(blockId) {
    const block = getPreviewEl()?.querySelector(`[data-block-id="${blockId}"]`);
    return (block?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function getContentTexts(entry) {
    return (entry.content_block_ids || []).map(getBlockText).filter(Boolean);
  }

  function getContentPreviewText(entry, expanded = false) {
    const texts = getContentTexts(entry);
    if (!texts.length) return "";
    const full = texts.join(" ");
    return expanded ? full : truncate(full, 96);
  }

  function blockLabelFromPreview(blockId) {
    const preview = getPreviewEl();
    const block = preview?.querySelector(`[data-block-id="${blockId}"]`);
    return truncate(block?.textContent || blockId, 90);
  }

  function scrollToBlock(blockId) {
    const preview = getPreviewEl();
    if (!preview || !blockId) return;
    const block = preview.querySelector(`[data-block-id="${blockId}"]`);
    if (!block) {
      onStatus("Фрагмент не знайдено в документі", true);
      return;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    preview.scrollTo({
      top: Math.max(0, block.offsetTop - (preview.clientHeight - block.offsetHeight) / 2),
      behavior: reduceMotion ? "auto" : "smooth",
    });
    if (scrollFlashTimer) clearTimeout(scrollFlashTimer);
    block.classList.add("docx-block--scroll-flash");
    scrollFlashTimer = setTimeout(() => {
      block.classList.remove("docx-block--scroll-flash");
      scrollFlashTimer = null;
    }, 1400);
  }

  function renderWhenPills(entryId, currentWhen, condition) {
    if (!condition) return "";
    return `
      <div class="rules-when-pills rules-when-pills--inline" role="radiogroup">
        ${getConditionOptions(condition)
          .map(
            (opt) => `
          <label class="rules-when-pill">
            <input type="radio" name="when-${entryId}" value="${escapeHtml(opt.value)}"
              data-entry-when="${entryId}" ${currentWhen === String(opt.value) ? "checked" : ""}>
            <span>${escapeHtml(opt.label)}</span>
          </label>`,
          )
          .join("")}
      </div>`;
  }

  function renderContentPreview(entry, emptyText) {
    const texts = getContentTexts(entry);
    if (!texts.length) {
      return `<p class="rules-fork-empty">${escapeHtml(emptyText)}</p>`;
    }

    const full = texts.join(" ");
    const isExpanded = expandedContentIds.has(entry.id);
    const preview = getContentPreviewText(entry, isExpanded);
    const canToggle = full.length > 96 || texts.length > 1;

    return `
      <button type="button" class="rules-content-preview ${isExpanded ? "is-expanded" : ""}"
        data-toggle-content="${entry.id}" ${canToggle ? "" : "disabled"}>
        <span class="rules-content-preview-label">Наповнення</span>
        <span class="rules-content-preview-text">${escapeHtml(preview)}</span>
        ${canToggle ? `<span class="rules-content-preview-hint">${isExpanded ? "згорнути" : "повністю"}</span>` : ""}
      </button>`;
  }

  function renderMarkerForkSlot(entry, branch) {
    if (!entry) return "";
    const isSelected = selectedEntryId === entry.id;
    const contentCount = (entry.content_block_ids || []).length;
    const label = branch === "yes" ? "Так" : "Ні";

    return `
      <li class="rules-fork-slot rules-fork-slot--${branch} ${isSelected ? "is-selected" : ""} ${contentCount ? "is-ready" : "is-incomplete"}"
        data-entry-id="${entry.id}">
        <div class="rules-fork-head">
          <button type="button" class="rules-fork-select" data-select-entry="${entry.id}">
            <span class="rules-fork-badge rules-fork-badge--${branch}">${label}</span>
            <span class="rules-fork-title">Наповнення для «${escapeHtml(label)}»</span>
          </button>
          <span class="rules-tree-meta">${contentCount ? `${contentCount} абз.` : "порожньо"}</span>
          ${
            isSelected && contentCount
              ? `<button type="button" class="btn btn-sm btn-ghost" data-clear-entry="${entry.id}">Очистити</button>`
              : ""
          }
        </div>
        ${renderContentPreview(entry, "Оберіть цей варіант і клікніть абзаци в документі")}
      </li>`;
  }

  function renderMarkerNode(entry, condition) {
    const isSelected = selectedEntryId === entry.id;
    const { yes, no } = ensureMarkerFork(entry);

    return `
      <li class="rules-tree-node rules-tree-node--marker ${isSelected ? "is-selected" : ""}" data-entry-id="${entry.id}">
        <div class="rules-tree-row rules-tree-row--main">
          <button type="button" class="rules-tree-select" data-select-entry="${entry.id}">
            <span class="rules-tree-kind">Маркер</span>
            <span class="rules-tree-label">${escapeHtml(truncate(entry.label, 64))}</span>
          </button>
          <span class="rules-tree-meta">Так / Ні</span>
          <button type="button" class="rules-icon-btn" data-scroll-block="${entry.header_block_id}" title="Показати в документі">↗</button>
          <button type="button" class="rules-icon-btn rules-icon-btn--danger" data-delete-entry="${entry.id}" title="Видалити">${ICON_TRASH}</button>
        </div>
        <ul class="rules-fork-list rules-fork-list--nested">
          ${renderMarkerForkSlot(yes, "yes")}
          ${renderMarkerForkSlot(no, "no")}
        </ul>
      </li>`;
  }

  function renderGroupVariantNode(entry, condition) {
    const isSelected = selectedEntryId === entry.id;
    const contentCount = (entry.content_block_ids || []).length;
    const currentWhen = whenToValue(entry.when, condition);
    const whenReady = currentWhen !== "";
    const whenLabel = getWhenLabel(entry, condition);

    return `
      <li class="rules-tree-node rules-tree-node--variant ${isSelected ? "is-selected" : ""} ${whenReady && contentCount ? "is-ready" : "is-incomplete"}"
        data-entry-id="${entry.id}">
        <div class="rules-tree-row rules-tree-row--main">
          <button type="button" class="rules-tree-select" data-select-entry="${entry.id}">
            <span class="rules-tree-kind">Варіант</span>
            <span class="rules-tree-label">${escapeHtml(truncate(entry.label, 52))}</span>
          </button>
          ${
            whenReady
              ? `<span class="rules-tree-when-badge rules-tree-when-badge--${currentWhen === "true" ? "yes" : "no"}">${escapeHtml(whenLabel)}</span>`
              : `<span class="rules-tree-when-badge rules-tree-when-badge--empty">не обрано</span>`
          }
          <span class="rules-tree-meta">${contentCount ? `${contentCount} абз.` : "без тексту"}</span>
          <button type="button" class="rules-icon-btn" data-scroll-block="${entry.header_block_id}" title="Показати в документі">↗</button>
          <button type="button" class="rules-icon-btn rules-icon-btn--danger" data-delete-entry="${entry.id}" title="Видалити">${ICON_TRASH}</button>
        </div>
        <div class="rules-tree-row rules-tree-row--when">
          ${renderWhenPills(entry.id, currentWhen, condition)}
          ${isSelected && contentCount ? `<button type="button" class="btn btn-sm btn-ghost" data-clear-entry="${entry.id}">Очистити</button>` : ""}
        </div>
        ${renderContentPreview(entry, "Оберіть Так/Ні і позначте текст у документі")}
      </li>`;
  }

  function renderGroupNode(entry, condition) {
    const isSelected = selectedEntryId === entry.id;
    const children = getChildren(entry.id).filter(isVariant);

    return `
      <li class="rules-tree-node rules-tree-node--group ${isSelected ? "is-selected" : ""}" data-entry-id="${entry.id}">
        <div class="rules-tree-row">
          <button type="button" class="rules-tree-select" data-select-entry="${entry.id}">
            <span class="rules-tree-kind">Група</span>
            <span class="rules-tree-label">${escapeHtml(truncate(entry.label, 64))}</span>
          </button>
          <span class="rules-tree-meta">${children.length} вар.</span>
          <button type="button" class="rules-icon-btn" data-scroll-block="${entry.header_block_id}" title="Показати в документі">↗</button>
          <button type="button" class="rules-icon-btn rules-icon-btn--danger" data-delete-entry="${entry.id}" title="Видалити">${ICON_TRASH}</button>
        </div>
        ${
          children.length
            ? `<ul class="rules-tree-children">${children.map((child) => renderGroupVariantNode(child, condition)).join("")}</ul>`
            : '<p class="rules-tree-empty-child">Оберіть групу і натисніть «+ Варіант».</p>'
        }
      </li>`;
  }

  function renderRootEntry(entry, condition) {
    if (isGroup(entry)) return renderGroupNode(entry, condition);
    if (isMarker(entry)) return renderMarkerNode(entry, condition);
    return "";
  }

  function renderRuleTree(rule) {
    const condition = findCondition(rule.condition_id);
    const roots = entriesForRule(rule.id).filter((entry) => !entry.parent_id);
    const selectedGroup = getSelectedGroupForRule(rule.id);
    const pendingHere = pendingAdd?.ruleId === rule.id;
    const pendingGroup = pendingHere && pendingAdd?.kind === KIND_SECTION;
    const pendingMarker = pendingHere && pendingAdd?.kind === KIND_OPTIONAL;
    const pendingVariant = pendingHere && pendingAdd?.kind === KIND_VARIANT;

    if (!condition) {
      return '<p class="rules-rule-empty">Спочатку оберіть умову для цього правила.</p>';
    }

    return `
      <div class="rules-tree-actions">
        <button type="button" class="btn btn-sm ${pendingGroup ? "is-active" : ""}" data-add-group="${rule.id}">+ Група</button>
        <button type="button" class="btn btn-sm ${pendingMarker ? "is-active" : ""}" data-add-marker="${rule.id}">+ Маркер</button>
        <button type="button" class="btn btn-sm ${pendingVariant ? "is-active" : ""}" data-add-variant="${rule.id}"
          ${selectedGroup ? "" : "disabled"} title="${selectedGroup ? "Додати варіант до обраної групи" : "Спочатку оберіть групу"}">+ Варіант</button>
      </div>
      ${
        roots.length
          ? `<ul class="rules-tree-root">${roots.map((entry) => renderRootEntry(entry, condition)).join("")}</ul>`
          : '<p class="rules-rule-empty">Додайте групу або маркер, потім клікніть абзац у документі.</p>'
      }`;
  }

  function renderRuleCard(rule, index) {
    const conditionOptions = (rules.conditions || [])
      .map(
        (item) =>
          `<option value="${item.id}" ${item.id === rule.condition_id ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
      )
      .join("");
    const isCollapsed = collapsedRules.has(rule.id);
    const configured = ruleIsConfigured(rule);

    return `
      <section class="rules-rule-card ${isCollapsed ? "is-collapsed" : ""} ${configured ? "is-configured" : ""}" data-rule-id="${rule.id}">
        <header class="rules-rule-head">
          <button type="button" class="rules-collapse-btn" data-toggle-rule="${rule.id}" aria-expanded="${!isCollapsed}">${CHEVRON}</button>
          <div class="rules-rule-head-main">
            <span class="rules-rule-title">Правило ${index + 1}</span>
            <label class="rules-condition-picker">
              <span class="rules-condition-picker-label">Умова</span>
              <select data-rule-condition="${rule.id}">
                <option value="">— оберіть умову —</option>
                ${conditionOptions}
              </select>
            </label>
          </div>
          <button type="button" class="rules-icon-btn rules-icon-btn--danger" data-delete-rule="${rule.id}" title="Видалити правило">${ICON_TRASH}</button>
        </header>
        <div class="rules-collapsible-body">
          <div class="rules-collapsible-inner">
            ${renderRuleTree(rule)}
          </div>
        </div>
      </section>`;
  }

  function renderConditionsPanel(container) {
    if (!container) return;

    const cards = (rules.conditions || [])
      .map((condition) => {
        const usage = (rules.rules || []).filter((rule) => rule.condition_id === condition.id).length;
        const canDelete = usage === 0;
        return `
          <article class="rules-condition-card" data-condition-id="${condition.id}">
            <div class="rules-condition-card-main">
              <h4 class="rules-condition-card-title">${escapeHtml(condition.label)}</h4>
              <p class="rules-condition-card-meta">${condition.type === "boolean" ? "Так / Ні" : "Вибір"} · ${usage} правил</p>
            </div>
            <div class="rules-condition-card-actions">
              <button type="button" class="rules-icon-btn" data-edit-condition="${condition.id}">${ICON_EDIT}</button>
              <button type="button" class="rules-icon-btn ${canDelete ? "" : "is-disabled"}"
                data-delete-condition="${condition.id}" ${canDelete ? "" : "disabled"}>${ICON_TRASH}</button>
            </div>
          </article>`;
      })
      .join("");

    container.innerHTML =
      cards || '<p class="rules-empty rules-empty--soft">Натисніть «+ Умова», щоб створити першу умову.</p>';
  }

  function getContextHint() {
    if (pendingAdd?.kind === KIND_SECTION) {
      return { text: "Клікніть підпункт у документі — це буде група", tone: "action" };
    }
    if (pendingAdd?.kind === KIND_OPTIONAL) {
      return { text: "Клікніть червоний заголовок — це буде маркер", tone: "action" };
    }
    if (pendingAdd?.kind === KIND_VARIANT) {
      return { text: "Клікніть назву варіанту в документі", tone: "action" };
    }

    const selected = findEntry(selectedEntryId);
    if (!selected) return null;

    if (isGroup(selected)) {
      const children = getChildren(selected.id).filter(isVariant);
      if (!children.length) {
        return {
          text: "Клікніть підпункт у документі, потім «+ Варіант» для кожного варіанту",
          tone: "neutral",
        };
      }
      return {
        text: "Оберіть варіант → позначте його наповнення → прив'яжіть Так/Ні",
        tone: "neutral",
      };
    }

    if (isMarker(selected)) {
      return {
        text: "Варіанти Так/Ні — сам текст абзаців є наповненням, окремо не позначайте",
        tone: "neutral",
      };
    }

    if (isGroupVariant(selected)) {
      const rule = findRule(selected.rule_id);
      const condition = rule ? findCondition(rule.condition_id) : null;
      if (whenToValue(selected.when, condition) === "") {
        return { text: "Оберіть Так або Ні для варіанту групи", tone: "warn" };
      }
      if (!(selected.content_block_ids || []).length) {
        return { text: "Позначте наповнення варіанту в документі", tone: "action" };
      }
      return null;
    }

    if (isMarkerVariant(selected)) {
      if (!(selected.content_block_ids || []).length) {
        return { text: `Позначте абзаци для «${selected.label}» у документі`, tone: "action" };
      }
      return null;
    }

    return null;
  }

  function renderModeBanner(container) {
    if (!container) return;
    const hint = getContextHint();
    if (!hint) {
      container.hidden = true;
      container.className = "rules-mode-banner";
      container.innerHTML = "";
      return;
    }
    container.hidden = false;
    container.className = `rules-mode-banner rules-mode-banner--${hint.tone}`;
    container.innerHTML = `<span class="rules-mode-banner-dot" aria-hidden="true"></span><span>${escapeHtml(hint.text)}</span>`;
  }

  function renderRulesPanel(container) {
    if (!container) return;
    if (!rules.rules?.length) {
      container.innerHTML =
        '<p class="rules-empty rules-empty--soft">Створіть хоча б одну умову, потім натисніть «+ Правило».</p>';
      return;
    }
    for (const rule of rules.rules || []) syncMarkerForks(rule);
    container.innerHTML = rules.rules.map((rule, index) => renderRuleCard(rule, index)).join("");
  }

  function createRule() {
    const defaultCondition = rules.conditions?.[0]?.id || "";
    const rule = { id: newId("rule"), condition_id: defaultCondition };
    rules.rules = [...(rules.rules || []), rule];
    collapsedRules.delete(rule.id);
    return rule;
  }

  function deleteRule(ruleId) {
    rules.rules = (rules.rules || []).filter((rule) => rule.id !== ruleId);
    rules.entries = (rules.entries || []).filter((entry) => entry.rule_id !== ruleId);
    collapsedRules.delete(ruleId);
    if (pendingAdd?.ruleId === ruleId) pendingAdd = null;
    if (selectedEntryId && !findEntry(selectedEntryId)) selectedEntryId = null;
  }

  function deleteEntry(entryId) {
    const removeIds = new Set([entryId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of rules.entries || []) {
        if (entry.parent_id && removeIds.has(entry.parent_id) && !removeIds.has(entry.id)) {
          removeIds.add(entry.id);
          changed = true;
        }
      }
    }
    rules.entries = (rules.entries || []).filter((entry) => !removeIds.has(entry.id));
    if (selectedEntryId && removeIds.has(selectedEntryId)) selectedEntryId = null;
  }

  function addEntryFromBlock(ruleId, kind, blockId, parentId = null) {
    if (getUsedHeaderBlockIds().has(blockId)) {
      onStatus("Цей абзац уже використовується як якір", true);
      return null;
    }
    const entry = {
      id: newId("entry"),
      rule_id: ruleId,
      header_block_id: blockId,
      label: blockLabelFromPreview(blockId),
      kind,
      parent_id: parentId,
      when: {},
      content_block_ids: [],
    };
    rules.entries = [...(rules.entries || []), entry];
    if (isMarker(entry)) ensureMarkerFork(entry);
    return entry;
  }

  function canAssignContent(entry) {
    return isGroupVariant(entry) || isMarkerVariant(entry);
  }

  function refreshHighlights() {
    const preview = getPreviewEl();
    if (!preview) return;

    preview.querySelectorAll("[data-block-id]").forEach((block) => {
      block.classList.remove(
        "docx-block--section",
        "docx-block--variant-active",
        "docx-block--variant-inactive",
        "docx-block--group-active",
        "docx-block--group-inactive",
        "docx-block--content-active",
        "docx-block--content-inactive",
        "docx-block--selected",
        "docx-block--pending",
      );
    });

    preview.classList.toggle("docx-structure-mode--adding", Boolean(pendingAdd));

    for (const rule of rules.rules || []) {
      if (!rule.condition_id) continue;
      const roots = entriesForRule(rule.id).filter((entry) => !entry.parent_id);
      if (!roots.every((entry) => entryIsConfigured(entry, rule.condition_id))) continue;
      highlightEntryTree(roots, rule.condition_id, preview);
    }

    const selected = findEntry(selectedEntryId);
    if (selected) {
      const blockIds = [
        ...(selected.header_block_id ? [selected.header_block_id] : []),
        ...(selected.content_block_ids || []),
      ];
      blockIds.forEach((blockId) => {
        const block = preview.querySelector(`[data-block-id="${blockId}"]`);
        if (block) block.classList.add("docx-block--selected");
      });
    }
  }

  function highlightEntryTree(entries, conditionId, preview) {
    const condition = findCondition(conditionId);
    for (const entry of entries) {
      const header = entry.header_block_id
        ? preview.querySelector(`[data-block-id="${entry.header_block_id}"]`)
        : null;
      if (header) {
        if (isGroup(entry)) header.classList.add("docx-block--section");
        else if (isMarker(entry)) header.classList.add("docx-block--group-active");
      }

      if (isGroupVariant(entry)) {
        const configured = whenToValue(entry.when, condition) !== "";
        const variantHeader = preview.querySelector(`[data-block-id="${entry.header_block_id}"]`);
        if (variantHeader) {
          variantHeader.classList.add(configured ? "docx-block--variant-active" : "docx-block--variant-inactive");
        }
      }

      const roleClass =
        entry.id === selectedEntryId ? "docx-block--content-active" : "docx-block--content-inactive";
      for (const blockId of entry.content_block_ids || []) {
        const block = preview.querySelector(`[data-block-id="${blockId}"]`);
        if (block) block.classList.add(roleClass);
      }

      highlightEntryTree(getChildren(entry.id), conditionId, preview);
    }
  }

  async function createCondition() {
    const created = await Dialogs.promptConditionCreate();
    if (!created) return null;
    rules.conditions = [...(rules.conditions || []), created];
    return created;
  }

  async function editCondition(conditionId) {
    const existing = findCondition(conditionId);
    if (!existing) return null;
    const updated = await Dialogs.promptConditionEdit(existing);
    if (!updated) return null;
    rules.conditions = (rules.conditions || []).map((item) =>
      item.id === conditionId ? updated : item,
    );
    return updated;
  }

  async function deleteCondition(conditionId) {
    const condition = findCondition(conditionId);
    if (!condition) return false;
    const usage = (rules.rules || []).filter((rule) => rule.condition_id === conditionId).length;
    if (usage > 0) {
      onStatus(`Умова використовується в ${usage} правилі(лах)`, true);
      return false;
    }
    const confirmed = await Dialogs.confirm({
      title: "Видалити умову?",
      message: `«${condition.label}» буде прибрано.`,
      confirmText: "Видалити",
      cancelText: "Скасувати",
      variant: "danger",
    });
    if (!confirmed) return false;
    rules.conditions = (rules.conditions || []).filter((item) => item.id !== conditionId);
    return true;
  }

  function bindDocumentClicks(preview) {
    if (!preview || documentClicksBound) return;
    documentClicksBound = true;

    preview.addEventListener("click", (event) => {
      const block = event.target.closest("[data-block-id]");
      if (!block) return;
      const blockId = block.dataset.blockId;

      if (pendingAdd) {
        event.preventDefault();
        event.stopPropagation();
        const entry = addEntryFromBlock(
          pendingAdd.ruleId,
          pendingAdd.kind,
          blockId,
          pendingAdd.parentId || null,
        );
        if (!entry) return;
        pendingAdd = null;
        selectedEntryId = isMarker(entry) ? ensureMarkerFork(entry).yes?.id || entry.id : entry.id;
        renderAll();
        onRulesChange();
        if (isGroup(entry)) onStatus(`Групу «${truncate(entry.label, 40)}» додано`);
        else if (isMarker(entry)) onStatus(`Маркер додано — оберіть «Так» або «Ні» і позначте текст`);
        else onStatus(`Варіант «${truncate(entry.label, 40)}» додано — оберіть Так/Ні`);
        return;
      }

      if (!selectedEntryId) return;
      const entry = findEntry(selectedEntryId);
      if (!entry || !canAssignContent(entry)) return;

      event.preventDefault();
      event.stopPropagation();

      if (blockId === entry.header_block_id) return;
      if (getUsedHeaderBlockIds(selectedEntryId).has(blockId)) {
        onStatus("Цей абзац уже є якорем іншого пункту", true);
        return;
      }

      const ids = entry.content_block_ids || [];
      const index = ids.indexOf(blockId);
      if (index >= 0) ids.splice(index, 1);
      else {
        if (getAllAssignedContentIds(selectedEntryId).has(blockId)) {
          onStatus("Цей абзац уже в іншому варіанті", true);
          return;
        }
        if (isMarkerVariant(entry) && getSiblingForkContentIds(entry).has(blockId)) {
          onStatus("Цей абзац уже в іншому варіанті маркера (Так/Ні)", true);
          return;
        }
        ids.push(blockId);
      }
      entry.content_block_ids = ids;
      renderAll();
      onStatus(`${ids.length} абз. у «${entry.label}»`);
    });
  }

  function bindRulesTreeEvents(container) {
    if (!container || editorEventsBound) return;
    editorEventsBound = true;

    container.addEventListener("click", async (event) => {
      const toggleRule = event.target.closest("[data-toggle-rule]");
      if (toggleRule) {
        const id = toggleRule.dataset.toggleRule;
        if (collapsedRules.has(id)) collapsedRules.delete(id);
        else collapsedRules.add(id);
        renderAll();
        return;
      }

      const toggleContent = event.target.closest("[data-toggle-content]");
      if (toggleContent) {
        event.stopPropagation();
        const entryId = toggleContent.dataset.toggleContent;
        if (expandedContentIds.has(entryId)) expandedContentIds.delete(entryId);
        else expandedContentIds.add(entryId);
        renderAll();
        return;
      }

      const selectEntry = event.target.closest("[data-select-entry]");
      if (selectEntry) {
        event.stopPropagation();
        pendingAdd = null;
        selectedEntryId = selectEntry.dataset.selectEntry || null;
        renderAll();
        const entry = findEntry(selectedEntryId);
        if (entry && isGroup(entry)) onStatus("Група обрана — можна додавати варіанти");
        else if (entry && isMarkerVariant(entry)) onStatus(`Обрано «${entry.label}» — клікайте абзаци в документі`);
        else if (entry && isGroupVariant(entry)) onStatus("Варіант групи — оберіть Так/Ні і текст");
        return;
      }

      const addGroup = event.target.closest("[data-add-group]");
      if (addGroup) {
        pendingAdd = { ruleId: addGroup.dataset.addGroup, kind: KIND_SECTION, parentId: null };
        selectedEntryId = null;
        renderAll();
        onStatus("Клікніть абзац у документі — якір групи");
        return;
      }

      const addMarker = event.target.closest("[data-add-marker]");
      if (addMarker) {
        pendingAdd = { ruleId: addMarker.dataset.addMarker, kind: KIND_OPTIONAL, parentId: null };
        selectedEntryId = null;
        renderAll();
        onStatus("Клікніть червоний абзац-умову в документі");
        return;
      }

      const addVariant = event.target.closest("[data-add-variant]");
      if (addVariant && !addVariant.disabled) {
        const ruleId = addVariant.dataset.addVariant;
        const group = getSelectedGroupForRule(ruleId);
        if (!group) {
          onStatus("Спочатку оберіть групу", true);
          return;
        }
        pendingAdd = { ruleId, kind: KIND_VARIANT, parentId: group.id };
        selectedEntryId = null;
        renderAll();
        onStatus("Клікніть абзац — заголовок варіанту");
        return;
      }

      const deleteRuleBtn = event.target.closest("[data-delete-rule]");
      if (deleteRuleBtn) {
        const confirmed = await Dialogs.confirm({
          title: "Видалити правило?",
          message: "Усі групи та маркери будуть прибрані.",
          confirmText: "Видалити",
          cancelText: "Скасувати",
          variant: "danger",
        });
        if (!confirmed) return;
        deleteRule(deleteRuleBtn.dataset.deleteRule);
        renderAll();
        return;
      }

      const deleteEntryBtn = event.target.closest("[data-delete-entry]");
      if (deleteEntryBtn) {
        event.stopPropagation();
        const entry = findEntry(deleteEntryBtn.dataset.deleteEntry);
        if (!entry || isMarkerVariant(entry)) return;
        const confirmed = await Dialogs.confirm({
          title: "Видалити?",
          message: `«${truncate(entry.label, 60)}» буде прибрано.`,
          confirmText: "Видалити",
          cancelText: "Скасувати",
          variant: "danger",
        });
        if (!confirmed) return;
        deleteEntry(entry.id);
        renderAll();
        return;
      }

      const scrollBlock = event.target.closest("[data-scroll-block]");
      if (scrollBlock) {
        event.stopPropagation();
        scrollToBlock(scrollBlock.dataset.scrollBlock);
        return;
      }

      const editConditionBtn = event.target.closest("[data-edit-condition]");
      if (editConditionBtn) {
        const updated = await editCondition(editConditionBtn.dataset.editCondition);
        if (!updated) return;
        renderAll();
        onStatus("Умову оновлено");
        return;
      }

      const deleteConditionBtn = event.target.closest("[data-delete-condition]");
      if (deleteConditionBtn) {
        if (deleteConditionBtn.disabled) return;
        if (await deleteCondition(deleteConditionBtn.dataset.deleteCondition)) {
          renderAll();
          onStatus("Умову видалено");
        }
        return;
      }

      const clearEntry = event.target.closest("[data-clear-entry]");
      if (clearEntry) {
        const entry = findEntry(clearEntry.dataset.clearEntry);
        if (!entry) return;
        entry.content_block_ids = [];
        renderAll();
      }
    });

    container.addEventListener("change", (event) => {
      const ruleCondition = event.target.closest("[data-rule-condition]");
      if (ruleCondition) {
        const rule = findRule(ruleCondition.dataset.ruleCondition);
        if (!rule) return;
        rule.condition_id = ruleCondition.value;
        syncMarkerForks(rule);
        renderAll();
        return;
      }

      const entryWhen = event.target.closest("[data-entry-when]");
      if (entryWhen?.checked) {
        const entry = findEntry(entryWhen.dataset.entryWhen);
        const rule = entry ? findRule(entry.rule_id) : null;
        const condition = rule ? findCondition(rule.condition_id) : null;
        if (!entry || !condition || !isGroupVariant(entry)) return;
        entry.when = valueToWhen(entryWhen.value, condition, entry.when);
        selectedEntryId = entry.id;
        renderAll();
        onStatus("Тепер позначте наповнення варіанту в документі");
      }
    });
  }

  async function addConditionAsync() {
    if (!conditionsEl) {
      onStatus("Редактор правил ще завантажується", true);
      return null;
    }
    const created = await createCondition();
    if (!created) return null;
    renderAll();
    onStatus(`Умову «${created.label}» створено`);
    return created;
  }

  async function addRuleAsync() {
    if (!rulesTreeEl) {
      onStatus("Редактор правил ще завантажується", true);
      return null;
    }
    if (!rules.conditions?.length) {
      onStatus("Створіть хоча б одну умову", true);
      return null;
    }
    const rule = createRule();
    renderAll();
    onStatus("Правило створено — додайте групу або маркер");
    return rule;
  }

  function renderAll() {
    renderConditionsPanel(conditionsEl);
    renderModeBanner(modeBannerEl);
    renderRulesPanel(rulesTreeEl);
    refreshHighlights();
    onRulesChange();
  }

  return {
    init({
      previewEl,
      conditionsEl: condEl,
      rulesTreeEl: treeEl,
      modeBannerEl: bannerEl,
      rulesEditorEl: editorEl,
      statusFn,
      onRulesChange: changeFn,
    }) {
      getPreviewEl = () => previewEl;
      conditionsEl = condEl;
      rulesTreeEl = treeEl;
      modeBannerEl = bannerEl;
      rulesEditorEl = editorEl;
      onStatus = statusFn || (() => {});
      onRulesChange = changeFn || (() => {});
      bindDocumentClicks(previewEl);
      bindRulesTreeEvents(editorEl);
    },

    setRules(nextRules) {
      rules = ensureRulesShape(nextRules);
      selectedEntryId = null;
      pendingAdd = null;
      collapsedRules = new Set();
      expandedContentIds = new Set();
      for (const rule of rules.rules || []) {
        cleanupLegacyRuleEntries(rule);
        syncMarkerForks(rule);
      }
    },

    getRules() {
      return rules;
    },

    hasConfiguredRules() {
      return (rules.rules || []).some((rule) => ruleIsConfigured(rule));
    },

    getActiveConditionIds() {
      return [
        ...new Set(
          (rules.rules || [])
            .filter((rule) => rule.condition_id && entriesForRule(rule.id).length > 0)
            .map((rule) => rule.condition_id),
        ),
      ];
    },

    render() {
      renderAll();
    },

    addRule() {
      return addRuleAsync();
    },

    addRuleAsync,
    addConditionAsync,
    refreshHighlights,
  };
})();
