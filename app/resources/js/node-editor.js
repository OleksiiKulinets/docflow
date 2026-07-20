/** v5 node tree + fields + block picker + preview integration (UI-3A). */

const NodeEditor = (() => {
  let model = NodeModel.emptyModel();
  let selectedNodeId = null;
  let selectedBlockId = null;
  let assignMode = false;
  let collapsedIds = new Set();

  let treeEl = null;
  let variantsEl = null;
  let inspectorEl = null;
  let fieldsEl = null;
  let shellEl = null;
  let getPreviewEl = () => null;
  let getIsActive = () => true;
  let onStatus = () => {};
  let onModelChange = () => {};
  let eventsBound = false;
  let previewClickBound = false;
  let treeDragBound = false;
  let dragNodeId = null;
  let activeDropTarget = null;
  let dragPointerActive = false;
  let inspectorTab = "general";

  let preferredFieldId = null;
  let templateGuideSectionId = null;
  let activeRulesPage = "structure";

  const RULES_PAGES = ["structure", "fields", "editor"];

  const UK = () => (typeof NodeUiUk !== "undefined" ? NodeUiUk : null);

  const INSPECTOR_TAB_IDS = ["general", "conditions", "behavior", "content"];

  function nodeTypeLabel(type) {
    return UK()?.typeLabel(type) || type || "вузол";
  }

  function nodeTypeIcon(type) {
    const icons = {
      section: "§",
      paragraph: "¶",
      table: "⊞",
      marker: "⚑",
      text: "T",
      placeholder: "…",
    };
    return icons[type] || "•";
  }

  function uk(key) {
    return UK()?.strings?.[key] || key;
  }

  function renderContextHelpCallout(node) {
    const help = UK()?.contextHelp(node, model) || UK()?.workflowGuide(model);
    if (!help) return "";
    return `
      <aside class="node-context-help" role="note">
        <strong class="node-context-help-title">${escapeHtml(help.title)}</strong>
        <p class="node-context-help-body">${escapeHtml(help.body)}</p>
      </aside>`;
  }

  function renderWorkflowHelpPanel() {
    if (!workflowHelpEl) return;
    const help = UK()?.workflowGuide(model);
    if (!help) return;
    const steps = help.steps || [help.body];
    workflowHelpEl.innerHTML = `<ol class="node-workflow-steps">${steps
      .map((step) => `<li>${escapeHtml(step)}</li>`)
      .join("")}</ol>`;
  }

  function syncAddNodeHints() {
    document.querySelectorAll("[data-add-node-hint-for]").forEach((select) => {
      const hintEl = document.getElementById(select.dataset.addNodeHintFor);
      updateAddNodeHint(select, hintEl);
    });

    document.querySelectorAll("[data-add-node-select]").forEach((select) => {
      if (select.dataset.addNodeHintFor) return;
      const picker = select.closest(".node-add-picker");
      const hintEl = picker?.querySelector(".node-add-hint");
      updateAddNodeHint(select, hintEl);
    });
  }

  function applySimpleCondition(nodeId) {
    if (!inspectorEl || !nodeId) return;
    const fieldSelect = inspectorEl.querySelector(`[data-simple-condition-field="${CSS.escape(nodeId)}"]`);
    const valueSelect = inspectorEl.querySelector(`[data-simple-condition-value="${CSS.escape(nodeId)}"]`);
    if (!fieldSelect || !valueSelect) return;

    const fieldDef = (model.fields || []).find((f) => f.id === fieldSelect.value);
    let value = valueSelect.value;
    if (fieldDef?.type === "boolean") {
      value = value === "true";
    }

    NodeModel.updateNodeProperty(model, nodeId, "condition", {
      type: "predicate",
      condition_id: fieldSelect.value,
      operator: "eq",
      value,
    });
    notifyChange();
  }

  function inspectorTabs() {
    const tabMeta = UK()?.tabs || {};
    return INSPECTOR_TAB_IDS.map((id) => ({
      id,
      label: tabMeta[id]?.label || id,
      tip: tabMeta[id]?.tip || "",
    }));
  }

  function formatReparentLabel(label) {
    if (label === "(root level)") return uk("rootLevel");
    return label;
  }

  function isVariantForkNode(node) {
    if (!node || node.type !== "section" || node.condition) return false;
    if (!NodeModel.isExclusiveSection(node)) return false;
    return NodeModel.orderedChildren(model, node.id).some((child) => child.type === "section" && child.condition);
  }

  function isMarkerForkNode(node) {
    if (!node || node.type !== "marker") return false;
    return NodeModel.orderedChildren(model, node.id).some((child) => child.type === "section" && child.condition);
  }

  function findVariantFork(sectionNode) {
    if (!sectionNode) return null;
    if (sectionNode.type === "marker") {
      return isMarkerForkNode(sectionNode) ? sectionNode : null;
    }
    if (sectionNode.type !== "section") return null;
    if (isVariantForkNode(sectionNode)) return sectionNode;
    for (const child of NodeModel.orderedChildren(model, sectionNode.id)) {
      if (isVariantForkNode(child)) return child;
    }
    return null;
  }

  function isVariantBranch(node) {
    return node?.type === "section" && Boolean(node.condition);
  }

  function getBranchTone(branch) {
    const cond = branch?.condition;
    if (cond?.type !== "predicate") return "choice";
    if (cond.value === true) return "yes";
    if (cond.value === false) return "no";
    return "choice";
  }

  function branchBadgeLabel(branch) {
    const custom = String(branch?.metadata?.label || "").trim();
    if (custom) return custom;
    const tone = getBranchTone(branch);
    if (tone === "yes") return uk("branchYes");
    if (tone === "no") return uk("branchNo");
    return uk("branchOption");
  }

  function getImmediateParentNode(node) {
    if (!node?.parent_id) return null;
    let parent = NodeModel.getNode(model, node.parent_id);
    if (!parent) return null;
    if (isVariantForkNode(parent) && parent.parent_id) {
      parent = NodeModel.getNode(model, parent.parent_id);
    }
    return parent || null;
  }

  function getNodeAncestorPath(node) {
    if (!node) return [];
    const path = [];
    let cursor = node;
    while (cursor) {
      if (isVariantForkNode(cursor)) {
        cursor = cursor.parent_id ? NodeModel.getNode(model, cursor.parent_id) : null;
        continue;
      }
      if (cursor.type === "section" || cursor.type === "marker") {
        path.unshift(cursor);
      }
      cursor = cursor.parent_id ? NodeModel.getNode(model, cursor.parent_id) : null;
    }
    return path;
  }

  function formatTreeNodeMeta(node) {
    if (isVariantBranch(node)) {
      const detail = formatConditionDetail(node);
      if (detail?.field) {
        return `${detail.field} ${uk("conditionEquals")} ${detail.valueHuman}`;
      }
      return "";
    }
    if (NodeModel.supportsBlockContent(node)) {
      const blockCount = NodeModel.getBlockIds(node).length;
      return blockCount ? `${blockCount} ${uk("blocksCount")}` : uk("variantNoText");
    }
    return "";
  }

  function getEditorBreadcrumbPath(node) {
    if (!node) return [];
    const resolved = resolveInspectorNode(node) || node;
    const path = getNodeAncestorPath(resolved);
    if (resolved.id && !path.some((item) => item.id === resolved.id)) {
      if (resolved.type === "paragraph" || resolved.type === "table") {
        path.push(resolved);
      }
    }
    return path;
  }

  function renderInspectorLocationBar(node) {
    const resolved = resolveInspectorNode(node) || node;
    const path = getEditorBreadcrumbPath(node);
    const detail = isVariantBranch(resolved) ? formatConditionDetail(resolved) : null;
    const sep = '<span class="node-location-sep" aria-hidden="true">›</span>';
    const parts = [
      `<button type="button" class="node-location-crumb" data-back-structure title="${escapeHtml(uk("pageNavStructure"))}">${escapeHtml(uk("pageNavStructure"))}</button>`,
    ];

    path.forEach((item, index) => {
      const isLast = index === path.length - 1;
      const name = NodeModel.nodeLabel(item);
      if (isLast) {
        parts.push(
          `<span class="node-location-crumb node-location-crumb--current" aria-current="location">${escapeHtml(name)}</span>`,
        );
        return;
      }
      parts.push(
        `<button type="button" class="node-location-crumb" data-select-node="${escapeHtml(item.id)}" title="${escapeHtml(nodeTypeLabel(item.type))}">${escapeHtml(name)}</button>`,
      );
    });

    return `
      <div class="node-inspector-location-path">${parts.join(sep)}</div>
      ${
        detail?.field
          ? `<p class="node-inspector-active-condition">${escapeHtml(detail.field)} ${uk("conditionEquals")} <strong>${escapeHtml(detail.valueHuman)}</strong></p>`
          : ""
      }`;
  }

  function getForkFieldForBranches(forkId) {
    const branches = NodeModel.orderedChildren(model, forkId).filter(isVariantBranch);
    const fieldId = branches[0]?.condition?.condition_id;
    return fieldId ? NodeModel.getField(model, fieldId) : null;
  }

  function renderAddChoiceBranchAction(containerNode) {
    const fork = findVariantFork(containerNode);
    if (!fork) return "";
    const field = getForkFieldForBranches(fork.id);
    if (!field || field.type !== "choice") return "";

    const branches = NodeModel.orderedChildren(model, fork.id).filter(isVariantBranch);
    const used = new Set(
      branches.map((branch) => String(branch.condition?.value ?? "")),
    );
    const remaining = (field.options || []).filter((opt) => !used.has(String(opt.value)));
    if (!remaining.length) {
      return `<p class="node-inspector-hint">${uk("allChoiceBranchesAdded")}</p>`;
    }

    return `
      <button type="button" class="btn btn-sm btn-accent node-add-choice-branch" data-add-choice-branch-to="${escapeHtml(fork.id)}" title="${uk("addChoiceBranchTip")}">
        ${uk("addChoiceBranch")}
      </button>`;
  }

  function collectNodeBlockIds(nodeId) {
    const node = NodeModel.getNode(model, nodeId);
    if (!node) return [];
    const ids = [];
    function walk(current) {
      ids.push(...NodeModel.getBlockIds(current));
      NodeModel.orderedChildren(model, current.id).forEach(walk);
    }
    walk(node);
    return [...new Set(ids)];
  }

  function countBranchBlocks(branchId) {
    return collectNodeBlockIds(branchId).length;
  }

  function getForkForBranch(branch) {
    if (!branch?.parent_id) return null;
    const parent = NodeModel.getNode(model, branch.parent_id);
    return isVariantForkNode(parent) ? parent : null;
  }

  function getHostSectionForNode(node) {
    if (!node) return null;
    if (isVariantBranch(node)) {
      const fork = getForkForBranch(node);
      return fork?.parent_id ? NodeModel.getNode(model, fork.parent_id) : null;
    }
    if (isVariantForkNode(node)) {
      return node.parent_id ? NodeModel.getNode(model, node.parent_id) : null;
    }
    if (node.type === "section" && !node.condition) return node;
    return null;
  }

  function resolveInspectorNode(node) {
    if (!node) return null;
    if ((node.type === "paragraph" || node.type === "table") && node.parent_id) {
      const parent = NodeModel.getNode(model, node.parent_id);
      if (parent && isVariantBranch(parent)) return parent;
    }
    return node;
  }

  function formatConditionDetail(node) {
    const cond = node?.condition;
    if (!cond) return null;
    if (cond.type !== "predicate") {
      return { summary: conditionSummary(cond), field: null, valueHuman: null };
    }
    const field = NodeModel.getField(model, cond.condition_id);
    const fieldLabel = field?.label || cond.condition_id || "умова";
    let valueHuman = String(cond.value ?? "");
    if (cond.value === true) valueHuman = uk("conditionTrueHint");
    if (cond.value === false) valueHuman = uk("conditionFalseHint");
    if (field?.type === "choice") {
      const opt = (field.options || []).find((o) => String(o.value) === String(cond.value));
      if (opt?.label) valueHuman = opt.label;
    }
    return {
      summary: conditionSummary(cond),
      field: fieldLabel,
      valueHuman,
      rawValue: cond.value,
    };
  }

  function getVariantContentNode(branchId) {
    return getFirstParagraphUnder(branchId);
  }

  function renderZoneEmpty(title, sub = "", actionHtml = "") {
    return `
      <div class="node-zone-empty">
        <p class="node-zone-empty-title">${escapeHtml(title)}</p>
        ${sub ? `<p class="node-zone-empty-sub">${escapeHtml(sub)}</p>` : ""}
        ${actionHtml}
      </div>`;
  }

  function getVariantsContextNode(node) {
    if (!node) return null;
    if (isVariantBranch(node)) return getImmediateParentNode(node);
    if ((node.type === "section" && !node.condition) || node.type === "marker") return node;
    return null;
  }

  function navigateToPage(pageId, options = {}) {
    if (!RULES_PAGES.includes(pageId)) return;
    activeRulesPage = pageId;
    syncPageNav(options);
  }

  function getEditorPageMeta(node) {
    if (!node) return { typeLabel: uk("inspectorEmptyTitle"), title: "—" };
    const resolved = resolveInspectorNode(node) || node;
    if (isVariantBranch(resolved)) {
      const detail = formatConditionDetail(resolved);
      const tone = getBranchTone(resolved);
      const toneLabel =
        tone === "yes" ? uk("branchYes") : tone === "no" ? uk("branchNo") : uk("branchOption");
      return {
        typeLabel: uk("inspectorVariantType"),
        title: NodeModel.nodeLabel(resolved),
        meta: detail?.valueHuman || toneLabel,
      };
    }
    if (resolved.type === "section") {
      return { typeLabel: uk("inspectorSectionType"), title: NodeModel.nodeLabel(resolved) };
    }
    if (resolved.type === "marker") {
      return { typeLabel: nodeTypeLabel("marker"), title: NodeModel.nodeLabel(resolved) };
    }
    return { typeLabel: nodeTypeLabel(resolved.type), title: NodeModel.nodeLabel(resolved) };
  }

  function syncPageNav(options = {}) {
    if (!shellEl) return;

    if (activeRulesPage === "editor" && !selectedNodeId) {
      activeRulesPage = "structure";
    }

    const pages = shellEl.querySelectorAll(".rules-page");
    const tabs = shellEl.querySelectorAll("[data-rules-page]");
    const subnav = shellEl.querySelector("#rules-subnav");
    const editorLabel = shellEl.querySelector("#rules-panel-editor-label");
    const addSectionBtn = shellEl.querySelector("#node-add-node-btn");
    const addConditionBtn = shellEl.querySelector("#add-condition-btn");
    const rawNode = selectedNodeId ? NodeModel.getNode(model, selectedNodeId) : null;
    const hasSelection = Boolean(rawNode);
    const showEditor = activeRulesPage === "editor" && hasSelection;

    if (subnav) {
      subnav.hidden = showEditor;
    }

    if (editorLabel) {
      editorLabel.hidden = !showEditor;
    }

    const backBtn = document.getElementById("rules-panel-back");
    if (backBtn) {
      backBtn.hidden = !showEditor;
    }

    if (addSectionBtn) {
      addSectionBtn.hidden = showEditor || activeRulesPage !== "structure";
    }
    if (addConditionBtn) {
      addConditionBtn.hidden = showEditor || activeRulesPage !== "fields";
    }

    pages.forEach((page) => {
      const isActive = page.dataset.rulesPage === activeRulesPage && (page.dataset.rulesPage !== "editor" || hasSelection);
      page.classList.toggle("is-active", isActive);
      page.hidden = !isActive;
      page.setAttribute("aria-hidden", isActive ? "false" : "true");
    });

    tabs.forEach((tab) => {
      if (tab.classList.contains("rules-page-back") || tab.classList.contains("rules-editor-back")) return;
      const pageId = tab.dataset.rulesPage;
      if (pageId === "editor") return;
      const isActive = pageId === activeRulesPage;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    if (hasSelection && showEditor) {
      const meta = getEditorPageMeta(rawNode);
      const pageType = shellEl.querySelector("#rules-editor-page-type");
      const pageTitle = shellEl.querySelector("#rules-editor-page-title");
      if (pageType) pageType.textContent = meta.typeLabel;
      if (pageTitle) pageTitle.textContent = meta.title;
    }

    if (showEditor && !options.skipEditorScroll) {
      shellEl.querySelector(".rules-page-body--editor")?.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  function openFieldsPage() {
    navigateToPage("fields");
  }

  function renderEditorContextStrip() {
    if (!variantsEl) return;
    const rawNode = selectedNodeId ? NodeModel.getNode(model, selectedNodeId) : null;
    const node = rawNode ? resolveInspectorNode(rawNode) || rawNode : null;

    if (!node || activeRulesPage !== "editor") {
      variantsEl.innerHTML = "";
      variantsEl.hidden = true;
      return;
    }

    let hostSection = null;
    let branches = [];

    if (isVariantBranch(node)) {
      const nestedFork = findVariantFork(node);
      if (nestedFork) {
        hostSection = node;
        branches = NodeModel.orderedChildren(model, nestedFork.id).filter(isVariantBranch);
      } else {
        const parent = getImmediateParentNode(node);
        const fork = parent ? findVariantFork(parent) || (isVariantForkNode(parent) ? parent : null) : null;
        if (fork) {
          hostSection = getHostSectionForNode(node);
          branches = NodeModel.orderedChildren(model, fork.id).filter(isVariantBranch);
        }
      }
    } else if ((node.type === "section" && !node.condition) || node.type === "marker") {
      hostSection = node;
      const fork = findVariantFork(node);
      if (fork) {
        branches = NodeModel.orderedChildren(model, fork.id).filter(isVariantBranch);
      } else {
        variantsEl.hidden = false;
        variantsEl.innerHTML = `
          <div class="rules-variant-setup">
            <p class="rules-variant-setup-label">${uk("variantsTitle")}</p>
            ${renderNestedVariantsBlock(node)}
          </div>`;
        syncAddNodeHints();
        return;
      }
    }

    if (!branches.length) {
      variantsEl.innerHTML = "";
      variantsEl.hidden = true;
      return;
    }

    variantsEl.hidden = false;
    variantsEl.innerHTML = `
      <nav class="rules-context-tabs" aria-label="${escapeHtml(uk("variantGroupLabel"))}">
        ${branches
          .map((branch) => {
            const detail = formatConditionDetail(branch);
            const tone = getBranchTone(branch);
            const active = selectedNodeId === branch.id;
            return `
              <button type="button"
                class="rules-context-tab rules-context-tab--${tone} ${active ? "is-active" : ""}"
                data-select-node="${escapeHtml(branch.id)}">
                <span class="rules-context-tab-label">${escapeHtml(NodeModel.nodeLabel(branch))}</span>
                ${
                  detail?.valueHuman
                    ? `<span class="rules-context-tab-meta">${escapeHtml(detail.valueHuman)}</span>`
                    : ""
                }
              </button>`;
          })
          .join("")}
        ${hostSection ? renderAddChoiceBranchAction(hostSection) : ""}
      </nav>`;
    syncAddNodeHints();
  }

  function renderEmptyState(message, hint = "", actionHtml = "") {
    return `
      <div class="node-empty-state">
        <p class="node-empty-state-msg">${escapeHtml(message)}</p>
        ${hint ? `<p class="node-empty-state-hint">${escapeHtml(hint)}</p>` : ""}
        ${actionHtml}
      </div>`;
  }

  function renderInspectorCard(title, body, extraClass = "") {
    const trimmed = (body || "").trim();
    if (!trimmed) return "";
    return `
      <section class="node-inspector-card ${extraClass}">
        <header class="node-inspector-card-head">
          <h3 class="node-inspector-card-title">${escapeHtml(title)}</h3>
        </header>
        <div class="node-inspector-card-body">${body}</div>
      </section>`;
  }

  function renderEditorBreadcrumb(node) {
    const host = shellEl?.querySelector("#rules-editor-breadcrumb");
    if (!host) return;
    if (!node || activeRulesPage !== "editor") {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    host.hidden = false;
    host.innerHTML = renderInspectorLocationBar(node);
  }

  function renderInspectorMetaPanel(node) {
    const isBranch = isVariantBranch(node);
    const immediateParent = getImmediateParentNode(node);
    const hostSection = getHostSectionForNode(node);
    const fork = isBranch ? getForkForBranch(node) : findVariantFork(node) || (isVariantForkNode(node) ? node : null);
    let typeLabel = nodeTypeLabel(node.type);
    if (isBranch) typeLabel = uk("inspectorVariantType");
    else if (node.type === "section") typeLabel = uk("inspectorSectionType");
    else if (node.type === "paragraph") typeLabel = uk("inspectorParagraphType");

    return `
      <dl class="node-inspector-meta-panel">
        <div class="node-inspector-meta-row">
          <dt>${uk("inspectorNodeType")}</dt>
          <dd>${escapeHtml(typeLabel)}</dd>
        </div>
        ${
          immediateParent && immediateParent.id !== node.id
            ? `<div class="node-inspector-meta-row">
                <dt>${uk("inspectorImmediateParent")}</dt>
                <dd>${escapeHtml(NodeModel.nodeLabel(immediateParent))}</dd>
              </div>`
            : ""
        }
        ${
          hostSection &&
          hostSection.id !== node.id &&
          hostSection.id !== immediateParent?.id
            ? `<div class="node-inspector-meta-row">
                <dt>${uk("inspectorParentGroup")}</dt>
                <dd>${escapeHtml(NodeModel.nodeLabel(hostSection))}</dd>
              </div>`
            : ""
        }
        ${
          fork && !isBranch && node.type !== "marker"
            ? `<div class="node-inspector-meta-row">
                <dt>${uk("inspectorExclusiveGroup")}</dt>
                <dd>${escapeHtml(NodeModel.nodeLabel(fork))}</dd>
              </div>`
            : ""
        }
      </dl>`;
  }

  function renderExclusiveStructureView(sectionNode) {
    const fork = findVariantFork(sectionNode);
    if (!fork) return "";
    const branches = NodeModel.orderedChildren(model, fork.id).filter(isVariantBranch);
    const field = branches[0] ? formatConditionDetail(branches[0]) : null;

    return `
      <section class="node-exclusive-structure">
        <h4 class="node-exclusive-structure-heading">${uk("structureTreeTitle")}</h4>
        <p class="node-exclusive-structure-section-name">${escapeHtml(NodeModel.nodeLabel(sectionNode))}</p>
        <ul class="node-exclusive-structure-tree">
          ${branches
            .map((branch) => {
              const detail = formatConditionDetail(branch);
              const blocks = countBranchBlocks(branch.id);
              const tone = getBranchTone(branch);
              const selected = selectedNodeId === branch.id;
              return `
                <li class="node-exclusive-structure-item node-exclusive-structure-item--${tone} ${selected ? "is-selected" : ""}">
                  <button type="button" class="node-exclusive-structure-row" data-select-node="${escapeHtml(branch.id)}">
                    <span class="node-exclusive-structure-label">Варіант: <strong>${escapeHtml(NodeModel.nodeLabel(branch))}</strong></span>
                    <span class="node-exclusive-structure-condition">
                      ${
                        detail?.field
                          ? `Умова: ${escapeHtml(detail.field)} ${uk("conditionEquals")} ${escapeHtml(detail.valueHuman)}`
                          : uk("emptyNoCondition")
                      }
                    </span>
                    <span class="node-exclusive-structure-content">
                      ${uk("contentBlocksLabel")}: ${blocks ? `${blocks}` : uk("emptyNoContent")}
                    </span>
                  </button>
                </li>`;
            })
            .join("")}
        </ul>
        ${field?.field ? `<p class="node-exclusive-structure-foot">Умова документа: «${escapeHtml(field.field)}»</p>` : ""}
        ${renderAddChoiceBranchAction(sectionNode)}
      </section>`;
  }

  function renderTemplateGuide(sectionId) {
    if (templateGuideSectionId !== sectionId) return "";
    return `
      <aside class="node-template-guide">
        <h4 class="node-template-guide-title">${uk("templateGuideTitle")}</h4>
        <ol class="node-template-guide-steps">
          <li>${uk("templateGuide1")}</li>
          <li>${uk("templateGuide2")}</li>
          <li>${uk("templateGuide3")}</li>
        </ol>
        <button type="button" class="btn btn-sm" data-dismiss-template-guide>${uk("templateGuideDismiss")}</button>
      </aside>`;
  }

  function renderVariantContentBody(branch) {
    const contentNode = getVariantContentNode(branch.id);
    const blocks = countBranchBlocks(branch.id);

    if (!blocks) {
      return renderEmptyState(
        uk("emptyNoContent"),
        uk("emptyAddDocBlockHint"),
        `<button type="button" class="btn btn-sm btn-accent" data-branch-bind-content="${escapeHtml(branch.id)}">${uk("addFromDoc")}</button>`,
      );
    }

    const target = contentNode || getOrCreateBranchParagraph(branch.id);
    return renderBlockPicker(target);
  }

  function renderVariantContentSection(branch) {
    return renderVariantContentBody(branch);
  }

  function renderVariantInspector(branch) {
    const detail = formatConditionDetail(branch);
    const previewHint = findVariantFork(branch) ? renderPreviewReadinessHint(branch) : "";

    const propertiesBody = `
      ${renderInspectorMetaPanel(branch)}
      <label class="node-field">
        <span class="node-field-label">${uk("variantLabelField")}</span>
        <input type="text" class="node-input" data-node-prop="metadata.label" value="${escapeHtml(branch.metadata?.label || "")}" placeholder="Так / Ні / Варіант А">
      </label>
      <div class="node-inspector-subsection">
        ${
          detail?.field
            ? `<p class="node-condition-readable">${escapeHtml(detail.field)} ${uk("conditionEquals")} <strong>${escapeHtml(detail.valueHuman)}</strong></p>`
            : renderEmptyState(uk("emptyNoCondition"))
        }
        ${renderSimpleConditionEditor(branch)}
      </div>`;

    const subVariantsBody = findVariantFork(branch) ? "" : renderNestedVariantsBlock(branch);

    return `
      ${renderContextHelpCallout(branch)}
      ${previewHint}
      ${renderInspectorCard(uk("inspectorTitle"), propertiesBody, "node-inspector-card--properties")}
      ${renderInspectorCard(uk("contentLegend"), renderVariantContentBody(branch), "node-inspector-card--content")}
      ${subVariantsBody ? renderInspectorCard(uk("subVariantsTitle"), subVariantsBody, "node-inspector-card--variants") : ""}
      ${renderChildrenCard(branch)}`;
  }

  function renderChildrenCard(node) {
    if (!NodeModel.canHaveChildren(node)) return "";
    const addPickerId = `node-add-child-${node.id}`;
    const hintId = `node-add-hint-${node.id}`;
    let defaultKind = "section";
    if (isVariantBranch(node)) {
      defaultKind = findVariantFork(node) ? "paragraph" : "section";
    } else if (node.type === "marker") {
      defaultKind = findVariantFork(node) ? "paragraph" : "marker";
    } else if (node.type === "section") {
      defaultKind = findVariantFork(node) ? "paragraph" : "section";
    }

    const body = `
      <div class="node-add-row">
        ${renderAddNodePicker(node.id, addPickerId, hintId, defaultKind)}
      </div>
      ${renderTreeToolbar(node)}
      ${renderReparentField(node)}`;

    return renderInspectorCard(uk("treeOpsLegend"), body, "node-inspector-card--tree");
  }

  function renderSectionInspector(section) {
    const fork = findVariantFork(section);
    const variantsBody = fork
      ? `${renderExclusiveStructureView(section)}${renderAddChoiceBranchAction(section)}`
      : renderNestedVariantsBlock(section);

    const propertiesBody = `
      ${renderInspectorMetaPanel(section)}
      ${renderTemplateGuide(section.id)}
      ${fork ? renderPreviewReadinessHint(section) : ""}
      <label class="node-field">
        <span class="node-field-label">${uk("labelField")}</span>
        <input type="text" class="node-input" data-node-prop="metadata.label" value="${escapeHtml(section.metadata?.label || "")}" placeholder="${uk("labelPlaceholder")}">
      </label>`;

    return `
      ${renderContextHelpCallout(section)}
      ${renderInspectorCard(uk("inspectorTitle"), propertiesBody, "node-inspector-card--properties")}
      ${variantsBody ? renderInspectorCard(uk("zoneVariantsTitle"), variantsBody, "node-inspector-card--variants") : ""}
      ${renderChildrenCard(section)}`;
  }

  function getOrCreateBranchParagraph(branchId) {
    for (const child of NodeModel.orderedChildren(model, branchId)) {
      if (child.type === "paragraph") return child;
    }
    return NodeModel.addNode(model, { type: "paragraph", parentId: branchId });
  }

  function renderMarkerInspector(marker) {
    const fork = findVariantFork(marker);

    const propertiesBody = `
      ${renderInspectorMetaPanel(marker)}
      <label class="node-field">
        <span class="node-field-label">${uk("labelField")}</span>
        <input type="text" class="node-input" data-node-prop="metadata.label" value="${escapeHtml(marker.metadata?.label || "")}" placeholder="${uk("labelPlaceholder")}">
      </label>
      ${fork ? renderPreviewReadinessHint(marker) : ""}`;

    return `
      ${renderContextHelpCallout(marker)}
      ${renderInspectorCard(uk("inspectorTitle"), propertiesBody, "node-inspector-card--properties")}
      ${renderInspectorCard(uk("contentLegend"), renderBlockPicker(marker), "node-inspector-card--content")}
      ${renderChildrenCard(marker)}`;
  }

  function renderNestedVariantsBlock(containerNode) {
    if (!containerNode) return "";
    if (containerNode.type === "section" && containerNode.condition) return "";
    if (containerNode.type !== "section" && containerNode.type !== "marker") return "";

    const fork = findVariantFork(containerNode);
    const parentForAdd = containerNode.id;
    const isBranch = isVariantBranch(containerNode);
    const title = isBranch ? uk("subVariantsTitle") : uk("variantsTitle");
    const yesLabel = isBranch ? uk("addSubVariantYesNo") : uk("addYesNoVariants");
    const yesSub = isBranch ? uk("addSubVariantYesNoSub") : uk("addYesNoVariantsSub");
    const choiceLabel = isBranch ? uk("addSubVariantChoice") : uk("addChoiceVariants");
    const choiceSub = isBranch ? uk("addSubVariantChoiceSub") : uk("addChoiceVariantsSub");

    if (!fork) {
      return `
        <div class="node-variants-panel">
          ${renderVariantFieldPicker()}
          <div class="node-variants-quick">
            <button type="button" class="node-variant-quick-btn node-variant-quick-btn--yes" data-add-yes-no-to="${escapeHtml(parentForAdd)}">
              <strong>${escapeHtml(yesLabel)}</strong>
              <span>${escapeHtml(yesSub)}</span>
            </button>
            <button type="button" class="node-variant-quick-btn node-variant-quick-btn--choice" data-add-choice-to="${escapeHtml(parentForAdd)}">
              <strong>${escapeHtml(choiceLabel)}</strong>
              <span>${escapeHtml(choiceSub)}</span>
            </button>
          </div>
        </div>`;
    }

    return `
      ${renderExclusiveStructureView(containerNode)}
      ${renderAddChoiceBranchAction(containerNode)}
      ${isBranch ? `<p class="node-inspector-hint">${uk("selectSubVariantHint")}</p>` : `<p class="node-inspector-hint">${uk("selectVariantHint")}</p>`}`;
  }

  function renderVariantsPanel(node) {
    if (!node || node.type !== "section" || node.condition) return "";
    return renderNestedVariantsBlock(node);
  }

  function getFirstParagraphUnder(branchId) {
    for (const child of NodeModel.orderedChildren(model, branchId)) {
      if (child.type === "paragraph") return child;
    }
    return null;
  }

  function getNodeTreeRole(node) {
    if (!node) return "default";
    if (isVariantBranch(node)) return `branch-${getBranchTone(node)}`;
    if (isVariantForkNode(node)) return "fork";
    if (node.type === "paragraph" || node.type === "table") return "leaf";
    if (node.type === "section") return "section";
    return node.type || "default";
  }

  function getVisibleTreeChildren(parentNode) {
    const children = NodeModel.orderedChildren(model, parentNode.id);

    if (parentNode.type === "marker" && isMarkerForkNode(parentNode)) {
      return children.filter((child) => !isVariantForkNode(child));
    }

    const result = [];
    for (const child of children) {
      if (isVariantForkNode(child)) {
        result.push(...NodeModel.orderedChildren(model, child.id));
      } else {
        result.push(child);
      }
    }
    return result;
  }

  function renderTreeExpander(node, hasChildren, collapsed) {
    if (!hasChildren) {
      return `<span class="tree-expander tree-expander--empty" aria-hidden="true"></span>`;
    }
    return `<button type="button" class="tree-expander" data-toggle-node="${escapeHtml(node.id)}" aria-label="${
      collapsed ? uk("expand") : uk("collapse")
    }" aria-expanded="${collapsed ? "false" : "true"}">
      <svg class="tree-expander-icon ${collapsed ? "is-collapsed" : ""}" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 4.5 10 8l-4 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>`;
  }

  function renderTreeNodeIcon(role) {
    if (role.startsWith("branch-")) {
      const tone = role.replace("branch-", "");
      return `<span class="tree-icon tree-icon--status tree-icon--${escapeHtml(tone)}" aria-hidden="true"></span>`;
    }
    if (role === "leaf") {
      return `<span class="tree-icon tree-icon--leaf" aria-hidden="true"></span>`;
    }
    return `<span class="tree-icon tree-icon--section" aria-hidden="true"></span>`;
  }

  function renderTreeChildren(parentNode, depth) {
    return getVisibleTreeChildren(parentNode)
      .map((child) => renderTreeNode(child, depth + 1))
      .join("");
  }

  function updateAddNodeHint(selectEl, hintEl) {
    if (!selectEl || !hintEl) return;
    const tip = UK()?.hintForAddNodeKind(selectEl.value) || "";
    hintEl.textContent = tip;
    selectEl.title = tip;
  }

  function focusAfterTemplate(rootNode, kind) {
    if (!rootNode) return;
    expandToNode(rootNode.id);
    collapsedIds.delete(rootNode.id);
    if (kind === "yes-no" || kind === "choice") {
      const hostSection = rootNode.parent_id ? NodeModel.getNode(model, rootNode.parent_id) : rootNode;
      templateGuideSectionId = hostSection?.id || null;
      const branches = NodeModel.orderedChildren(model, rootNode.id).filter(isVariantBranch);
      selectedNodeId = branches[0]?.id || hostSection?.id || rootNode.id;
      expandToNode(selectedNodeId);
      activeRulesPage = "editor";
      onStatus("Оберіть варіант у списку зверху → «Додати контент».");
      return;
    }
    selectedNodeId = rootNode.id;
    activeRulesPage = "editor";
  }

  function getExclusiveBranchesMissingContent(sectionNode) {
    const fork = findVariantFork(sectionNode);
    if (!fork) return [];
    return NodeModel.orderedChildren(model, fork.id)
      .filter(isVariantBranch)
      .filter((branch) => countBranchBlocks(branch.id) === 0);
  }

  function renderPreviewReadinessHint(sectionNode) {
    const missing = getExclusiveBranchesMissingContent(sectionNode);
    if (!missing.length) return "";
    const names = missing.map((branch) => NodeModel.nodeLabel(branch)).join(", ");
    return `
      <aside class="node-preview-readiness" role="status">
        <strong>${uk("previewNotReadyTitle")}</strong>
        <p>${escapeHtml(uk("previewNotReadyBody"))}</p>
        <p class="node-preview-readiness-missing">${escapeHtml(uk("previewMissingVariants"))}: ${escapeHtml(names)}</p>
      </aside>`;
  }

  function defaultInspectorTabForNode(node) {
    if (inspectorTab === "content" && !NodeModel.supportsBlockContent(node)) return "general";
    return inspectorTab;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
  }

  function truncate(text, limit = 72) {
    return NodeBlocks?.truncate ? NodeBlocks.truncate(text, limit) : text;
  }

  function blockPreview(blockId) {
    return NodeBlocks.blockPreviewText(getPreviewEl(), blockId);
  }

  function conditionSummary(condition) {
    if (typeof ConditionBuilder !== "undefined" && ConditionBuilder.conditionSummary) {
      return ConditionBuilder.conditionSummary(condition, model.fields || []);
    }
    if (!condition) return "Завжди";
    return JSON.stringify(condition);
  }

  function expandToNode(nodeId) {
    let cursor = NodeModel.getNode(model, nodeId);
    while (cursor?.parent_id) {
      collapsedIds.delete(cursor.parent_id);
      cursor = NodeModel.getNode(model, cursor.parent_id);
    }
  }

  function scrollSelectedTreeRowIntoView() {
    if (!treeEl || !selectedNodeId) return;
    treeEl.querySelector(`[data-select-node="${CSS.escape(selectedNodeId)}"]`)?.scrollIntoView({
      block: "nearest",
    });
  }

  function refreshHighlights() {
    const preview = getPreviewEl();
    if (!preview) return;

    preview.querySelectorAll("[data-block-id]").forEach((block) => {
      block.classList.remove("docx-block--selected", "docx-block--assign-target");
    });

    if (selectedNodeId) {
      const rawNode = NodeModel.getNode(model, selectedNodeId);
      const node = rawNode ? resolveInspectorNode(rawNode) || rawNode : null;
      if (node) {
        const blockIds = collectNodeBlockIds(node.id);
        let firstEl = null;
        blockIds.forEach((blockId) => {
          const el = preview.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
          if (el) {
            el.classList.add("docx-block--selected");
            if (!firstEl) firstEl = el;
          }
        });
        if (firstEl && blockIds.length) {
          firstEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }

    if (selectedBlockId) {
      preview
        .querySelector(`[data-block-id="${CSS.escape(selectedBlockId)}"]`)
        ?.classList.add("docx-block--selected");
    }

    if (assignMode) {
      preview.querySelectorAll("[data-block-id]").forEach((block) => {
        block.classList.add("docx-block--assign-target");
      });
    }
  }

  function renderFieldsPanel() {
    if (!fieldsEl) return;
    const fields = model.fields || [];
    if (!fields.length) {
      fieldsEl.innerHTML = renderZoneEmpty(
        uk("fieldsEmpty"),
        uk("fieldsEmptySub"),
        `<button type="button" class="btn btn-sm btn-accent" id="node-add-field-inline-btn">${uk("addField")}</button>`,
      );
      return;
    }

    fieldsEl.innerHTML = fields
      .map((field) => {
        const meta =
          field.type === "choice"
            ? (field.options || []).map((opt) => opt.label || opt.value).join(" · ") ||
              (UK()?.fieldTypeLabel("choice") || "Вибір")
            : UK()?.fieldTypeLabel(field.type) || "Так / Ні";
        const selected = preferredFieldId === field.id;
        return `
          <article class="logic-field-card ${selected ? "is-selected" : ""}">
            <button type="button" class="logic-field-card-main" data-select-field="${escapeHtml(field.id)}" title="Обрати цю умову для нових варіантів">
              <strong class="logic-field-card-title">${escapeHtml(field.label || field.id)}</strong>
              <span class="logic-field-card-meta">${escapeHtml(meta)}</span>
            </button>
            <div class="logic-field-card-actions">
              <button type="button" class="btn btn-sm" data-node-edit-field="${escapeHtml(field.id)}" title="Редагувати умову">${uk("editField")}</button>
              <button type="button" class="btn btn-sm btn-danger" data-node-delete-field="${escapeHtml(field.id)}" title="Видалити умову">×</button>
            </div>
          </article>`;
      })
      .join("");
  }

  function getVariantFieldPickerValue() {
    const picker = document.getElementById("node-variant-field-picker");
    if (picker?.value) return picker.value;
    if (preferredFieldId) return preferredFieldId;
    const fields = model.fields || [];
    return fields[0]?.id || null;
  }

  function resolveVariantFieldForKind(kind) {
    const fieldId = getVariantFieldPickerValue();
    if (!fieldId) {
      return { error: "Спочатку створіть умову («+ Умова» зверху)." };
    }
    const field = NodeModel.getField(model, fieldId);
    if (!field) return { error: "Оберіть умову зі списку." };
    if (kind === "yes-no" && field.type !== "boolean") {
      return { error: `«${field.label}» — не Так/Ні. Оберіть boolean-умову або створіть нову з двома варіантами.` };
    }
    if (kind === "choice" && field.type !== "choice") {
      return { error: `«${field.label}» — не список. Оберіть умову з кількома варіантами.` };
    }
    return { fieldId };
  }

  function renderVariantFieldPicker() {
    const fields = model.fields || [];
    if (!fields.length) {
      return `<p class="node-variant-no-fields">${uk("variantsNeedCondition")}</p>`;
    }
    const currentId = preferredFieldId || fields.find((f) => f.type === "boolean")?.id || fields[0].id;
    return `
      <label class="node-field node-variant-field-picker">
        <span class="node-field-label">${uk("pickConditionForVariants")}</span>
        <select class="node-input" id="node-variant-field-picker">
          ${fields
            .map((field) => {
              const kind = field.type === "boolean" ? "Так/Ні" : "список";
              return `<option value="${escapeHtml(field.id)}" ${field.id === currentId ? "selected" : ""}>${escapeHtml(field.label || field.id)} (${kind})</option>`;
            })
            .join("")}
        </select>
      </label>`;
  }

  function renderAddNodePicker(parentId, selectId, hintId = null, defaultKind = "section") {
    const selected = defaultKind;
    const hintAttr = hintId ? ` data-add-node-hint-for="${escapeHtml(hintId)}"` : "";
    return `
      <div class="node-add-picker node-add-picker--inline">
        <select class="node-input node-add-select" data-add-node-select="${escapeHtml(parentId || "")}" id="${escapeHtml(selectId)}" aria-label="${uk("addNodeAria")}"${hintAttr}>
          ${UK()?.renderAddNodeOptions(selected) || ""}
        </select>
        <button type="button" class="btn btn-sm btn-accent" data-add-node-submit="${escapeHtml(parentId || "")}" title="${escapeHtml(UK()?.addOption(selected)?.tip || "")}">${uk("addNode")}</button>
      </div>
      ${hintId ? `<p class="node-add-hint" id="${escapeHtml(hintId)}"></p>` : ""}`;
  }

  function resolveFieldForVariantKind(kind, options = {}) {
    if (options.fieldId) return { fieldId: options.fieldId };
    return resolveVariantFieldForKind(kind);
  }

  function addNodeFromPicker(kind, parentId = null, options = {}) {
    if (typeof NodeTemplates === "undefined") return null;

    let created = null;
    switch (kind) {
      case "section":
        created = NodeTemplates.createSectionTemplate(model, { parentId });
        break;
      case "paragraph":
      case "table":
      case "marker": {
        if (parentId) {
          const parent = NodeModel.getNode(model, parentId);
          if (!parent || !NodeModel.canHaveChildren(parent)) return null;
        }
        created = NodeModel.addNode(model, { type: kind, parentId: parentId || null });
        if (created && typeof NodeTemplates.ensureMarkerFork === "function") {
          NodeTemplates.ensureMarkerFork(model, created.id);
        }
        break;
      }
      case "yes-no": {
        const resolved = resolveFieldForVariantKind("yes-no", options);
        if (resolved.error) {
          onStatus(resolved.error, true);
          openFieldsPage();
          return null;
        }
        created = NodeTemplates.createYesNoTemplate(model, {
          parentId: parentId || null,
          fieldId: resolved.fieldId,
        });
        break;
      }
      case "choice": {
        const resolved = resolveFieldForVariantKind("choice", options);
        if (resolved.error) {
          onStatus(resolved.error, true);
          openFieldsPage();
          return null;
        }
        created = NodeTemplates.createExclusiveChoiceTemplate(model, {
          parentId: parentId || null,
          fieldId: resolved.fieldId,
        });
        break;
      }
      default:
        return null;
    }

    if (!created) return null;

    if (kind === "yes-no" || kind === "choice") {
      focusAfterTemplate(created, kind);
    } else {
      selectedNodeId = created.id;
      expandToNode(created.id);
    }
    if (parentId) collapsedIds.delete(parentId);
    return created;
  }

  function addNodeStatusMessage(kind, parentId = null) {
    const opt = UK()?.addOption(kind);
    if (kind === "yes-no" && parentId) {
      const parent = NodeModel.getNode(model, parentId);
      if (parent && isVariantBranch(parent)) return "Підваріанти Так/Ні додано";
    }
    if (kind === "choice" && parentId) {
      const parent = NodeModel.getNode(model, parentId);
      if (parent && isVariantBranch(parent)) return "Підваріанти списку додано";
    }
    if (opt) return `Додано: ${opt.label}`;
    return "Вузол додано";
  }

  function renderTreeNode(node, depth = 0) {
    const visibleChildren = getVisibleTreeChildren(node);
    const hasChildren = visibleChildren.length > 0;
    const collapsed = collapsedIds.has(node.id);
    const selected = selectedNodeId === node.id;
    const label = NodeModel.nodeLabel(node);
    const role = getNodeTreeRole(node);
    const meta = formatTreeNodeMeta(node);
    const isRootSection = role === "section" && depth === 0;

    const childHtml = collapsed || !hasChildren ? "" : renderTreeChildren(node, depth);

    return `
      <div class="tree-branch" data-node-id="${escapeHtml(node.id)}">
        <div class="tree-row tree-row--${role}${isRootSection ? " tree-row--root" : ""}${selected ? " is-selected" : ""}"
          role="treeitem"
          aria-expanded="${hasChildren && !collapsed ? "true" : "false"}"
          data-select-node="${escapeHtml(node.id)}"
          data-tree-node="${escapeHtml(node.id)}"
          data-depth="${depth}"
          style="--tree-depth: ${depth}">
          <span class="tree-indent" aria-hidden="true"></span>
          ${renderTreeExpander(node, hasChildren, collapsed)}
          ${renderTreeNodeIcon(role)}
          <span class="tree-label">${escapeHtml(label)}</span>
          <span class="tree-fill" aria-hidden="true"></span>
          <span class="tree-meta">${meta ? escapeHtml(truncate(meta, 48)) : ""}</span>
          <button type="button" class="tree-action tree-action--drag" data-drag-node="${escapeHtml(node.id)}" draggable="true" title="${uk("dragHandleTip")}" aria-label="${uk("dragHandleTip")}"></button>
        </div>
        ${childHtml ? `<div class="tree-group" role="group" style="--parent-depth: ${depth}">${childHtml}</div>` : ""}
      </div>`;
  }

  function renderTreeEmpty(title, sub, actionHtml = "") {
    return `
      <div class="tree-empty">
        <p class="tree-empty-title">${escapeHtml(title)}</p>
        ${sub ? `<p class="tree-empty-sub">${escapeHtml(sub)}</p>` : ""}
        ${actionHtml}
      </div>`;
  }

  function renderTree() {
    if (!treeEl) return;
    const roots = NodeModel.rootNodes(model);
    if (!roots.length) {
      treeEl.innerHTML = renderTreeEmpty(
        uk("treeEmptyTitle"),
        uk("treeEmptySub"),
        `<button type="button" class="btn btn-sm btn-accent" data-trigger-add-root>${uk("treeEmptyBtn")}</button>`,
      );
      return;
    }
    treeEl.innerHTML = roots.map((node) => renderTreeNode(node)).join("");
    scrollSelectedTreeRowIntoView();
  }

  function renderAssignedBlocks(node) {
    const blockIds = NodeModel.getBlockIds(node);
    if (!blockIds.length) {
      return `<p class="node-inspector-hint">${uk("blocksEmpty")}</p>`;
    }

    return `
      <ul class="logic-blocks-list">
        ${blockIds
          .map(
            (blockId) => `
          <li class="logic-block-chip">
            <button type="button" class="logic-block-chip-main" data-focus-block="${escapeHtml(blockId)}">
              <span class="node-block-chip-id">${escapeHtml(blockId)}</span>
              ${escapeHtml(truncate(blockPreview(blockId), 56))}
            </button>
            <button type="button" class="logic-block-chip-remove" data-remove-node-block="${escapeHtml(node.id)}" data-block-id="${escapeHtml(blockId)}" title="${uk("removeBlock")}">×</button>
          </li>`,
          )
          .join("")}
      </ul>`;
  }

  function renderBlockPicker(node) {
    const preview = getPreviewEl();
    const assigned = NodeModel.getBlockIds(node);
    const allBlocks = NodeBlocks.listPreviewBlockIds(preview);
    const available = allBlocks.filter((blockId) => !assigned.includes(blockId));

    return `
      <div class="node-block-picker-root">
        <div class="node-block-section">
          <div class="node-block-section-head">${uk("assignedBlocks")}</div>
          ${renderAssignedBlocks(node)}
          <div class="node-inspector-actions">
            <button type="button" class="btn btn-sm ${assignMode ? "" : "btn-accent"}" data-toggle-assign title="${uk("addFromDocTip")}">
              ${assignMode ? uk("doneAssign") : uk("addFromDoc")}
            </button>
            ${
              selectedBlockId && !assigned.includes(selectedBlockId)
                ? `<button type="button" class="btn btn-sm" data-add-selected-block="${escapeHtml(node.id)}">${uk("addSelectedBlock")}</button>`
                : ""
            }
          </div>
        </div>

        <div class="node-block-section">
          <div class="node-block-section-head">${uk("docBlocks")} (${available.length})</div>
          ${
            available.length
              ? `<ul class="node-block-picker">${available
                  .map(
                    (blockId) => `
                <li class="node-block-picker-item">
                  <button type="button" class="node-block-picker-add" data-add-block-to="${escapeHtml(node.id)}" data-block-id="${escapeHtml(blockId)}" title="Прив’язати цей блок до вузла">
                    <span class="node-block-picker-id">${escapeHtml(blockId)}</span>
                    <span class="node-block-picker-snippet">${escapeHtml(truncate(blockPreview(blockId), 72))}</span>
                  </button>
                </li>`,
                  )
                  .join("")}</ul>`
              : `<p class="node-inspector-hint">${allBlocks.length ? uk("allBlocksAssigned") : uk("noBlocksInDoc")}</p>`
          }
        </div>
      </div>`;
  }

  function renderSimpleConditionEditor(node) {
    const cond = node.condition;
    const fields = model.fields || [];
    if (!fields.length) {
      return `<p class="node-inspector-hint">${uk("fieldsEmptySub")}</p>`;
    }

    const predicate = cond?.type === "predicate" ? cond : { type: "predicate", condition_id: fields[0]?.id || "", operator: "eq", value: true };
    const fieldOptions = fields
      .map(
        (field) =>
          `<option value="${escapeHtml(field.id)}" ${field.id === predicate.condition_id ? "selected" : ""}>${escapeHtml(field.label || field.id)}</option>`,
      )
      .join("");
    const fieldDef = fields.find((f) => f.id === predicate.condition_id) || fields[0];

    let valueInput = "";
    if (!fieldDef || fieldDef.type === "boolean") {
      valueInput = `
        <select class="node-input" data-simple-condition-value="${escapeHtml(node.id)}">
          <option value="true" ${predicate.value === true ? "selected" : ""}>${uk("branchYes")}</option>
          <option value="false" ${predicate.value === false ? "selected" : ""}>${uk("branchNo")}</option>
        </select>`;
    } else {
      valueInput = `
        <select class="node-input" data-simple-condition-value="${escapeHtml(node.id)}">
          ${(fieldDef.options || [])
            .map(
              (opt) =>
                `<option value="${escapeHtml(String(opt.value))}" ${String(predicate.value) === String(opt.value) ? "selected" : ""}>${escapeHtml(opt.label || opt.value)}</option>`,
            )
            .join("")}
        </select>`;
    }

    return `
      <div class="node-simple-condition">
        <label class="node-field">
          <span class="node-field-label">${uk("simpleCondition")}</span>
          <div class="node-simple-condition-row">
            <select class="node-input" data-simple-condition-field="${escapeHtml(node.id)}">${fieldOptions}</select>
            <span class="node-simple-condition-eq">=</span>
            ${valueInput}
          </div>
        </label>
      </div>`;
  }

  function mountConditionBuilder(node) {
    const host = inspectorEl?.querySelector("#node-condition-builder");
    if (!host || typeof ConditionBuilder === "undefined") return;

    ConditionBuilder.mount(host, {
      condition: node.condition,
      conditionsCatalog: model.fields || [],
      onChange: (value) => {
        const normalized = ConditionBuilder.normalizeCondition(value);
        NodeModel.updateNodeProperty(model, node.id, "condition", normalized);
        onModelChange();
        const summary = inspectorEl.querySelector(".node-condition-summary");
        if (summary) summary.textContent = conditionSummary(normalized);
      },
    });
  }

  function renderTreeToolbar(node) {
    const canUp = NodeModel.canMoveNodeUp(model, node.id);
    const canDown = NodeModel.canMoveNodeDown(model, node.id);

    return `
      <div class="node-inspector-toolbar">
        <div class="node-inspector-toolbar-start">
          <button type="button" class="btn btn-sm" data-duplicate-node="${escapeHtml(node.id)}" title="${uk("duplicateTip")}">${uk("duplicate")}</button>
          <button type="button" class="btn btn-sm" data-move-node-up="${escapeHtml(node.id)}" ${canUp ? "" : "disabled"} title="${uk("moveUpTip")}">${uk("moveUp")}</button>
          <button type="button" class="btn btn-sm" data-move-node-down="${escapeHtml(node.id)}" ${canDown ? "" : "disabled"} title="${uk("moveDownTip")}">${uk("moveDown")}</button>
        </div>
        <div class="node-inspector-toolbar-end">
          <button type="button" class="btn btn-sm btn-danger" data-delete-subtree="${escapeHtml(node.id)}" title="${uk("deleteSubtreeTip")}">${uk("deleteSubtree")}</button>
        </div>
      </div>`;
  }

  function renderReparentField(node) {
    const reparentTargets = NodeModel.listReparentTargets(model, node.id);
    const currentParent = node.parent_id || "";

    return `
      <label class="node-field node-reparent-field">
        <span class="node-field-label" title="${uk("parentTip")}">${uk("parent")}</span>
        <select class="node-input" data-reparent-node="${escapeHtml(node.id)}" title="${uk("parentTip")}">
          ${reparentTargets
            .map(
              (target) =>
                `<option value="${escapeHtml(target.id)}" ${target.id === currentParent ? "selected" : ""}>${escapeHtml(formatReparentLabel(target.label))}</option>`,
            )
            .join("")}
        </select>
      </label>`;
  }

  function renderTreeOperations(node) {
    return `${renderTreeToolbar(node)}${renderReparentField(node)}`;
  }

  function renderInspector() {
    if (!inspectorEl) return;
    const rawNode = selectedNodeId ? NodeModel.getNode(model, selectedNodeId) : null;
    if (!rawNode) {
      inspectorEl.innerHTML = renderZoneEmpty(uk("zonePropertiesEmpty"), uk("zonePropertiesEmptySub"));
      renderEditorBreadcrumb(null);
      return;
    }

    if (isVariantForkNode(rawNode) && rawNode.parent_id) {
      selectedNodeId = rawNode.parent_id;
      renderInspector();
      return;
    }

    const node = resolveInspectorNode(rawNode) || rawNode;
    const isBranch = isVariantBranch(node);
    const isPlainSection = node.type === "section" && !node.condition;
    const showContent = !isBranch && NodeModel.supportsBlockContent(node);
    const showCondition = !isBranch && Boolean(node.condition);

    let mainBody = "";
    if (isBranch) {
      mainBody = renderVariantInspector(node);
    } else if (isPlainSection) {
      mainBody = renderSectionInspector(node);
    } else if (node.type === "marker") {
      mainBody = renderMarkerInspector(node);
    } else {
      const propertiesBody = `
        ${renderInspectorMetaPanel(node)}
        <label class="node-field">
          <span class="node-field-label">${uk("labelField")}</span>
          <input type="text" class="node-input" data-node-prop="metadata.label" value="${escapeHtml(node.metadata?.label || "")}" placeholder="${uk("labelPlaceholder")}">
        </label>
        ${showCondition ? renderSimpleConditionEditor(node) : ""}`;

      mainBody = `
        ${renderContextHelpCallout(node)}
        ${renderInspectorCard(uk("inspectorTitle"), propertiesBody, "node-inspector-card--properties")}
        ${showContent ? renderInspectorCard(uk("contentLegend"), renderBlockPicker(node), "node-inspector-card--content") : ""}
        ${NodeModel.canHaveChildren(node) ? renderChildrenCard(node) : ""}`;
    }

    inspectorEl.innerHTML = `<div class="node-inspector">${mainBody}</div>`;

    syncAddNodeHints();
    renderEditorBreadcrumb(node);
  }

  function renderAll() {
    renderFieldsPanel();
    renderTree();
    renderEditorContextStrip();
    renderInspector();
    syncPageNav({ skipEditorScroll: true });
    refreshHighlights();
    renderWorkflowHelpPanel();
    syncAddNodeHints();
  }

  function openNodeEditor(nodeId, options = {}) {
    if (!nodeId) return;
    selectedNodeId = nodeId;
    assignMode = false;
    expandToNode(nodeId);
    navigateToPage("editor", options);
    renderAll();
  }

  function notifyChange() {
    onModelChange();
    renderAll();
  }

  function selectNodeByBlockId(blockId) {
    const owner = NodeModel.findNodeByBlockId(model, blockId);
    if (!owner) return false;
    const parent = owner.parent_id ? NodeModel.getNode(model, owner.parent_id) : null;
    selectedNodeId = parent && isVariantBranch(parent) ? parent.id : owner.id;
    selectedBlockId = blockId;
    assignMode = false;
    expandToNode(selectedNodeId);
    navigateToPage("editor");
    renderAll();
    return true;
  }

  function addBlockToSelectedNode(blockId) {
    if (!selectedNodeId || !blockId) return false;
    let targetId = selectedNodeId;
    let node = NodeModel.getNode(model, targetId);
    if (node && isVariantBranch(node)) {
      const para = getOrCreateBranchParagraph(node.id);
      if (!para) return false;
      targetId = para.id;
      node = para;
    }
    if (!node || !NodeModel.supportsBlockContent(node)) return false;
    if (!NodeModel.addBlockToNode(model, targetId, blockId)) return false;
    selectedBlockId = blockId;
    notifyChange();
    onStatus("Блок додано до варіанту");
    return true;
  }

  function focusBlockInPreview(blockId) {
    if (!blockId) return;
    selectedBlockId = blockId;
    const preview = getPreviewEl();
    const el = preview?.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("docx-block--scroll-flash");
      window.setTimeout(() => el.classList.remove("docx-block--scroll-flash"), 1200);
    }
    refreshHighlights();
  }

  function bindPreviewClicks(previewEl) {
    if (previewClickBound || !previewEl) return;
    previewClickBound = true;

    previewEl.addEventListener("click", (event) => {
      if (!getIsActive()) return;
      const block = event.target.closest("[data-block-id]");
      if (!block) return;

      const blockId = block.getAttribute("data-block-id");
      selectedBlockId = blockId;

      if (assignMode && selectedNodeId) {
        addBlockToSelectedNode(blockId);
        return;
      }

      if (selectNodeByBlockId(blockId)) {
        onStatus(`Обрано вузол для блоку ${blockId}`);
        return;
      }

      refreshHighlights();
    });
  }

  function applyInspectorValue(nodeId, path, rawValue, inputType) {
    if (path === "properties.behavior.exclusive") {
      NodeModel.updateNodeProperty(model, nodeId, path, inputType === "checkbox" ? Boolean(rawValue) : rawValue);
      return true;
    }

    NodeModel.updateNodeProperty(model, nodeId, path, rawValue);
    return true;
  }

  async function addFieldAsync() {
    if (typeof Dialogs === "undefined" || !Dialogs.promptConditionCreate) {
      const created = NodeModel.createField({ type: "boolean", label: "Нова умова" });
      NodeModel.addField(model, created);
      preferredFieldId = created.id;
      navigateToPage("fields");
      notifyChange();
      onStatus("Умову створено");
      return;
    }
    const created = await Dialogs.promptConditionCreate();
    if (!created) return;
    NodeModel.addField(model, created);
    preferredFieldId = created.id;
    navigateToPage("fields");
    notifyChange();
    onStatus(`Умову «${created.label}» створено — оберіть її для варіантів розділу`);
  }

  async function editFieldAsync(fieldId) {
    const field = NodeModel.getField(model, fieldId);
    if (!field) return;
    if (typeof Dialogs === "undefined" || !Dialogs.promptConditionEdit) return;
    const edited = await Dialogs.promptConditionEdit(field);
    if (!edited) return;
    NodeModel.updateField(model, fieldId, edited);
    notifyChange();
    onStatus("Поле оновлено");
  }

  function deleteField(fieldId) {
    NodeModel.deleteField(model, fieldId);
    notifyChange();
    onStatus("Поле видалено");
  }

  async function deleteSubtreeAsync(nodeId) {
    const node = NodeModel.getNode(model, nodeId);
    if (!node) return;

    const confirmed =
      typeof Dialogs !== "undefined" && Dialogs.confirm
        ? await Dialogs.confirm({
            title: "Видалити розділ?",
            message: `«${NodeModel.nodeLabel(node)}» і все всередині буде видалено.`,
            variant: "danger",
            confirmText: "Видалити",
          })
        : window.confirm(`Видалити «${NodeModel.nodeLabel(node)}» та дочірні вузли?`);

    if (!confirmed) return;

    NodeModel.deleteSubtree(model, nodeId);
    if (selectedNodeId === nodeId) selectedNodeId = null;
    notifyChange();
    onStatus("Піддерево видалено");
  }

  function clearDropIndicators() {
    if (!treeEl) return;
    treeEl.querySelectorAll(".tree-row").forEach((row) => {
      row.classList.remove("is-drop-before", "is-drop-after", "is-drop-inside", "is-drop-invalid");
    });
    activeDropTarget = null;
  }

  function updateDropIndicator(row, targetNodeId, position, valid) {
    clearDropIndicators();
    if (!row || !targetNodeId || !position) return;

    row.classList.add(valid ? `is-drop-${position}` : "is-drop-invalid");
    activeDropTarget = { nodeId: targetNodeId, position, valid };
  }

  function resolveRowDropTarget(row, clientY) {
    if (!row) return null;
    const targetNodeId = row.dataset.treeNode;
    const targetNode = NodeModel.getNode(model, targetNodeId);
    if (!targetNode) return null;

    const position = NodeModel.resolveDropPosition(clientY, row.getBoundingClientRect(), targetNode);
    const valid = dragNodeId ? NodeModel.canDropNode(model, dragNodeId, targetNodeId, position) : false;
    return { row, targetNodeId, position, valid };
  }

  function applyActiveDrop() {
    if (!dragNodeId || !activeDropTarget?.valid) return false;

    const { nodeId: targetNodeId, position } = activeDropTarget;
    const ok = NodeModel.applyTreeDrop(model, dragNodeId, targetNodeId, position);
    if (!ok) return false;

    selectedNodeId = dragNodeId;
    if (position === "inside") collapsedIds.delete(targetNodeId);
    expandToNode(dragNodeId);
    return true;
  }

  function bindTreeDragDrop() {
    if (!treeEl || treeDragBound) return;
    treeDragBound = true;

    treeEl.addEventListener("dragstart", (event) => {
      if (!getIsActive()) return;
      const handle = event.target.closest(".tree-action--drag[data-drag-node]");
      if (!handle || !treeEl.contains(handle)) return;

      const row = handle.closest(".tree-row");
      if (!row) return;

      dragNodeId = handle.dataset.dragNode;
      dragPointerActive = true;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", dragNodeId);
      row.classList.add("is-dragging");
    });

    treeEl.addEventListener("dragover", (event) => {
      if (!dragNodeId) return;
      event.preventDefault();

      const row = event.target.closest(".tree-row[data-tree-node]");
      if (!row) {
        clearDropIndicators();
        event.dataTransfer.dropEffect = "none";
        return;
      }

      const target = resolveRowDropTarget(row, event.clientY);
      if (!target) {
        clearDropIndicators();
        event.dataTransfer.dropEffect = "none";
        return;
      }

      event.dataTransfer.dropEffect = target.valid ? "move" : "none";
      updateDropIndicator(target.row, target.targetNodeId, target.position, target.valid);
    });

    treeEl.addEventListener("dragleave", (event) => {
      if (!dragNodeId) return;
      const related = event.relatedTarget;
      if (related && treeEl.contains(related)) return;
      clearDropIndicators();
    });

    treeEl.addEventListener("drop", (event) => {
      if (!dragNodeId) return;
      event.preventDefault();

      const row = event.target.closest(".tree-row[data-tree-node]");
      if (row) {
        const target = resolveRowDropTarget(row, event.clientY);
        if (target?.valid) {
          activeDropTarget = {
            nodeId: target.targetNodeId,
            position: target.position,
            valid: true,
          };
        }
      }

      if (applyActiveDrop()) {
        notifyChange();
        onStatus("Вузол переміщено");
      } else {
        onStatus("Неможливо перемістити вузол сюди", true);
      }

      dragNodeId = null;
      dragPointerActive = false;
      clearDropIndicators();
    });

    treeEl.addEventListener("dragend", () => {
      dragNodeId = null;
      dragPointerActive = false;
      treeEl.querySelectorAll(".tree-row.is-dragging").forEach((row) => row.classList.remove("is-dragging"));
      clearDropIndicators();
    });
  }

  function bindEvents(root) {
    if (!root || eventsBound) return;
    eventsBound = true;

    root.addEventListener("click", (event) => {
      const pageTab = event.target.closest("[data-rules-page]:not(.rules-page)");
      if (pageTab && shellEl?.contains(pageTab)) {
        event.preventDefault();
        navigateToPage(pageTab.dataset.rulesPage);
        renderAll();
        return;
      }

      const pageBack = event.target.closest("[data-rules-page-back]");
      if (pageBack) {
        event.preventDefault();
        navigateToPage("structure");
        renderAll();
        return;
      }

      const addFieldBtn = event.target.closest("#node-add-field-btn, #node-add-field-inline-btn");
      if (addFieldBtn) {
        event.preventDefault();
        event.stopPropagation();
        void addFieldAsync();
        return;
      }

      const addYesNoBtn = event.target.closest("[data-add-yes-no-to]");
      if (addYesNoBtn) {
        const parentId = addYesNoBtn.dataset.addYesNoTo || null;
        const parent = parentId ? NodeModel.getNode(model, parentId) : null;
        if (parent?.type === "marker" && typeof NodeTemplates.ensureMarkerFork === "function") {
          const resolved = resolveVariantFieldForKind("yes-no");
          if (resolved.error) {
            onStatus(resolved.error, true);
            openFieldsPage();
            return;
          }
          NodeTemplates.ensureMarkerFork(model, parentId, { fieldId: resolved.fieldId });
          notifyChange();
          onStatus("Гілки маркера Так/Ні створено");
          return;
        }
        const resolved = resolveVariantFieldForKind("yes-no");
        if (resolved.error) {
          onStatus(resolved.error, true);
          openFieldsPage();
          return;
        }
        if (addNodeFromPicker("yes-no", parentId, { fieldId: resolved.fieldId })) {
          notifyChange();
          const label = NodeModel.getField(model, resolved.fieldId)?.label || "умова";
          onStatus(`Варіанти Так/Ні прив’язано до «${label}»`);
        }
        return;
      }

      const addChoiceBtn = event.target.closest("[data-add-choice-to]");
      if (addChoiceBtn) {
        const parentId = addChoiceBtn.dataset.addChoiceTo || null;
        const resolved = resolveVariantFieldForKind("choice");
        if (resolved.error) {
          onStatus(resolved.error, true);
          openFieldsPage();
          return;
        }
        if (addNodeFromPicker("choice", parentId, { fieldId: resolved.fieldId })) {
          notifyChange();
          const label = NodeModel.getField(model, resolved.fieldId)?.label || "умова";
          onStatus(`Варіанти списку прив’язано до «${label}»`);
        }
        return;
      }

      const addChoiceBranchBtn = event.target.closest("[data-add-choice-branch-to]");
      if (addChoiceBranchBtn) {
        const forkId = addChoiceBranchBtn.dataset.addChoiceBranchTo;
        if (typeof NodeTemplates.addChoiceBranchToFork === "function") {
          const created = NodeTemplates.addChoiceBranchToFork(model, forkId);
          if (created) {
            selectedNodeId = created.id;
            expandToNode(created.id);
            notifyChange();
            onStatus(`Додано варіант «${NodeModel.nodeLabel(created)}»`);
          } else {
            onStatus(uk("allChoiceBranchesAdded"), true);
          }
        }
        return;
      }

      const selectFieldBtn = event.target.closest("[data-select-field]");
      if (selectFieldBtn) {
        preferredFieldId = selectFieldBtn.dataset.selectField;
        renderFieldsPanel();
        const picker = document.getElementById("node-variant-field-picker");
        if (picker) picker.value = preferredFieldId;
        onStatus(`Обрано умову: ${NodeModel.getField(model, preferredFieldId)?.label || preferredFieldId}`);
        return;
      }

      const branchBindBtn = event.target.closest("[data-branch-bind-content]");
      if (branchBindBtn) {
        const branchId = branchBindBtn.dataset.branchBindContent;
        const contentNode = getOrCreateBranchParagraph(branchId);
        selectedNodeId = contentNode.id;
        assignMode = true;
        expandToNode(branchId);
        renderInspector();
        refreshHighlights();
        onStatus("Клікніть абзац у документі праворуч — він додасться до цього варіанту");
        return;
      }

      const dismissGuide = event.target.closest("[data-dismiss-template-guide]");
      if (dismissGuide) {
        templateGuideSectionId = null;
        renderInspector();
        return;
      }

      const editFieldBtn = event.target.closest("[data-node-edit-field]");
      if (editFieldBtn) {
        void editFieldAsync(editFieldBtn.dataset.nodeEditField);
        return;
      }

      const deleteFieldBtn = event.target.closest("[data-node-delete-field]");
      if (deleteFieldBtn) {
        event.preventDefault();
        event.stopPropagation();
        deleteField(deleteFieldBtn.dataset.nodeDeleteField);
        return;
      }

      const toggleAssign = event.target.closest("[data-toggle-assign]");
      if (toggleAssign) {
        assignMode = !assignMode;
        renderInspector();
        refreshHighlights();
        onStatus(assignMode ? "Клікайте абзаци в документі, щоб додати блок" : "Режим вибору вимкнено");
        return;
      }

      const addSelected = event.target.closest("[data-add-selected-block]");
      if (addSelected) {
        addBlockToSelectedNode(selectedBlockId);
        return;
      }

      const addBlockBtn = event.target.closest("[data-add-block-to]");
      if (addBlockBtn) {
        selectedNodeId = addBlockBtn.dataset.addBlockTo;
        addBlockToSelectedNode(addBlockBtn.dataset.blockId);
        return;
      }

      const removeBlockBtn = event.target.closest("[data-remove-node-block]");
      if (removeBlockBtn) {
        NodeModel.removeBlockFromNode(model, removeBlockBtn.dataset.removeNodeBlock, removeBlockBtn.dataset.blockId);
        notifyChange();
        onStatus("Блок прибрано");
        return;
      }

      const focusBlockBtn = event.target.closest("[data-focus-block]");
      if (focusBlockBtn) {
        focusBlockInPreview(focusBlockBtn.dataset.focusBlock);
        return;
      }

      const duplicateBtn = event.target.closest("[data-duplicate-node]");
      if (duplicateBtn) {
        const created = NodeModel.duplicateNode(model, duplicateBtn.dataset.duplicateNode);
        if (created) {
          selectedNodeId = created.id;
          expandToNode(created.id);
          notifyChange();
          onStatus("Піддерево дубльовано");
        } else {
          onStatus("Не вдалося дублювати вузол", true);
        }
        return;
      }

      const moveUpBtn = event.target.closest("[data-move-node-up]");
      if (moveUpBtn && !moveUpBtn.disabled) {
        if (NodeModel.moveNodeUp(model, moveUpBtn.dataset.moveNodeUp)) {
          notifyChange();
          onStatus("Вузол переміщено вгору");
        }
        return;
      }

      const moveDownBtn = event.target.closest("[data-move-node-down]");
      if (moveDownBtn && !moveDownBtn.disabled) {
        if (NodeModel.moveNodeDown(model, moveDownBtn.dataset.moveNodeDown)) {
          notifyChange();
          onStatus("Вузол переміщено вниз");
        }
        return;
      }

      const deleteSubtreeBtn = event.target.closest("[data-delete-subtree]");
      if (deleteSubtreeBtn) {
        event.preventDefault();
        event.stopPropagation();
        void deleteSubtreeAsync(deleteSubtreeBtn.dataset.deleteSubtree);
        return;
      }

      const toggle = event.target.closest("[data-toggle-node]");
      if (toggle) {
        const nodeId = toggle.dataset.toggleNode;
        if (collapsedIds.has(nodeId)) collapsedIds.delete(nodeId);
        else collapsedIds.add(nodeId);
        renderTree();
        refreshHighlights();
        return;
      }

      const backStructureCrumb = event.target.closest("[data-back-structure]");
      if (backStructureCrumb) {
        event.preventDefault();
        navigateToPage("structure");
        renderAll();
        return;
      }

      const selectRow = event.target.closest("[data-select-node]");
      if (selectRow) {
        if (event.target.closest(".tree-action--drag") || dragPointerActive) return;
        event.preventDefault();
        openNodeEditor(selectRow.dataset.selectNode);
        return;
      }
      const addNodeSubmit = event.target.closest("[data-add-node-submit]");
      if (addNodeSubmit) {
        const parentId = addNodeSubmit.dataset.addNodeSubmit || null;
        const select = addNodeSubmit
          .closest(".node-add-picker")
          ?.querySelector(`[data-add-node-select="${CSS.escape(parentId)}"]`);
        const kind = select?.value;
        if (!kind) return;
        if (addNodeFromPicker(kind, parentId || null)) {
          notifyChange();
          onStatus(addNodeStatusMessage(kind, parentId));
        } else {
          onStatus("Не вдалося додати вузол", true);
        }
        return;
      }

      const addRoot = event.target.closest("#node-add-node-btn");
      if (addRoot) {
        if (addNodeFromPicker("section", null)) {
          notifyChange();
          onStatus("Розділ додано");
        } else {
          onStatus("Не вдалося додати розділ", true);
        }
        return;
      }

      const triggerAddRoot = event.target.closest("[data-trigger-add-root]");
      if (triggerAddRoot) {
        document.getElementById("node-add-node-btn")?.click();
        return;
      }

      const inspectorTabBtn = event.target.closest("[data-inspector-tab]");
      if (inspectorTabBtn) {
        inspectorTab = inspectorTabBtn.dataset.inspectorTab;
        renderInspector();
        return;
      }
    });

    root.addEventListener(
      "change",
      (event) => {
        const addNodeSelect = event.target.closest(".node-add-select");
        if (addNodeSelect) {
          const hintId = addNodeSelect.dataset.addNodeHintFor;
          const hintEl = hintId
            ? document.getElementById(hintId)
            : addNodeSelect.closest(".node-add-picker")?.querySelector(".node-add-hint");
          updateAddNodeHint(addNodeSelect, hintEl);
          const submitBtn = addNodeSelect
            .closest(".node-add-picker")
            ?.querySelector("[data-add-node-submit]");
          if (submitBtn) {
            submitBtn.title = UK()?.hintForAddNodeKind(addNodeSelect.value) || "";
          }
          return;
        }

        const simpleField = event.target.closest("[data-simple-condition-field]");
        const simpleValue = event.target.closest("[data-simple-condition-value]");
        if (simpleField || simpleValue) {
          const nodeId =
            simpleField?.dataset.simpleConditionField || simpleValue?.dataset.simpleConditionValue;
          applySimpleCondition(nodeId);
          return;
        }

        const variantFieldPicker = event.target.closest("#node-variant-field-picker");
        if (variantFieldPicker) {
          preferredFieldId = variantFieldPicker.value;
          renderFieldsPanel();
          return;
        }

        const reparentSelect = event.target.closest("[data-reparent-node]");
        if (reparentSelect) {
          const nodeId = reparentSelect.dataset.reparentNode;
          const newParentId = reparentSelect.value || null;
          if (NodeModel.reparentNode(model, nodeId, newParentId)) {
            selectedNodeId = nodeId;
            expandToNode(nodeId);
            notifyChange();
            onStatus("Батьківський вузол оновлено");
          } else {
            onStatus("Неможливо перемістити вузол сюди", true);
            renderAll();
          }
          return;
        }

        const input = event.target.closest("[data-node-prop]");
        if (!input || !selectedNodeId) return;
        const path = input.dataset.nodeProp;
        const value = input.type === "checkbox" ? input.checked : input.value;
        if (applyInspectorValue(selectedNodeId, path, value, input.type)) {
          onModelChange();
          renderTree();
          renderEditorContextStrip();
        }
      },
      true,
    );
  }

  return {
    init({
      treeHost,
      variantsHost,
      inspectorHost,
      fieldsHost,
      shellEl: host,
      previewEl,
      getIsActive: isActiveFn,
      statusFn,
      onModelChange: changeFn,
    }) {
      treeEl = treeHost;
      variantsEl = variantsHost;
      inspectorEl = inspectorHost;
      fieldsEl = fieldsHost;
      shellEl = host;
      workflowHelpEl = document.getElementById("node-workflow-help-body");
      getPreviewEl = () => previewEl;
      getIsActive = isActiveFn || (() => true);
      onStatus = statusFn || (() => {});
      onModelChange = changeFn || (() => {});
      bindEvents(shellEl || treeEl?.closest(".node-editor-shell"));
      bindTreeDragDrop();
      bindPreviewClicks(previewEl);
    },

    setModel(raw) {
      model = NodeModel.cloneModel(raw || NodeModel.emptyModel());
      selectedNodeId = NodeModel.rootNodes(model)[0]?.id || null;
      selectedBlockId = null;
      assignMode = false;
      collapsedIds = new Set();
      activeRulesPage = "structure";
    },

    setRules(raw) {
      this.setModel(raw);
    },

    getModel() {
      return NodeModel.toDocumentModel(model);
    },

    getRules() {
      return this.getModel();
    },

    validateModel() {
      return NodeModel.validateModel(model);
    },

    hasConfiguredRules() {
      return NodeModel.hasConfiguredNodes(model);
    },

    getActiveConditionIds() {
      if (!this.hasConfiguredRules()) return [];
      return NodeModel.collectRequiredFieldIds(model);
    },

    selectNodeByBlockId(blockId) {
      return selectNodeByBlockId(blockId);
    },

    refreshPreview() {
      refreshHighlights();
    },

    deactivate() {
      assignMode = false;
      selectedBlockId = null;
      refreshHighlights();
    },

    backToStructure() {
      navigateToPage("structure");
      renderAll();
    },

    render() {
      renderAll();
    },

    addFieldAsync,
  };
})();
