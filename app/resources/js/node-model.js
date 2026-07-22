/** Direct v5 document_model layer — nodes[], fields[], CRUD without UI adapter. */

const NodeModel = (() => {
  const SCHEMA = 5;
  const CONTAINER_TYPES = new Set(["section", "marker"]);
  const LEAF_TYPES = new Set(["paragraph", "table", "text", "placeholder"]);

  function newId(prefix = "node") {
    return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function emptyModel() {
    return { schema_version: SCHEMA, fields: [], nodes: [], meta: {} };
  }

  function normalizeField(field) {
    if (!field || typeof field !== "object") return null;
    const type = field.type === "choice" ? "choice" : "boolean";
    const normalized = {
      id: String(field.id || "").trim() || newId("field"),
      label: String(field.label || "").trim(),
      type,
    };
    if (type === "choice") {
      normalized.options = (field.options || [])
        .map((opt) => ({
          value: String(opt?.value ?? "").trim(),
          label: String(opt?.label ?? opt?.value ?? "").trim(),
        }))
        .filter((opt) => opt.value);
    }
    return normalized;
  }

  function normalizeModel(raw) {
    if (!raw || typeof raw !== "object") return emptyModel();
    const nodes = (raw.nodes || []).map((node) => ({
      id: node.id || newId("node"),
      type: node.type || "section",
      parent_id: node.parent_id ?? null,
      children_order: [...(node.children_order || [])],
      condition: node.condition ?? null,
      content: node.content ? { ...node.content, block_ids: [...(node.content.block_ids || [])] } : null,
      properties: { ...(node.properties || {}) },
      metadata: { ...(node.metadata || {}) },
    }));
    return {
      schema_version: SCHEMA,
      fields: (raw.fields || raw.conditions || []).map(normalizeField).filter(Boolean),
      nodes,
      meta: { ...(raw.meta || {}) },
    };
  }

  function cloneModel(raw) {
    return JSON.parse(JSON.stringify(normalizeModel(raw)));
  }

  function nodeMap(model) {
    const map = new Map();
    (model.nodes || []).forEach((node) => {
      if (node?.id) map.set(node.id, node);
    });
    return map;
  }

  function rootNodes(model) {
    const map = nodeMap(model);
    return (model.nodes || []).filter((node) => !node.parent_id && map.has(node.id));
  }

  function orderedChildren(model, nodeId) {
    const node = getNode(model, nodeId);
    if (!node) return [];
    const map = nodeMap(model);
    return (node.children_order || []).map((id) => map.get(id)).filter(Boolean);
  }

  function getNode(model, nodeId) {
    return nodeMap(model).get(nodeId) || null;
  }

  function createField({ type = "boolean", label = "", options = null } = {}) {
    return normalizeField({
      id: newId("field"),
      label,
      type,
      options:
        options ??
        (type === "choice"
          ? [
              { value: "yes", label: "Так" },
              { value: "no", label: "Ні" },
            ]
          : undefined),
    });
  }

  function getField(model, fieldId) {
    return (model.fields || []).find((field) => field.id === fieldId) || null;
  }

  function addField(model, field) {
    const normalized = normalizeField(field || createField());
    if (!normalized) return null;
    model.fields = model.fields || [];
    model.fields.push(normalized);
    return normalized;
  }

  function updateField(model, fieldId, patch) {
    const field = getField(model, fieldId);
    if (!field) return false;
    const merged = normalizeField({ ...field, ...patch, id: field.id });
    Object.assign(field, merged);
    if (field.type === "boolean") delete field.options;
    return true;
  }

  function deleteField(model, fieldId) {
    const before = model.fields?.length || 0;
    model.fields = (model.fields || []).filter((field) => field.id !== fieldId);
    return model.fields.length < before;
  }

  function validateConditionRefs(condition, fieldIds, nodeId, errors) {
    if (!condition) return;
    if (condition.type === "predicate") {
      const conditionId = condition.condition_id;
      if (conditionId && !fieldIds.has(conditionId)) {
        errors.push(`Node ${nodeId} references unknown field ${conditionId}`);
      }
      return;
    }
    if (condition.type === "not") {
      validateConditionRefs(condition.item, fieldIds, nodeId, errors);
      return;
    }
    if (condition.type === "and" || condition.type === "or") {
      (condition.items || []).forEach((item) => validateConditionRefs(item, fieldIds, nodeId, errors));
    }
  }

  function validateModel(model) {
    const normalized = syncChildrenOrder(normalizeModel(model));
    const errors = [];
    const fieldIds = new Set();

    (normalized.fields || []).forEach((field, index) => {
      if (!field.id) {
        errors.push(`Field at index ${index} missing id`);
        return;
      }
      if (fieldIds.has(field.id)) errors.push(`Duplicate field id: ${field.id}`);
      fieldIds.add(field.id);
      if (!field.label) errors.push(`Field ${field.id} missing label`);
      if (field.type === "choice") {
        if (!field.options?.length) {
          errors.push(`Field ${field.id} choice requires options`);
        } else {
          const optionValues = new Set();
          field.options.forEach((opt, optIndex) => {
            if (!opt.value) errors.push(`Field ${field.id} option ${optIndex} missing value`);
            if (optionValues.has(opt.value)) {
              errors.push(`Field ${field.id} duplicate option value ${opt.value}`);
            }
            optionValues.add(opt.value);
          });
        }
      } else if (field.type !== "boolean") {
        errors.push(`Field ${field.id} has unsupported type ${field.type}`);
      }
    });

    (normalized.nodes || []).forEach((node) => {
      const nodeId = node.id || "?";
      if (!node.id) errors.push("Node missing id");
      validateConditionRefs(node.condition, fieldIds, nodeId, errors);
    });

    errors.push(...validateTreeStructure(normalized));

    return errors;
  }

  function canHaveChildren(node) {
    return CONTAINER_TYPES.has(node?.type);
  }

  function isLeafType(type) {
    return LEAF_TYPES.has(type);
  }

  function rootNodeIds(model) {
    return (model.nodes || []).filter((node) => !node.parent_id).map((node) => node.id);
  }

  function applyRootOrder(model, rootIds) {
    const map = nodeMap(model);
    const nonRoots = (model.nodes || []).filter((node) => node.parent_id);
    model.nodes = rootIds.map((id) => map.get(id)).filter(Boolean).concat(nonRoots);
  }

  function getSiblingContext(model, nodeId) {
    const node = getNode(model, nodeId);
    if (!node) return null;
    if (!node.parent_id) {
      const siblings = rootNodeIds(model);
      return { parent: null, siblings, index: siblings.indexOf(nodeId) };
    }
    const parent = getNode(model, node.parent_id);
    if (!parent) return null;
    return { parent, siblings: [...parent.children_order], index: parent.children_order.indexOf(nodeId) };
  }

  function syncChildrenOrder(model) {
    (model.nodes || []).forEach((node) => {
      if (!canHaveChildren(node)) {
        node.children_order = [];
        return;
      }
      const actual = (model.nodes || []).filter((child) => child.parent_id === node.id).map((child) => child.id);
      const order = (node.children_order || []).filter((id) => actual.includes(id));
      actual.forEach((id) => {
        if (!order.includes(id)) order.push(id);
      });
      node.children_order = order;
    });
    return model;
  }

  function validateTreeStructure(model) {
    const normalized = normalizeModel(model);
    const errors = [];
    const map = nodeMap(normalized);

    (normalized.nodes || []).forEach((node) => {
      const nodeId = node.id;
      if (!nodeId) return;

      if (!canHaveChildren(node) && (node.children_order || []).length) {
        errors.push(`Leaf node ${nodeId} cannot have children`);
      }

      if (node.parent_id) {
        if (node.parent_id === nodeId) {
          errors.push(`Node ${nodeId} is its own parent`);
        }
        let cursor = node.parent_id;
        const seen = new Set([nodeId]);
        while (cursor) {
          if (seen.has(cursor)) {
            errors.push(`Cycle detected at node ${nodeId}`);
            break;
          }
          seen.add(cursor);
          cursor = map.get(cursor)?.parent_id;
        }
        const parent = map.get(node.parent_id);
        if (!parent) {
          errors.push(`Node ${nodeId} references missing parent ${node.parent_id}`);
        } else if (!canHaveChildren(parent)) {
          errors.push(`Leaf node ${parent.id} cannot have children`);
        } else if (!(parent.children_order || []).includes(nodeId)) {
          errors.push(`Node ${nodeId} missing from parent ${parent.id} children_order`);
        }
      }

      (node.children_order || []).forEach((childId) => {
        const child = map.get(childId);
        if (!child) {
          errors.push(`Node ${nodeId} references missing child ${childId}`);
          return;
        }
        if (child.parent_id !== nodeId) {
          errors.push(`Child ${childId} parent mismatch for node ${nodeId}`);
        }
      });
    });

    return errors;
  }

  function cloneSubtreeNodes(model, nodeId) {
    const source = getNode(model, nodeId);
    if (!source) return null;

    const nodesToClone = [];
    (function collect(id) {
      const current = getNode(model, id);
      if (!current) return;
      nodesToClone.push(current);
      (current.children_order || []).forEach(collect);
    })(nodeId);

    const idMap = new Map(nodesToClone.map((node) => [node.id, newId("node")]));
    const newIds = new Set(idMap.values());

    for (const orig of nodesToClone) {
      const copy = JSON.parse(JSON.stringify(orig));
      copy.id = idMap.get(orig.id);
      copy.parent_id = orig.parent_id ? idMap.get(orig.parent_id) : null;
      copy.children_order = (orig.children_order || []).map((childId) => idMap.get(childId)).filter(Boolean);
      model.nodes.push(copy);
    }

    return { rootId: idMap.get(nodeId), newIds, sourceParentId: source.parent_id };
  }

  function rollbackNodes(model, nodeIds) {
    model.nodes = (model.nodes || []).filter((node) => !nodeIds.has(node.id));
  }

  function duplicateNode(model, nodeId, options = {}) {
    const cloned = cloneSubtreeNodes(model, nodeId);
    if (!cloned) return null;

    const { rootId, newIds, sourceParentId } = cloned;
    const rootCopy = getNode(model, rootId);
    const targetParentId = options.parentId !== undefined ? options.parentId : sourceParentId;

    if (targetParentId) {
      const parent = getNode(model, targetParentId);
      if (!parent || !canHaveChildren(parent)) {
        rollbackNodes(model, newIds);
        return null;
      }
      rootCopy.parent_id = targetParentId;
      const siblings = parent.children_order || [];
      const sourceIndex = siblings.indexOf(nodeId);
      const insertAt =
        options.index != null
          ? Math.max(0, Math.min(options.index, siblings.length))
          : sourceIndex >= 0
            ? sourceIndex + 1
            : siblings.length;
      siblings.splice(insertAt, 0, rootId);
      parent.children_order = siblings;
    } else {
      rootCopy.parent_id = null;
      const roots = rootNodeIds(model).filter((id) => id !== rootId);
      const sourceRootIndex = roots.indexOf(nodeId);
      const insertAt = sourceRootIndex >= 0 ? sourceRootIndex + 1 : roots.length;
      roots.splice(insertAt, 0, rootId);
      applyRootOrder(model, roots);
    }

    syncChildrenOrder(model);
    return getNode(model, rootId);
  }

  function deleteSubtree(model, nodeId) {
    if (!deleteNode(model, nodeId)) return false;
    syncChildrenOrder(model);
    return true;
  }

  function moveNodeUp(model, nodeId) {
    const ctx = getSiblingContext(model, nodeId);
    if (!ctx || ctx.index <= 0) return false;

    if (ctx.parent) {
      const order = ctx.parent.children_order;
      [order[ctx.index - 1], order[ctx.index]] = [order[ctx.index], order[ctx.index - 1]];
      return true;
    }

    const roots = [...ctx.siblings];
    [roots[ctx.index - 1], roots[ctx.index]] = [roots[ctx.index], roots[ctx.index - 1]];
    applyRootOrder(model, roots);
    return true;
  }

  function moveNodeDown(model, nodeId) {
    const ctx = getSiblingContext(model, nodeId);
    if (!ctx || ctx.index < 0 || ctx.index >= ctx.siblings.length - 1) return false;

    if (ctx.parent) {
      const order = ctx.parent.children_order;
      [order[ctx.index + 1], order[ctx.index]] = [order[ctx.index], order[ctx.index + 1]];
      return true;
    }

    const roots = [...ctx.siblings];
    [roots[ctx.index + 1], roots[ctx.index]] = [roots[ctx.index], roots[ctx.index + 1]];
    applyRootOrder(model, roots);
    return true;
  }

  function reparentNode(model, nodeId, newParentId, index = null) {
    const node = getNode(model, nodeId);
    if (!node) return false;

    const parentId = newParentId || null;
    if (parentId) {
      const parent = getNode(model, parentId);
      if (!parent || !canHaveChildren(parent)) return false;
      if (parentId === nodeId || isDescendant(model, nodeId, parentId)) return false;
    }

    if (!moveNode(model, nodeId, parentId, index)) return false;
    syncChildrenOrder(model);
    return true;
  }

  function canMoveNodeUp(model, nodeId) {
    const ctx = getSiblingContext(model, nodeId);
    return Boolean(ctx && ctx.index > 0);
  }

  function canMoveNodeDown(model, nodeId) {
    const ctx = getSiblingContext(model, nodeId);
    return Boolean(ctx && ctx.index >= 0 && ctx.index < ctx.siblings.length - 1);
  }

  function listReparentTargets(model, nodeId) {
    const excluded = new Set();
    (function collect(id) {
      excluded.add(id);
      orderedChildren(model, id).forEach((child) => collect(child.id));
    })(nodeId);

    const targets = [{ id: "", label: "(root level)" }];
    (model.nodes || []).forEach((node) => {
      if (excluded.has(node.id)) return;
      if (!canHaveChildren(node)) return;
      targets.push({ id: node.id, label: `${node.type}: ${nodeLabel(node)}` });
    });
    return targets;
  }

  function createNode(type, parentId = null) {
    return {
      id: newId("node"),
      type: type || "section",
      parent_id: parentId,
      children_order: [],
      condition: null,
      content: null,
      properties: {},
      metadata: {},
    };
  }

  function isDescendant(model, ancestorId, nodeId) {
    let cursor = nodeId;
    const map = nodeMap(model);
    while (cursor) {
      if (cursor === ancestorId) return true;
      cursor = map.get(cursor)?.parent_id;
    }
    return false;
  }

  function siblingInsertIndex(model, dragNodeId, targetNodeId, position) {
    const target = getNode(model, targetNodeId);
    if (!target || (position !== "before" && position !== "after")) return null;

    const parentId = target.parent_id || null;
    const siblings = parentId
      ? [...(getNode(model, parentId)?.children_order || [])]
      : [...rootNodeIds(model)];
    const filtered = siblings.filter((id) => id !== dragNodeId);
    const targetIdx = filtered.indexOf(targetNodeId);
    if (targetIdx < 0) return null;

    return {
      parentId,
      index: position === "before" ? targetIdx : targetIdx + 1,
    };
  }

  function resolveDropPosition(clientY, rowRect, targetNode) {
    if (!rowRect || !targetNode) return null;
    const height = rowRect.height || 1;
    const ratio = (clientY - rowRect.top) / height;
    if (canHaveChildren(targetNode)) {
      if (ratio < 0.25) return "before";
      if (ratio > 0.75) return "after";
      return "inside";
    }
    return ratio < 0.5 ? "before" : "after";
  }

  function canDropNode(model, dragNodeId, targetNodeId, position) {
    if (!dragNodeId || !targetNodeId || dragNodeId === targetNodeId) return false;
    if (!getNode(model, dragNodeId) || !getNode(model, targetNodeId)) return false;
    if (isDescendant(model, dragNodeId, targetNodeId)) return false;

    if (position === "inside") {
      return canHaveChildren(getNode(model, targetNodeId));
    }
    if (position === "before" || position === "after") {
      const target = getNode(model, targetNodeId);
      if (target.parent_id) {
        const parent = getNode(model, target.parent_id);
        if (!parent || !canHaveChildren(parent)) return false;
      }
      return siblingInsertIndex(model, dragNodeId, targetNodeId, position) !== null;
    }
    return false;
  }

  function applyTreeDrop(model, dragNodeId, targetNodeId, position) {
    if (!canDropNode(model, dragNodeId, targetNodeId, position)) return false;

    let ok = false;
    if (position === "inside") {
      const target = getNode(model, targetNodeId);
      const index = (target.children_order || []).filter((id) => id !== dragNodeId).length;
      ok = reparentNode(model, dragNodeId, targetNodeId, index);
    } else {
      const ctx = siblingInsertIndex(model, dragNodeId, targetNodeId, position);
      if (!ctx) return false;

      if (!ctx.parentId) {
        if (!moveNode(model, dragNodeId, null)) return false;
        const roots = rootNodeIds(model).filter((id) => id !== dragNodeId);
        const targetIdx = roots.indexOf(targetNodeId);
        if (targetIdx < 0) return false;
        roots.splice(ctx.index, 0, dragNodeId);
        applyRootOrder(model, roots);
        ok = true;
      } else {
        ok = reparentNode(model, dragNodeId, ctx.parentId, ctx.index);
      }
    }

    if (!ok) return false;
    syncChildrenOrder(model);
    return validateTreeStructure(model).length === 0;
  }

  function addNode(model, { type, parentId = null, index = null, node = null } = {}) {
    const created = node ? cloneModel({ nodes: [node], fields: [], meta: {} }).nodes[0] : createNode(type, parentId);
    if (!created.id) created.id = newId("node");
    created.parent_id = parentId;
    created.children_order = [...(created.children_order || [])];
    model.nodes.push(created);

    if (parentId) {
      const parent = getNode(model, parentId);
      if (!parent || !canHaveChildren(parent)) return null;
      parent.children_order = parent.children_order || [];
      const at = index == null ? parent.children_order.length : Math.max(0, Math.min(index, parent.children_order.length));
      parent.children_order.splice(at, 0, created.id);
    }

    syncChildrenOrder(model);
    return created;
  }

  function deleteNode(model, nodeId) {
    const map = nodeMap(model);
    const node = map.get(nodeId);
    if (!node) return false;

    const removeIds = new Set();
    function collect(id) {
      removeIds.add(id);
      const current = map.get(id);
      (current?.children_order || []).forEach(collect);
    }
    collect(nodeId);

    if (node.parent_id) {
      const parent = map.get(node.parent_id);
      if (parent) {
        parent.children_order = (parent.children_order || []).filter((id) => id !== nodeId);
      }
    }

    model.nodes = (model.nodes || []).filter((item) => !removeIds.has(item.id));
    return true;
  }

  function moveNode(model, nodeId, newParentId, index = null) {
    const map = nodeMap(model);
    const node = map.get(nodeId);
    if (!node) return false;
    if (newParentId && (newParentId === nodeId || isDescendant(model, nodeId, newParentId))) {
      return false;
    }

    if (node.parent_id) {
      const oldParent = map.get(node.parent_id);
      if (oldParent) {
        oldParent.children_order = (oldParent.children_order || []).filter((id) => id !== nodeId);
      }
    }

    node.parent_id = newParentId || null;

    if (newParentId) {
      const parent = map.get(newParentId);
      if (!parent || !canHaveChildren(parent)) return false;
      parent.children_order = parent.children_order || [];
      const at = index == null ? parent.children_order.length : Math.max(0, Math.min(index, parent.children_order.length));
      parent.children_order.splice(at, 0, nodeId);
    }

    syncChildrenOrder(model);
    return true;
  }

  function setAtPath(target, path, value) {
    const parts = path.split(".");
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const key = parts[i];
      if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
      cursor = cursor[key];
    }
    cursor[parts[parts.length - 1]] = value;
  }

  function updateNodeProperty(model, nodeId, path, value) {
    const node = getNode(model, nodeId);
    if (!node) return false;

    if (path === "condition") {
      node.condition = value;
      return true;
    }
    if (path === "content.block_ids") {
      node.content = { ...(node.content || {}), block_ids: [...value] };
      if (!node.content.block_ids.length) node.content = null;
      return true;
    }
    if (path.startsWith("metadata.")) {
      node.metadata = { ...(node.metadata || {}) };
      setAtPath(node.metadata, path.slice("metadata.".length), value);
      return true;
    }
    if (path.startsWith("properties.")) {
      node.properties = { ...(node.properties || {}) };
      setAtPath(node.properties, path.slice("properties.".length), value);
      return true;
    }
    return false;
  }

  function nodeLabel(node) {
    if (!node) return "—";
    return node.metadata?.label || node.metadata?.general?.label || node.id;
  }

  function nodeBehavior(node) {
    return node?.properties?.behavior || {};
  }

  function getBlockIds(node) {
    return [...(node?.content?.block_ids || [])];
  }

  function supportsBlockContent(node) {
    return ["paragraph", "table", "marker"].includes(node?.type);
  }

  function setBlockIds(model, nodeId, blockIds) {
    return updateNodeProperty(model, nodeId, "content.block_ids", [...blockIds]);
  }

  function addBlockToNode(model, nodeId, blockId) {
    if (!blockId) return false;
    const node = getNode(model, nodeId);
    if (!node || !supportsBlockContent(node)) return false;
    const ids = getBlockIds(node);
    if (ids.includes(blockId)) return true;
    return setBlockIds(model, nodeId, [...ids, blockId]);
  }

  function removeBlockFromNode(model, nodeId, blockId) {
    const node = getNode(model, nodeId);
    if (!node) return false;
    return setBlockIds(
      model,
      nodeId,
      getBlockIds(node).filter((id) => id !== blockId),
    );
  }

  function findNodeByBlockId(model, blockId) {
    if (!blockId) return null;
    return (model.nodes || []).find((node) => getBlockIds(node).includes(blockId)) || null;
  }

  function collectAssignedBlockMap(model) {
    const map = new Map();
    (model.nodes || []).forEach((node) => {
      getBlockIds(node).forEach((blockId) => map.set(blockId, node.id));
    });
    return map;
  }

  function isExclusiveSection(node) {
    return node?.type === "section" && Boolean(nodeBehavior(node).exclusive);
  }

  function collectFieldIdsFromCondition(condition, ids) {
    if (!condition) return;
    if (condition.type === "predicate" && condition.condition_id) {
      ids.add(condition.condition_id);
      return;
    }
    if (condition.type === "not") {
      collectFieldIdsFromCondition(condition.item, ids);
      return;
    }
    (condition.items || []).forEach((item) => collectFieldIdsFromCondition(item, ids));
  }

  function collectRequiredFieldIds(model) {
    const ids = new Set();
    (model.nodes || []).forEach((node) => collectFieldIdsFromCondition(node.condition, ids));
    return [...ids];
  }

  function evaluateV5Condition(condition, values) {
    if (!condition) return true;
    if (condition.type === "predicate") {
      const conditionId = condition.condition_id;
      if (!conditionId || values[conditionId] === undefined || values[conditionId] === null) {
        return false;
      }
      const active = values[conditionId];
      const operator = condition.operator || "eq";
      const expected = condition.value;
      if (operator === "eq") return active === expected;
      if (operator === "neq") return active !== expected;
      return false;
    }
    if (condition.type === "not") {
      return !evaluateV5Condition(condition.item, values);
    }
    if (condition.type === "and") {
      const items = condition.items || [];
      return Boolean(items.length) && items.every((item) => evaluateV5Condition(item, values));
    }
    if (condition.type === "or") {
      return (condition.items || []).some((item) => evaluateV5Condition(item, values));
    }
    return false;
  }

  function isVariantForkNode(model, node) {
    if (!node) return false;
    const branches = orderedChildren(model, node.id).filter(
      (child) => child.type === "section" && child.condition,
    );
    if (branches.length < 2) return false;
    if (isExclusiveSection(node)) return true;
    return node.type === "marker";
  }

  function exclusiveForkFieldIds(model, forkNode) {
    const ids = new Set();
    orderedChildren(model, forkNode.id)
      .filter((child) => child.type === "section" && child.condition)
      .forEach((child) => collectFieldIdsFromCondition(child.condition, ids));
    return [...ids];
  }

  /** Fields to show in preview — parent first, nested only when parent branch is active. */
  function collectReachableFieldIds(model, values = {}) {
    const reachable = [];

    function walk(node) {
      if (node.condition && !evaluateV5Condition(node.condition, values)) {
        return;
      }

      if (isVariantForkNode(model, node)) {
        const fieldIds = exclusiveForkFieldIds(model, node);
        const unset = fieldIds.filter(
          (fieldId) => values[fieldId] === undefined || values[fieldId] === null,
        );
        unset.forEach((fieldId) => {
          if (!reachable.includes(fieldId)) reachable.push(fieldId);
        });
        if (unset.length) return;

        orderedChildren(model, node.id)
          .filter((child) => child.type === "section" && child.condition)
          .forEach((branch) => {
            if (evaluateV5Condition(branch.condition, values)) walk(branch);
          });
        return;
      }

      orderedChildren(model, node.id).forEach((child) => walk(child));
    }

    rootNodes(model).forEach((root) => walk(root));
    return reachable;
  }

  function nodeIsConfigured(model, node) {
    if (!node) return false;

    if (isExclusiveSection(node)) {
      const branches = orderedChildren(model, node.id).filter(
        (child) => child.type === "section" && child.condition,
      );
      if (branches.length >= 2) {
        return branches.every((branch) => nodeIsConfigured(model, branch));
      }
    }

    if ((node.content?.block_ids || []).length > 0) return true;

    const children = orderedChildren(model, node.id);
    if (!children.length) return false;
    return children.some((child) => nodeIsConfigured(model, child));
  }

  function hasConfiguredNodes(model) {
    const roots = rootNodes(model);
    if (!roots.length) return false;
    return roots.some((root) => nodeIsConfigured(model, root));
  }

  function toDocumentModel(model) {
    return cloneModel(model);
  }

  function runSelfTests() {
    const errors = [];

    function assert(name, condition) {
      if (!condition) errors.push(name);
    }

    let model = emptyModel();
    const root = addNode(model, { type: "section" });
    const child = addNode(model, { type: "paragraph", parentId: root.id });
    assert("addNode attaches child", getNode(model, child.id)?.parent_id === root.id);
    assert("children_order updated", root.children_order.includes(child.id));

    moveNode(model, child.id, null);
    assert("moveNode to root clears parent", getNode(model, child.id)?.parent_id === null);

    moveNode(model, child.id, root.id, 0);
    assert("moveNode under parent", getNode(model, child.id)?.parent_id === root.id);

    updateNodeProperty(model, root.id, "metadata.label", "Root");
    assert("update metadata.label", nodeLabel(root) === "Root");

    updateNodeProperty(model, root.id, "properties.behavior.exclusive", true);
    assert("update exclusive", isExclusiveSection(root));

    updateNodeProperty(model, child.id, "content.block_ids", ["blk-1", "blk-2"]);
    assert("update block_ids", getBlockIds(getNode(model, child.id)).length === 2);

    assert("addBlockToNode", addBlockToNode(model, child.id, "blk-3"));
    assert("addBlockToNode dedupe", getBlockIds(getNode(model, child.id)).length === 3);
    assert("findNodeByBlockId", findNodeByBlockId(model, "blk-2")?.id === child.id);
    removeBlockFromNode(model, child.id, "blk-1");
    assert("removeBlockFromNode", !getBlockIds(getNode(model, child.id)).includes("blk-1"));

    const exported = toDocumentModel(model);
    assert("content roundtrip", exported.nodes.find((n) => n.id === child.id)?.content?.block_ids?.length === 2);

    updateNodeProperty(model, child.id, "condition", {
      type: "predicate",
      condition_id: "f1",
      operator: "eq",
      value: true,
    });
    assert("collect field ids", collectRequiredFieldIds(model).includes("f1"));

    const boolField = addField(model, createField({ type: "boolean", label: "Borrower" }));
    const choiceField = addField(
      model,
      createField({
        type: "choice",
        label: "Product",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    );
    assert("addField boolean", boolField?.type === "boolean");
    assert("addField choice options", choiceField?.options?.length === 2);
    updateField(model, boolField.id, { label: "Borrower employee" });
    assert("updateField label", getField(model, boolField.id)?.label === "Borrower employee");

    updateNodeProperty(model, child.id, "condition", {
      type: "and",
      items: [
        { type: "predicate", condition_id: boolField.id, operator: "eq", value: true },
        { type: "predicate", condition_id: choiceField.id, operator: "eq", value: "a" },
      ],
    });
    assert("validateModel ok", validateModel(model).length === 0);

    updateNodeProperty(model, child.id, "condition", {
      type: "predicate",
      condition_id: "missing-field",
      operator: "eq",
      value: true,
    });
    assert("validateModel unknown field", validateModel(model).some((e) => e.includes("unknown field")));

    deleteField(model, choiceField.id);
    assert("deleteField", !getField(model, choiceField.id));

    const deep = addNode(model, { type: "section", parentId: root.id });
    const mid = addNode(model, { type: "section", parentId: deep.id });
    addNode(model, { type: "paragraph", parentId: mid.id });
    const dup = duplicateNode(model, deep.id);
    assert("duplicateNode deep tree", dup && getNode(model, dup.id)?.type === "section");
    assert("duplicateNode descendants", orderedChildren(model, dup.id).length === 1);
    assert("duplicateNode new ids", dup.id !== deep.id);

    assert("moveNodeDown", moveNodeDown(model, child.id));
    assert("moveNodeUp", moveNodeUp(model, child.id));
    assert("reparentNode", reparentNode(model, child.id, mid.id));
    assert("reparent rejects cycle", !reparentNode(model, deep.id, mid.id));

    deleteSubtree(model, dup.id);
    assert("deleteSubtree", !getNode(model, dup.id));

    deleteSubtree(model, root.id);
    assert("deleteSubtree root", model.nodes.length === 0);

    model = emptyModel();
    const r1 = addNode(model, { type: "section" });
    const r2 = addNode(model, { type: "section" });
    assert("root reorder up", moveNodeUp(model, r2.id));
    assert("root order", rootNodeIds(model)[0] === r2.id);
    const saved = toDocumentModel(model);
    assert("tree ops roundtrip", validateModel(saved).length === 0);

    model = emptyModel();
    const secA = addNode(model, { type: "section", node: createNode("section") });
    secA.id = "sec-a";
    const secB = addNode(model, { type: "section", node: createNode("section") });
    secB.id = "sec-b";
    const pA = addNode(model, { type: "paragraph", parentId: secA.id, node: createNode("paragraph", secA.id) });
    pA.id = "p-a";
    const pB = addNode(model, { type: "paragraph", parentId: secA.id, node: createNode("paragraph", secA.id) });
    pB.id = "p-b";
    const pC = addNode(model, { type: "paragraph", parentId: secB.id, node: createNode("paragraph", secB.id) });
    pC.id = "p-c";

    assert("applyTreeDrop before sibling", applyTreeDrop(model, pB.id, pA.id, "before"));
    assert("drop before order", getNode(model, secA.id).children_order[0] === pB.id);
    assert("applyTreeDrop after sibling", applyTreeDrop(model, pB.id, pA.id, "after"));
    assert("drop after order", getNode(model, secA.id).children_order.indexOf(pB.id) === 1);
    assert("applyTreeDrop inside container", applyTreeDrop(model, pC.id, secA.id, "inside"));
    assert("drop inside parent", getNode(model, pC.id).parent_id === secA.id);
    assert("resolveDropPosition inside", resolveDropPosition(50, { top: 0, height: 100 }, secA) === "inside");
    assert("resolveDropPosition before leaf", resolveDropPosition(10, { top: 0, height: 100 }, pA) === "before");
    assert("canDropNode rejects leaf inside", !canDropNode(model, pC.id, pA.id, "inside"));
    assert("canDropNode rejects descendant", !canDropNode(model, secA.id, pA.id, "inside"));
    assert("applyTreeDrop rejects invalid", !applyTreeDrop(model, secA.id, pA.id, "inside"));
    assert("validate after tree drop", validateTreeStructure(model).length === 0);

    if (errors.length) {
      console.error("NodeModel self-test failures:", errors);
      return false;
    }
    return true;
  }

  return {
    SCHEMA,
    emptyModel,
    normalizeModel,
    cloneModel,
    nodeMap,
    rootNodes,
    orderedChildren,
    getNode,
    createNode,
    createField,
    getField,
    addField,
    updateField,
    deleteField,
    validateModel,
    validateTreeStructure,
    canHaveChildren,
    canMoveNodeUp,
    canMoveNodeDown,
    listReparentTargets,
    syncChildrenOrder,
    addNode,
    deleteNode,
    deleteSubtree,
    duplicateNode,
    moveNodeUp,
    moveNodeDown,
    reparentNode,
    moveNode,
    canDropNode,
    applyTreeDrop,
    resolveDropPosition,
    siblingInsertIndex,
    updateNodeProperty,
    nodeLabel,
    nodeBehavior,
    getBlockIds,
    supportsBlockContent,
    setBlockIds,
    addBlockToNode,
    removeBlockFromNode,
    findNodeByBlockId,
    collectAssignedBlockMap,
    isExclusiveSection,
    collectRequiredFieldIds,
    collectReachableFieldIds,
    evaluateV5Condition,
    isVariantForkNode,
    hasConfiguredNodes,
    toDocumentModel,
    newId,
    runSelfTests,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.NodeModel = NodeModel;
}

if (typeof process !== "undefined" && process.argv?.includes("--self-test")) {
  const ok = NodeModel.runSelfTests();
  process.exit(ok ? 0 : 1);
}
