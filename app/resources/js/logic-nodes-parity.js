/** v5 workflow parity checks (CLI: node logic-nodes-parity.js --parity-test). */

const LogicNodesParity = (() => {
  const LEGACY_NODE_TYPES = new Set([
    "variant",
    "choice",
    "group",
    "Variant",
    "Choice",
    "Group",
    "optional",
  ]);

  function assert(name, ok, errors) {
    if (!ok) errors.push(name);
  }

  function assertNoLegacyNodeTypes(model) {
    return (model.nodes || []).every((node) => !LEGACY_NODE_TYPES.has(node.type));
  }

  function assertValidV5(model, errors, label) {
    const validationErrors = NodeModel.validateModel(model);
    assert(`${label} validates`, validationErrors.length === 0, errors);
    assert(`${label} schema`, model.schema_version === 5, errors);
    assert(`${label} uses fields key`, Array.isArray(model.fields), errors);
    assert(`${label} no legacy node types`, assertNoLegacyNodeTypes(model), errors);
  }

  function buildYesNoV5() {
    return {
      schema_version: 5,
      fields: [{ id: "f1", label: "Borrower", type: "boolean" }],
      nodes: [
        {
          id: "fork",
          type: "section",
          parent_id: null,
          children_order: ["yes", "no"],
          condition: null,
          content: null,
          properties: { behavior: { exclusive: true } },
          metadata: { label: "Так / Ні" },
        },
        {
          id: "yes",
          type: "section",
          parent_id: "fork",
          children_order: ["p-yes"],
          condition: { type: "predicate", condition_id: "f1", operator: "eq", value: true },
          content: null,
          properties: {},
          metadata: { label: "Так" },
        },
        {
          id: "no",
          type: "section",
          parent_id: "fork",
          children_order: ["p-no"],
          condition: { type: "predicate", condition_id: "f1", operator: "eq", value: false },
          content: null,
          properties: {},
          metadata: { label: "Ні" },
        },
        {
          id: "p-yes",
          type: "paragraph",
          parent_id: "yes",
          children_order: [],
          condition: null,
          content: { block_ids: ["blk-y"] },
          properties: {},
          metadata: {},
        },
        {
          id: "p-no",
          type: "paragraph",
          parent_id: "no",
          children_order: [],
          condition: null,
          content: { block_ids: ["blk-n"] },
          properties: {},
          metadata: {},
        },
      ],
      meta: {},
    };
  }

  function buildChoiceV5() {
    return {
      schema_version: 5,
      fields: [
        {
          id: "pay",
          label: "Payment",
          type: "choice",
          options: [
            { value: "cash", label: "Cash" },
            { value: "credit", label: "Credit" },
          ],
        },
      ],
      nodes: [
        {
          id: "fork",
          type: "section",
          parent_id: null,
          children_order: ["cash", "credit"],
          condition: null,
          content: null,
          properties: { behavior: { exclusive: true } },
          metadata: { label: "Варіанти" },
        },
        {
          id: "cash",
          type: "section",
          parent_id: "fork",
          children_order: [],
          condition: { type: "predicate", condition_id: "pay", operator: "eq", value: "cash" },
          content: { block_ids: ["blk-cash"] },
          properties: {},
          metadata: { label: "Cash" },
        },
        {
          id: "credit",
          type: "section",
          parent_id: "fork",
          children_order: [],
          condition: { type: "predicate", condition_id: "pay", operator: "eq", value: "credit" },
          content: { block_ids: ["blk-credit"] },
          properties: {},
          metadata: { label: "Credit" },
        },
      ],
      meta: {},
    };
  }

  function buildMarkerForkModel() {
    return {
      schema_version: 5,
      fields: [{ id: "c1", label: "Choice", type: "boolean" }],
      nodes: [
        {
          id: "m1",
          type: "marker",
          parent_id: null,
          children_order: ["yes", "no"],
          condition: null,
          content: { block_ids: ["blk-0"] },
          properties: { behavior: { marker_mode: "fork" } },
          metadata: { label: "Marker" },
        },
        {
          id: "yes",
          type: "section",
          parent_id: "m1",
          children_order: ["p-yes"],
          condition: { type: "predicate", condition_id: "c1", operator: "eq", value: true },
          content: null,
          properties: {},
          metadata: { label: "Так" },
        },
        {
          id: "no",
          type: "section",
          parent_id: "m1",
          children_order: ["p-no"],
          condition: { type: "predicate", condition_id: "c1", operator: "eq", value: false },
          content: null,
          properties: {},
          metadata: { label: "Ні" },
        },
        {
          id: "p-yes",
          type: "paragraph",
          parent_id: "yes",
          children_order: [],
          condition: null,
          content: { block_ids: ["blk-1"] },
          properties: {},
          metadata: {},
        },
        {
          id: "p-no",
          type: "paragraph",
          parent_id: "no",
          children_order: [],
          condition: null,
          content: { block_ids: ["blk-2"] },
          properties: {},
          metadata: {},
        },
      ],
      meta: {},
    };
  }

  function buildDeepNestingModel() {
    return {
      schema_version: 5,
      fields: [{ id: "c1", label: "C", type: "boolean" }],
      nodes: [
        {
          id: "root",
          type: "section",
          parent_id: null,
          children_order: ["mid"],
          condition: null,
          content: null,
          properties: { behavior: { exclusive: true } },
          metadata: {},
        },
        {
          id: "mid",
          type: "section",
          parent_id: "root",
          children_order: ["leaf-wrap"],
          condition: { type: "predicate", condition_id: "c1", operator: "eq", value: true },
          content: null,
          properties: {},
          metadata: {},
        },
        {
          id: "leaf-wrap",
          type: "section",
          parent_id: "mid",
          children_order: ["leaf-a", "leaf-b"],
          condition: null,
          content: null,
          properties: { behavior: { exclusive: true } },
          metadata: {},
        },
        {
          id: "leaf-a",
          type: "section",
          parent_id: "leaf-wrap",
          children_order: ["p-a"],
          condition: { type: "predicate", condition_id: "c1", operator: "eq", value: true },
          content: null,
          properties: {},
          metadata: {},
        },
        {
          id: "leaf-b",
          type: "section",
          parent_id: "leaf-wrap",
          children_order: ["p-b"],
          condition: { type: "predicate", condition_id: "c1", operator: "eq", value: false },
          content: null,
          properties: {},
          metadata: {},
        },
        {
          id: "p-a",
          type: "paragraph",
          parent_id: "leaf-a",
          children_order: [],
          condition: null,
          content: { block_ids: ["blk-a"] },
          properties: {},
          metadata: {},
        },
        {
          id: "p-b",
          type: "paragraph",
          parent_id: "leaf-b",
          children_order: [],
          condition: null,
          content: { block_ids: ["blk-b"] },
          properties: {},
          metadata: {},
        },
      ],
      meta: {},
    };
  }

  function buildComplexAstModel() {
    return {
      schema_version: 5,
      fields: [
        { id: "f_bool", label: "Borrower", type: "boolean" },
        {
          id: "f_choice",
          label: "Product",
          type: "choice",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
      nodes: [
        {
          id: "sec1",
          type: "section",
          parent_id: null,
          children_order: ["p1"],
          condition: {
            type: "and",
            items: [
              { type: "predicate", condition_id: "f_bool", operator: "eq", value: true },
              {
                type: "or",
                items: [
                  { type: "predicate", condition_id: "f_choice", operator: "eq", value: "a" },
                  { type: "predicate", condition_id: "f_choice", operator: "eq", value: "b" },
                ],
              },
            ],
          },
          content: null,
          properties: { behavior: { exclusive: true } },
          metadata: {},
        },
        {
          id: "p1",
          type: "paragraph",
          parent_id: "sec1",
          children_order: [],
          condition: null,
          content: { block_ids: ["blk-1"] },
          properties: {},
          metadata: {},
        },
      ],
      meta: {},
    };
  }

  function countConditionalSections(model) {
    return (model.nodes || []).filter((node) => node.type === "section" && node.condition).length;
  }

  function buildNestedUxFlowModel() {
    const model = NodeModel.emptyModel();
    const fieldA = NodeModel.addField(
      model,
      NodeModel.createField({ type: "boolean", label: "Тип клієнта" }),
    );
    fieldA.id = "f-client";
    const fieldB = NodeModel.addField(
      model,
      NodeModel.createField({ type: "boolean", label: "Має кредит" }),
    );
    fieldB.id = "f-credit";

    const group = NodeTemplates.createSectionTemplate(model, { label: "Підпункт 1" });
    const fork = NodeTemplates.createYesNoTemplate(model, {
      parentId: group.id,
      fieldId: "f-client",
      yesBlockIds: ["blk-a"],
      noBlockIds: ["blk-n"],
    });
    const branchA = NodeModel.orderedChildren(model, fork.id).find(
      (node) => node.condition?.value === true,
    );
    const nestedFork = NodeTemplates.createYesNoTemplate(model, {
      parentId: branchA.id,
      fieldId: "f-credit",
      yesBlockIds: ["blk-a1"],
      noBlockIds: ["blk-a0"],
    });
    const subBranch = NodeModel.orderedChildren(model, nestedFork.id)[0];
    NodeModel.addNode(model, {
      type: "section",
      parentId: subBranch.id,
      node: {
        ...NodeModel.createNode("section", subBranch.id),
        condition: {
          type: "predicate",
          condition_id: "f-credit",
          operator: "eq",
          value: true,
        },
        metadata: { label: "Підваріант А1.1" },
      },
    });

    return NodeModel.toDocumentModel(model);
  }

  function runParityTests() {
    const errors = [];

    const basicModel = NodeModel.emptyModel();
    const section = NodeTemplates.createSectionTemplate(basicModel, { label: "Root" });
    const paragraph = NodeModel.addNode(basicModel, {
      type: "paragraph",
      parentId: section.id,
      node: {
        ...NodeModel.createNode("paragraph", section.id),
        content: { block_ids: ["blk-basic"] },
      },
    });
    assert("basic section template", Boolean(section), errors);
    assert("basic block assignment", NodeModel.getBlockIds(paragraph).includes("blk-basic"), errors);
    assertValidV5(NodeModel.toDocumentModel(basicModel), errors, "basic model");

    const yesNo = buildYesNoV5();
    assertValidV5(yesNo, errors, "yes/no v5 workflow");
    assert("yes/no conditional branches", countConditionalSections(yesNo) === 2, errors);

    const templateModel = NodeModel.emptyModel();
    NodeModel.addField(templateModel, NodeModel.createField({ type: "boolean", label: "Borrower" }));
    templateModel.fields[0].id = "f1";
    NodeTemplates.createYesNoTemplate(templateModel, {
      fieldId: "f1",
      yesBlockIds: ["blk-y"],
      noBlockIds: ["blk-n"],
    });
    assertValidV5(NodeModel.toDocumentModel(templateModel), errors, "template yes/no");

    const choice = buildChoiceV5();
    assertValidV5(choice, errors, "exclusive choice v5");
    assert("choice conditional branches", countConditionalSections(choice) === 2, errors);

    const nested = buildDeepNestingModel();
    assertValidV5(nested, errors, "deep nesting model");
    const nestedRoundtrip = NodeModel.normalizeModel(JSON.parse(JSON.stringify(nested)));
    assert("nested roundtrip node count", nestedRoundtrip.nodes.length === nested.nodes.length, errors);

    assertValidV5(buildMarkerForkModel(), errors, "marker fork model");
    assertValidV5(buildComplexAstModel(), errors, "complex AST model");

    const uxFlow = buildNestedUxFlowModel();
    assertValidV5(uxFlow, errors, "nested UX flow model");
    assert("nested UX flow depth", countConditionalSections(uxFlow) >= 4, errors);
    const uxRoundtrip = NodeModel.normalizeModel(JSON.parse(JSON.stringify(uxFlow)));
    assert("nested UX flow roundtrip", uxRoundtrip.nodes.length === uxFlow.nodes.length, errors);

    const docFlow = buildNestedUxFlowModel();
    const serializedDoc = NodeModel.toDocumentModel(docFlow);
    const restoredDoc = NodeModel.normalizeModel(JSON.parse(JSON.stringify(serializedDoc)));
    assert("document flow save/load nodes", restoredDoc.nodes.length === serializedDoc.nodes.length, errors);
    assert("document flow fields preserved", (restoredDoc.fields || []).length === (serializedDoc.fields || []).length, errors);
    assert("document flow no legacy types", assertNoLegacyNodeTypes(restoredDoc), errors);

    const invalid = NodeModel.cloneModel(buildComplexAstModel());
    invalid.nodes[0].condition.items[0].condition_id = "missing";
    assert("invalid condition rejected", NodeModel.validateModel(invalid).length > 0, errors);

    const serialized = NodeModel.toDocumentModel(templateModel);
    const restored = NodeModel.normalizeModel(JSON.parse(JSON.stringify(serialized)));
    assert("save/load shape preserved", restored.nodes.length === serialized.nodes.length, errors);

    if (errors.length) {
      console.error("LogicNodesParity failures:", errors);
      return false;
    }
    return true;
  }

  return {
    runParityTests,
    assertNoLegacyNodeTypes,
    buildYesNoV5,
    buildMarkerForkModel,
    buildNestedUxFlowModel,
    buildDeepNestingModel,
    LEGACY_NODE_TYPES,
  };
})();

if (typeof process !== "undefined" && process.argv?.includes("--parity-test")) {
  require("./node-model.js");
  require("./templates.js");
  const ok = LogicNodesParity.runParityTests();
  process.exit(ok ? 0 : 1);
}
