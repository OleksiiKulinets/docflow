/** Ukrainian UI copy and tooltips for the Node Editor. */

const NodeUiUk = (() => {
  const typeLabels = {
    section: "Розділ",
    paragraph: "Абзац",
    table: "Таблиця",
    marker: "Маркер",
    text: "Текст",
    placeholder: "Заповнювач",
  };

  const fieldTypeLabels = {
    boolean: "Так / Ні",
    choice: "Вибір",
  };

  const tabs = {
    general: { label: "Загальне", tip: "Назва, дерево, додавання дочірніх вузлів." },
    conditions: { label: "Умови", tip: "Коли показувати цей вузол. Для гілок варіантів — прив’язка до поля." },
    behavior: { label: "Поведінка", tip: "Exclusive — лише одна дочірня гілка активна (варіанти)." },
    content: { label: "Зміст", tip: "Прив’язка абзаців/таблиць документа до вузла." },
  };

  const addNodeOptions = [
    {
      value: "section",
      label: "Розділ",
      tip: "Контейнер для підпунктів і груп варіантів. Не прив’язує текст напряму.",
    },
    {
      value: "paragraph",
      label: "Абзац",
      tip: "Листовий вузол для тексту. Прив’яжіть блоки у вкладці «Зміст».",
    },
    {
      value: "table",
      label: "Таблиця",
      tip: "Листовий вузол для таблиці документа. Блоки — у «Зміст».",
    },
    {
      value: "marker",
      label: "Маркер",
      tip: "Спеціальний блок (наприклад, інструкція). Може містити гілки Так/Ні.",
    },
    {
      value: "yes-no",
      label: "Група Так / Ні",
      tip: "Створює 2 гілки з умовами на boolean-поле. Додайте під кожною гілкою абзаци з текстом.",
    },
    {
      value: "choice",
      label: "Група варіантів (вибір)",
      tip: "Створює гілки за значеннями choice-поля. Спочатку додайте поле типу «вибір».",
    },
  ];

  const strings = {
    fieldsTitle: "Умови документа",
    fieldsSub: "Питання для правил (Так/Ні або список)",
    fieldsEmpty: "Умов ще немає.",
    fieldsEmptySub: "«+ Умова» → потім оберіть її при додаванні варіантів до розділу.",
    addField: "+ Умова",
    editField: "Редагувати",
    pickConditionForVariants: "Яку умову використати",
    variantsNeedCondition: "Спочатку «+ Умова» зверху.",
    treeTitle: "Дерево документа",
    treeSub: "Клік — обрати вузол · ⋮⋮ — перетягнути",
    addNode: "Додати",
    addNodeAria: "Тип нового вузла",
    inspectorTitle: "Властивості",
    inspectorSub: "Загальне · Умови · Поведінка · Зміст",
    treeEmptyTitle: "Документ ще без вузлів",
    treeEmptySub: "Почніть з «Група Так/Ні» або «Розділ», потім прив’яжіть абзаци.",
    treeEmptyBtn: "Додати вузол",
    inspectorEmptyTitle: "Вузол не обрано",
    inspectorEmpty: "Клікніть вузол у дереві або абзац у документі праворуч.",
    labelField: "Назва (для себе)",
    labelPlaceholder: "Напр. «Пункт 3.1 — застава»",
    treeOpsLegend: "Дерево",
    duplicate: "Дублювати",
    moveUp: "↑ Вгору",
    moveDown: "↓ Вниз",
    deleteSubtree: "Видалити гілку",
    parent: "Батьківський вузол",
    parentTip: "Перемістити в інший розділ або на корінь дерева.",
    addChild: "Додати дочірній вузол",
    addChildTip: "Для варіантів підпункту оберіть «Група Так/ Ні» або «Група варіантів».",
    subVariantsTitle: "Підваріанти",
    addSubVariantYesNo: "Так / Ні",
    addSubVariantYesNoSub: "підваріант",
    addSubVariantChoice: "Список варіантів",
    addSubVariantChoiceSub: "3+ опції",
    selectSubVariantHint: "Клікніть підваріант у списку вище для редагування.",
    exclusive: "Exclusive — лише одна гілка активна",
    exclusiveTip: "Увімкніть для контейнера варіантів. Дочірні розділи з умовами = альтернативи.",
    markerBehavior: "Маркер автоматично стає розгалуженням, якщо має дочірні розділи з умовами.",
    noBehavior: "Для цього типу немає додаткових налаштувань.",
    contentOnlyLeaf: "Текст документа прив’язують до абзаца, таблиці або маркера — вкладка «Зміст».",
    assignedBlocks: "Прив’язані блоки",
    blocksEmpty: "Ще немає блоків. Увімкніть «Додати з документа» і клікніть абзац.",
    addFromDoc: "Додати з документа",
    addFromDocTip: "Клікніть абзац у прев’ю — він додасться до обраного вузла.",
    doneAssign: "Готово",
    addSelectedBlock: "Додати обраний абзац",
    docBlocks: "Блоки документа",
    allBlocksAssigned: "Усі блоки вже прив’язані до цього вузла.",
    noBlocksInDoc: "У документі немає блоків з data-block-id.",
    removeBlock: "Прибрати",
    dragHandle: "Перетягнути",
    expand: "Розгорнути",
    collapse: "Згорнути",
    blocksCount: "блок.",
    exclusiveBadge: "варіанти",
    workflowTitle: "Як додати варіанти до підпункту",
    helpToggle: "Підказки",
    rootLevel: "Корінь дерева",
    inspectorTabsAria: "Розділи властивостей",
    contentLegend: "Зміст",
    conditionsLegend: "Умова показу",
    duplicateTip: "Створити копію вузла з дочірніми елементами",
    moveUpTip: "Перемістити вузол вище серед сусідів",
    moveDownTip: "Перемістити вузол нижче серед сусідів",
    deleteSubtreeTip: "Видалити цей вузол і все піддерево",
    variantsTitle: "Варіанти цього підпункту",
    variantsEmpty: "У цього підпункту ще немає альтернатив.",
    variantsEmptySub: "Один клік — і з’являться дві гілки з умовами.",
    addYesNoVariants: "Так / Ні",
    addYesNoVariantsSub: "2 варіанти",
    addChoiceVariants: "Список варіантів",
    addChoiceVariantsSub: "3+ опції",
    variantWhen: "Показувати коли",
    variantNoText: "немає тексту",
    variantBlocks: "блоків",
    variantAddText: "+ Текст",
    variantBindDoc: "Прив’язати з документа",
    variantEditCondition: "Змінити умову",
    variantGroupLabel: "Варіанти",
    advancedSection: "Додатково",
    simpleCondition: "Умова показу",
    advancedCondition: "Складна умова (AND/OR)",
    fieldsCollapsible: "Поля для умов",
    structureTitle: "Структура документа",
    addSection: "+ Розділ",
    branchYes: "Так",
    branchNo: "Ні",
    branchOption: "Варіант",
    inspectorNodeType: "Тип",
    inspectorVariantType: "Варіант",
    inspectorSectionType: "Розділ",
    inspectorParagraphType: "Абзац",
    inspectorParentGroup: "Батьківський розділ",
    inspectorExclusiveGroup: "Група варіантів",
    variantLabelField: "Назва варіанту",
    variantContentSection: "Контент варіанту",
    variantConditionSection: "Умова варіанту",
    emptyNoCondition: "У цього варіанта немає умови",
    emptyNoContent: "У цього варіанта немає контенту",
    emptyAddDocBlockHint: "Натисніть «Додати контент», потім клікніть абзац у документі праворуч.",
    conditionEquals: "дорівнює",
    conditionTrueHint: "Так (true)",
    conditionFalseHint: "Ні (false)",
    structureTreeTitle: "Структура варіантів",
    templateGuideTitle: "Наступні кроки",
    templateGuide1: "Клікніть варіант «Так» або «Ні» у списку — змініть назву за потреби.",
    templateGuide2: "Натисніть «Додати контент» і клікніть абзац у документі.",
    templateGuide3: "Перевірте зліва в панелі «Умови».",
    templateGuideDismiss: "Зрозуміло",
    selectVariantHint: "Клікніть варіант у списку вище для редагування.",
    addVariantContent: "Додати контент",
    contentBlocksLabel: "Блоки",
    dragHandleTip: "Перетягнути для зміни порядку",
    previewNotReadyTitle: "Перегляд покаже обидва варіанти",
    previewNotReadyBody:
      "Додайте текст до кожного варіанту («Додати контент»). Після збереження правил панель «Умови» зможе показувати лише один варіант.",
    previewMissingVariants: "Без контенту",
    locationAria: "Розташування у дереві",
    inspectorEditing: "Редагуєте",
    inspectorImmediateParent: "Батьківський вузол",
    inspectorActiveCondition: "Активується коли",
    addChoiceBranch: "+ Варіант",
    addChoiceBranchTip: "Додати гілку для наступного значення списку",
    allChoiceBranchesAdded: "Усі значення списку вже мають варіанти.",
    zoneFieldsTitle: "Умови документа",
    zoneFieldsSub: "Питання «Так/Ні» або список — на них будуються правила",
    zoneTreeTitle: "Структура документа",
    zoneTreeSub: "Підпункти та групи. Клік — обрати · ⋮⋮ — перетягнути",
    zoneVariantsTitle: "Варіанти",
    zoneVariantsSub: "Альтернативи для обраного розділу або варіанту",
    zonePropertiesTitle: "Властивості",
    zonePropertiesSub: "Назва, умова показу, текст документа",
    zoneVariantsEmpty: "Оберіть розділ або варіант у дереві",
    zoneVariantsEmptySub: "Спочатку «+ Розділ», потім створіть варіанти Так/Ні або список",
    zonePropertiesEmpty: "Нічого не обрано",
    zonePropertiesEmptySub: "Клікніть вузол у дереві або абзац у документі праворуч",
    pageNavStructure: "Структура",
    pageNavFields: "Умови",
    pageNavEditor: "Налаштування",
    pageNavBack: "Назад до структури",
    pageStructureSub: "Клік — відкрити налаштування · ⋮⋮ — перетягнути",
    pageFieldsSub: "Питання «Так/Ні» або список для варіантів",
    zoneStepVariants: "3",
    zoneStepProperties: "4",
  };

  function typeLabel(type) {
    return typeLabels[type] || type || "вузол";
  }

  function fieldTypeLabel(type) {
    return fieldTypeLabels[type] || type;
  }

  function addOption(value) {
    return addNodeOptions.find((opt) => opt.value === value) || null;
  }

  function renderAddNodeOptions(selectedValue) {
    return addNodeOptions
      .map(
        (opt) =>
          `<option value="${opt.value}" title="${escapeAttr(opt.tip)}" ${opt.value === selectedValue ? "selected" : ""}>${opt.label}</option>`,
      )
      .join("");
  }

  function escapeAttr(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function hintForAddNodeKind(kind) {
    return addOption(kind)?.tip || "";
  }

  /** Contextual help for the selected node — explains variants workflow. */
  function contextHelp(node, model) {
    if (!node) return workflowGuide(model);

    const fields = model?.fields || [];
    const children = NodeModel.orderedChildren(model, node.id);
    const hasCondition = Boolean(node.condition);
    const isExclusive = NodeModel.isExclusiveSection(node);
    const isBranch = node.type === "section" && hasCondition;
    const isExclusiveParent = node.type === "section" && isExclusive && !hasCondition;
    const canContent = NodeModel.supportsBlockContent(node);

    if (!fields.length) {
      return {
        title: "Крок 1: створіть умову",
        body: "«+ Умова» зверху (Так/Ні або список). Потім оберіть її в «Яку умову використати» під розділом.",
      };
    }

    if (node.type === "section" && !children.length && !isExclusive && !hasCondition) {
      return {
        title: "Підпункт без варіантів",
        body: "Щоб додати альтернативи (Так/Ні або варіанти вибору): у «Додати дочірній» оберіть «Група Так/Ні» або «Група варіантів». Або додайте звичайні абзаци як дочірні вузли.",
      };
    }

    if (isExclusiveParent) {
      return {
        title: "Контейнер варіантів",
        body: "Дочірні розділи з умовами — це гілки (Так, Ні, варіанти). Оберіть гілку → вкладка «Зміст» → додайте абзац і прив’яжіть текст документа. У панелі «Умови» зліва перевірте значення поля.",
      };
    }

    if (isBranch) {
      const hasNestedFork = children.some(
        (child) => child.type === "section" && NodeModel.isExclusiveSection(child) && !child.condition,
      );
      const summary =
        node.condition?.type === "predicate"
          ? `Умова: поле «${node.condition.condition_id}» = ${JSON.stringify(node.condition.value)}`
          : "Складна умова";
      const leaf = children.some((c) => c.type === "paragraph" || c.type === "table");
      if (hasNestedFork) {
        return {
          title: "Варіант з підваріантами",
          body: `${summary}. Оберіть підваріант у списку або дереві → задайте умову, текст і за потреби ще один рівень через «Підваріанти».`,
        };
      }
      if (!leaf) {
        return {
          title: "Гілка варіанту",
          body: `${summary}. «Додати контент» → клік по абзацу в документі. Для вкладених умов натисніть «Так / Ні» або «Список варіантів» у блоці «Підваріанти».`,
        };
      }
      return {
        title: "Гілка варіанту",
        body: `${summary}. Перевірте прив’язані блоки. Для вкладених умов — «Підваріанти» → «Так / Ні» або «Список варіантів».`,
      };
    }

    if (node.type === "marker") {
      if (isMarkerForkNode(node)) {
        return {
          title: "Маркер з гілками",
          body: "Текст маркера прив’язуйте до блоків документа. Гілки «Так/Ні» — окремі варіанти з власним текстом.",
        };
      }
      return {
        title: "Маркер",
        body: "Прив’яжіть блок документа. Для сценарію Так/Ні натисніть «Так / Ні» у блоці варіантів.",
      };
    }

    if (canContent && !NodeModel.getBlockIds(node).length) {
      return {
        title: "Прив’яжіть текст",
        body: "Вкладка «Зміст»: «Додати з документа» → клік по абзацу в документі. Або оберіть блок зі списку нижче.",
      };
    }

    if (node.type === "section" && hasCondition && children.length) {
      return {
        title: "Розділ з умовою",
        body: "Цей розділ показується лише коли умова виконується. Дочірні вузли — його зміст або вкладені варіанти.",
      };
    }

    return null;
  }

  function workflowGuide(model) {
    const hasFields = (model?.fields || []).length > 0;
    const steps = hasFields
        ? [
          "«+ Умова» зверху — назва питання (Так/Ні або список).",
          "«+ Розділ» — підпункт документа.",
          "Оберіть розділ → «Яку умову використати» → кнопка «Так/Ні».",
          "На картці варіанту — «Прив’язати з документа».",
          "Зліва «Умови» — перемкніть Так/Ні для перевірки.",
        ]
        : [
          "«+ Умова» — створіть питання.",
          "«+ Розділ» — підпункт.",
          "Оберіть розділ → оберіть умову → «Так/Ні».",
          "Прив’яжіть текст з документа.",
        ];
    return {
      title: strings.workflowTitle,
      body: steps.join(" "),
      steps,
    };
  }

  return {
    strings,
    tabs,
    typeLabels,
    typeLabel,
    fieldTypeLabel,
    addNodeOptions,
    addOption,
    renderAddNodeOptions,
    hintForAddNodeKind,
    contextHelp,
    workflowGuide,
  };
})();
