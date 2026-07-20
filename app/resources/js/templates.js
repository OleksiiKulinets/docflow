/** v5 node templates — exclusive groups and yes/no without legacy domain types. */

const NodeTemplates = (() => {
  const LEGACY_NODE_TYPES = new Set([
    "variant",
    "choice",
    "group",
    "Variant",
    "Choice",
    "Group",
    "optional",
  ]);

  function assertNoLegacyTypes(model) {
    return (model.nodes || []).every((node) => !LEGACY_NODE_TYPES.has(node.type));
  }

  function validateParent(model, parentId) {
    if (!parentId) return true;
    const parent = NodeModel.getNode(model, parentId);
    return Boolean(parent && NodeModel.canHaveChildren(parent));
  }

  function createSectionTemplate(model, { parentId = null, label = "Розділ", exclusive = false, index = null } = {}) {
    if (!validateParent(model, parentId)) return null;

    const node = NodeModel.createNode("section", parentId);
    if (label) node.metadata = { ...(node.metadata || {}), label };
    if (exclusive) node.properties = { behavior: { exclusive: true } };

    return NodeModel.addNode(model, { type: "section", parentId, index, node });
  }

  function createExclusiveChoiceTemplate(
    model,
    { parentId = null, fieldId = null, options = null, fieldLabel = "Вибір", forkLabel = "Варіанти", index = null } = {},
  ) {
    if (!validateParent(model, parentId)) return null;

    let field = fieldId ? NodeModel.getField(model, fieldId) : null;
    if (!field) {
      field = NodeModel.addField(
        model,
        NodeModel.createField({
          type: "choice",
          label: fieldLabel,
          options: options || [
            { value: "a", label: "Варіант А" },
            { value: "b", label: "Варіант Б" },
          ],
        }),
      );
    } else if (field.type !== "choice") {
      return null;
    }

    const branchOptions = options || field.options || [];
    if (!branchOptions.length) return null;

    const fork = NodeModel.addNode(model, {
      type: "section",
      parentId,
      index,
      node: {
        ...NodeModel.createNode("section", parentId),
        properties: { behavior: { exclusive: true } },
        metadata: { label: forkLabel },
      },
    });
    if (!fork) return null;

    branchOptions.forEach((opt) => {
      const section = NodeModel.addNode(model, {
        type: "section",
        parentId: fork.id,
        node: {
          ...NodeModel.createNode("section", fork.id),
          condition: {
            type: "predicate",
            condition_id: field.id,
            operator: "eq",
            value: opt.value,
          },
          metadata: { label: opt.label || opt.value },
        },
      });
      if (!section) return;
      NodeModel.addNode(model, {
        type: "paragraph",
        parentId: section.id,
      });
    });

    return fork;
  }

  function createYesNoTemplate(
    model,
    {
      parentId = null,
      fieldId = null,
      yesBlockIds = [],
      noBlockIds = [],
      fieldLabel = "Поле",
      forkLabel = "Так / Ні",
      index = null,
    } = {},
  ) {
    if (!validateParent(model, parentId)) return null;

    let field = fieldId ? NodeModel.getField(model, fieldId) : null;
    if (!field) {
      field = NodeModel.addField(
        model,
        NodeModel.createField({
          type: "boolean",
          label: fieldLabel,
        }),
      );
    } else if (field.type !== "boolean") {
      return null;
    }

    const fork = NodeModel.addNode(model, {
      type: "section",
      parentId,
      index,
      node: {
        ...NodeModel.createNode("section", parentId),
        properties: { behavior: { exclusive: true } },
        metadata: { label: forkLabel },
      },
    });
    if (!fork) return null;

    const branches = [
      { value: true, label: "Так", blockIds: yesBlockIds },
      { value: false, label: "Ні", blockIds: noBlockIds },
    ];

    branches.forEach((branch) => {
      const section = NodeModel.addNode(model, {
        type: "section",
        parentId: fork.id,
        node: {
          ...NodeModel.createNode("section", fork.id),
          condition: {
            type: "predicate",
            condition_id: field.id,
            operator: "eq",
            value: branch.value,
          },
          metadata: { label: branch.label },
        },
      });
      if (!section) return;

      const blockIds = branch.blockIds || [];
      NodeModel.addNode(model, {
        type: "paragraph",
        parentId: section.id,
        node: {
          ...NodeModel.createNode("paragraph", section.id),
          content: blockIds.length ? { block_ids: [...blockIds] } : null,
        },
      });
    });

    return fork;
  }

  function ensureMarkerFork(model, markerId, { fieldId = null } = {}) {
    const marker = NodeModel.getNode(model, markerId);
    if (!marker || marker.type !== "marker") return null;

    let field = fieldId ? NodeModel.getField(model, fieldId) : null;
    if (!field) {
      const branch = NodeModel.orderedChildren(model, markerId).find(
        (child) => child.type === "section" && child.condition?.type === "predicate",
      );
      if (branch?.condition?.condition_id) {
        field = NodeModel.getField(model, branch.condition.condition_id);
      }
    }
    if (!field) {
      field = NodeModel.addField(
        model,
        NodeModel.createField({
          type: "boolean",
          label: marker.metadata?.label ? `${marker.metadata.label}` : "Маркер",
        }),
      );
    }
    if (field.type !== "boolean") return null;

    const children = NodeModel.orderedChildren(model, markerId);
    let yes = children.find(
      (child) =>
        child.type === "section" &&
        child.condition?.type === "predicate" &&
        child.condition.value === true,
    );
    let no = children.find(
      (child) =>
        child.type === "section" &&
        child.condition?.type === "predicate" &&
        child.condition.value === false,
    );

    if (!yes) {
      yes = NodeModel.addNode(model, {
        type: "section",
        parentId: markerId,
        node: {
          ...NodeModel.createNode("section", markerId),
          condition: {
            type: "predicate",
            condition_id: field.id,
            operator: "eq",
            value: true,
          },
          metadata: { label: "Так" },
        },
      });
      NodeModel.addNode(model, { type: "paragraph", parentId: yes.id });
    }

    if (!no) {
      no = NodeModel.addNode(model, {
        type: "section",
        parentId: markerId,
        node: {
          ...NodeModel.createNode("section", markerId),
          condition: {
            type: "predicate",
            condition_id: field.id,
            operator: "eq",
            value: false,
          },
          metadata: { label: "Ні" },
        },
      });
      NodeModel.addNode(model, { type: "paragraph", parentId: no.id });
    }

    marker.properties = {
      ...(marker.properties || {}),
      behavior: { ...((marker.properties || {}).behavior || {}), marker_mode: "fork" },
    };

    return { marker, yes, no, field };
  }

  function addChoiceBranchToFork(model, forkId) {
    const fork = NodeModel.getNode(model, forkId);
    if (!fork || !NodeModel.isExclusiveSection(fork)) return null;

    const branches = NodeModel.orderedChildren(model, forkId).filter(
      (child) => child.type === "section" && child.condition,
    );
    const fieldId = branches[0]?.condition?.condition_id;
    const field = fieldId ? NodeModel.getField(model, fieldId) : null;
    if (!field || field.type !== "choice") return null;

    const used = new Set(branches.map((branch) => String(branch.condition?.value ?? "")));
    const option = (field.options || []).find((opt) => !used.has(String(opt.value)));
    if (!option) return null;

    const section = NodeModel.addNode(model, {
      type: "section",
      parentId: forkId,
      node: {
        ...NodeModel.createNode("section", forkId),
        condition: {
          type: "predicate",
          condition_id: field.id,
          operator: "eq",
          value: option.value,
        },
        metadata: { label: option.label || option.value },
      },
    });
    if (!section) return null;
    NodeModel.addNode(model, { type: "paragraph", parentId: section.id });
    return section;
  }

  function runSelfTests() {
    const errors = [];
    const assert = (name, ok) => {
      if (!ok) errors.push(name);
    };

    let model = NodeModel.emptyModel();

    const section = createSectionTemplate(model, { label: "Root section" });
    assert("createSectionTemplate", section?.type === "section");
    assert("section template no exclusive", !NodeModel.isExclusiveSection(section));

    const exclusiveSection = createSectionTemplate(model, { parentId: section.id, label: "Fork", exclusive: true });
    assert("createSectionTemplate exclusive", NodeModel.isExclusiveSection(exclusiveSection));

    model = NodeModel.emptyModel();
    const yesNo = createYesNoTemplate(model, { yesBlockIds: ["blk-yes"], noBlockIds: ["blk-no"] });
    assert("createYesNoTemplate", yesNo && NodeModel.isExclusiveSection(yesNo));
    assert("yes/no branches", NodeModel.orderedChildren(model, yesNo.id).length === 2);
    assert("yes/no field created", (model.fields || []).length === 1 && model.fields[0].type === "boolean");
    assert("yes/no validate", NodeModel.validateModel(model).length === 0);
    assert("yes/no no legacy types", assertNoLegacyTypes(model));

    const yesBranch = NodeModel.orderedChildren(model, yesNo.id)[0];
    const yesParagraph = NodeModel.orderedChildren(model, yesBranch.id)[0];
    assert("yes/no block ids", NodeModel.getBlockIds(yesParagraph).includes("blk-yes"));

    model = NodeModel.emptyModel();
    const choice = createExclusiveChoiceTemplate(model, {
      options: [
        { value: "cash", label: "Cash" },
        { value: "credit", label: "Credit" },
      ],
    });
    assert("createExclusiveChoiceTemplate", choice && NodeModel.isExclusiveSection(choice));
    assert("choice branches", NodeModel.orderedChildren(model, choice.id).length === 2);
    assert("choice field type", model.fields[0]?.type === "choice");
    assert("choice validate", NodeModel.validateModel(model).length === 0);
    assert("choice no legacy types", assertNoLegacyTypes(model));

    model = NodeModel.emptyModel();
    const marker = NodeModel.addNode(model, {
      type: "marker",
      parentId: null,
      node: {
        ...NodeModel.createNode("marker", null),
        content: { block_ids: ["blk-m"] },
        metadata: { label: "Instruction" },
      },
    });
    const fork = ensureMarkerFork(model, marker.id);
    assert("ensureMarkerFork", fork && fork.yes && fork.no);
    assert("marker fork branches", NodeModel.orderedChildren(model, marker.id).length >= 2);
    assert("marker fork mode", marker.properties?.behavior?.marker_mode === "fork");
    assert("marker fork validate", NodeModel.validateModel(model).length === 0);

    model = NodeModel.emptyModel();
    const payField = NodeModel.addField(
      model,
      NodeModel.createField({
        type: "choice",
        label: "Payment",
        options: [
          { value: "cash", label: "Cash" },
          { value: "credit", label: "Credit" },
          { value: "wire", label: "Wire" },
        ],
      }),
    );
    payField.id = "pay";
    const choiceFork = NodeTemplates.createExclusiveChoiceTemplate(model, {
      fieldId: "pay",
      options: payField.options.slice(0, 2),
    });
    const extraBranch = NodeTemplates.addChoiceBranchToFork(model, choiceFork.id);
    assert("addChoiceBranchToFork", extraBranch?.condition?.value === "wire");
    assert("choice branch count", NodeModel.orderedChildren(model, choiceFork.id).length === 3);

    const saved = NodeModel.toDocumentModel(model);
    assert("template roundtrip", NodeModel.validateModel(saved).length === 0);

    if (errors.length) {
      console.error("NodeTemplates self-test failures:", errors);
      return false;
    }
    return true;
  }

  return {
    createSectionTemplate,
    createExclusiveChoiceTemplate,
    createYesNoTemplate,
    ensureMarkerFork,
    addChoiceBranchToFork,
    assertNoLegacyTypes,
    runSelfTests,
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.NodeTemplates = NodeTemplates;
}

if (typeof process !== "undefined" && process.argv?.includes("--self-test")) {
  if (typeof NodeModel === "undefined") {
    require("./node-model.js");
  }
  const ok = NodeTemplates.runSelfTests();
  process.exit(ok ? 0 : 1);
}
