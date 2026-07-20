import re
import unicodedata
import uuid

from bs4 import BeautifulSoup, NavigableString, Tag

from docflow_docx.colors import (
    color_value_is_red,
    remove_red_color_from_style,
    style_has_red,
)
from docflow_docx.pages import patch_docx_root

BLOCK_TAGS = frozenset({"p", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol"})

_SCHEMA_VERSION = 3

KIND_SECTION = "section"
KIND_VARIANT = "variant"
KIND_OPTIONAL = "optional"

SELECTION_CONTAINER = "container"
SELECTION_ONE = "one"
SELECTION_OPTIONAL = "optional"

_VARIANT_HEADER_RE = re.compile(r"варіант\s*\d+", re.IGNORECASE)
_SECTION_INTRO_RE = re.compile(
    r"викладається\s+в\s+одному\s+з\s+наступних",
    re.IGNORECASE,
)
_EXCEPT_EMPLOYEE_RE = re.compile(
    r"за\s+винятком(?:\s+випадку)?.*працівник",
    re.IGNORECASE | re.DOTALL,
)
_IF_EMPLOYEE_RE = re.compile(
    r"якщо.*позичальник.*працівник",
    re.IGNORECASE | re.DOTALL,
)
_EMPLOYEE_POSITIVE_RE = re.compile(
    r"позичальник\s+є\s+працівник",
    re.IGNORECASE,
)
_CONDITIONAL_INCLUDE_RE = re.compile(
    r"за\s+наявності|при\s+наявності|у\s+разі\s+наявності|доповнюється",
    re.IGNORECASE,
)
_GUARANTOR_RE = re.compile(r"поручител", re.IGNORECASE)

SELECTION_CONTAINER = "container"
SELECTION_ONE = "one"
SELECTION_OPTIONAL = "optional"

DEFAULT_CONDITIONS = [
    {
        "id": "bank_employee",
        "label": "Позичальник є працівником банку",
        "type": "boolean",
    },
    {
        "id": "has_guarantor",
        "label": "Є поручитель",
        "type": "boolean",
    },
]


def _normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u2019", "'").replace("`", "'")
    return " ".join(text.lower().split())


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _truncate(text: str, limit: int = 90) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _empty_entry(
    rule_id: str,
    header_block_id: str,
    label: str,
    *,
    kind: str = KIND_VARIANT,
    parent_id: str | None = None,
) -> dict:
    return {
        "id": _new_id("entry"),
        "rule_id": rule_id,
        "header_block_id": header_block_id,
        "label": label,
        "kind": kind,
        "parent_id": parent_id,
        "when": {},
        "content_block_ids": [],
    }


def _kind_to_selection(kind: str) -> str:
    if kind == KIND_SECTION:
        return "container"
    if kind == KIND_OPTIONAL:
        return "optional"
    return "one"


def _entry_to_node(entry: dict, children: list[dict]) -> dict:
    return {
        "id": entry.get("id"),
        "header_block_id": entry.get("header_block_id", ""),
        "label": entry.get("label", ""),
        "selection": _kind_to_selection(entry.get("kind") or KIND_VARIANT),
        "when": dict(entry.get("when") or {}),
        "content_block_ids": list(entry.get("content_block_ids") or []),
        "children": children,
    }


def _build_trees_from_entries(entries: list[dict]) -> list[dict]:
    by_parent: dict[str | None, list[dict]] = {}
    for entry in entries:
        parent_id = entry.get("parent_id") or None
        by_parent.setdefault(parent_id, []).append(entry)

    def build(parent_id: str | None) -> list[dict]:
        nodes: list[dict] = []
        for entry in by_parent.get(parent_id, []):
            nodes.append(_entry_to_node(entry, build(entry.get("id"))))
        return nodes

    return build(None)


def annotate_blocks(html: str) -> str:
    if not html or not html.strip():
        return html

    soup = BeautifulSoup(f"<div id='annotate-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="annotate-root")
    if root is None:
        return html

    counter = 0
    for block in _top_level_blocks(root):
        if block.get("data-block-id"):
            continue
        block["data-block-id"] = f"blk-{counter}"
        counter += 1

    return root.decode_contents()


def classify_when(text: str) -> dict[str, bool | None]:
    normalized = _normalize_text(text)
    when: dict[str, bool | None] = {}

    if _EXCEPT_EMPLOYEE_RE.search(normalized):
        when["bank_employee"] = False
    elif _IF_EMPLOYEE_RE.search(normalized) or _EMPLOYEE_POSITIVE_RE.search(normalized):
        when["bank_employee"] = True
    elif "не є працівник" in normalized:
        when["bank_employee"] = False

    if _GUARANTOR_RE.search(normalized):
        when["has_guarantor"] = True

    return when


def _empty_rules() -> dict:
    return {
        "schema_version": _SCHEMA_VERSION,
        "conditions": [],
        "rules": [],
        "entries": [],
    }


def _entries_for_rule(rules: dict, rule_id: str) -> list[dict]:
    return [
        entry
        for entry in rules.get("entries") or []
        if entry.get("rule_id") == rule_id
    ]


def _find_entry(rules: dict, entry_id: str) -> dict | None:
    return next(
        (entry for entry in rules.get("entries") or [] if entry.get("id") == entry_id),
        None,
    )


def _iter_nodes(nodes: list[dict]):
    for node in nodes:
        yield node
        yield from _iter_nodes(node.get("children") or [])


def _find_node(nodes: list[dict], node_id: str) -> dict | None:
    for node in _iter_nodes(nodes):
        if node.get("id") == node_id:
            return node
    return None


def _find_rule(rules: dict, rule_id: str) -> dict | None:
    return next(
        (rule for rule in rules.get("rules", []) if rule.get("id") == rule_id),
        None,
    )


def _condition_id_for_node(rules: dict, node_id: str) -> str | None:
    for rule in rules.get("rules", []):
        if rule.get("node_id") != node_id:
            continue
        if rule.get("condition_id"):
            return rule["condition_id"]
    return None


def _normalize_answer(value) -> str | bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered == "true":
            return True
        if lowered == "false":
            return False
        return value
    return value


def _answers_match(target, active) -> bool:
    if target is None:
        return True
    normalized_target = _normalize_answer(target)
    normalized_active = _normalize_answer(active)
    if normalized_target == normalized_active:
        return True
    if isinstance(normalized_target, str) and isinstance(normalized_active, str):
        if normalized_target.strip().lower() == normalized_active.strip().lower():
            return True
    target_truth = _legacy_truthy(normalized_target)
    active_truth = _legacy_truthy(normalized_active)
    if target_truth is not None and active_truth is not None:
        return target_truth == active_truth
    return False


def _find_condition(rules: dict, condition_id: str | None) -> dict | None:
    if not condition_id:
        return None
    return next(
        (item for item in rules.get("conditions", []) if item.get("id") == condition_id),
        None,
    )


def _resolve_variant_group_match(
    group: list[dict],
    condition_id: str | None,
    condition_values: dict,
    rules: dict,
) -> list[dict]:
    if not group or not condition_id:
        return []

    active_value = condition_values.get(condition_id)
    matched = [item for item in group if _node_is_active(item, condition_id, condition_values)]
    if len(matched) == 1:
        return matched
    if len(matched) > 1:
        return [matched[0]]

    if active_value is None:
        return []

    condition = _find_condition(rules, condition_id)
    branch = _condition_branch_options(condition) if condition else []
    yes_value = branch[0]["value"] if branch else True
    no_value = branch[1]["value"] if len(branch) > 1 else yes_value

    for item in group:
        target = _node_when_value(item, condition_id)
        if target is None:
            continue
        if _answers_match(target, active_value):
            return [item]

    if _answers_match(active_value, yes_value):
        for item in group:
            if _answers_match(_node_when_value(item, condition_id), yes_value):
                return [item]
            label = str(item.get("label") or "").strip().lower()
            if label in {"так", "tak", "yes", "true"}:
                return [item]

    if _answers_match(active_value, no_value):
        for item in group:
            if _answers_match(_node_when_value(item, condition_id), no_value):
                return [item]
            label = str(item.get("label") or "").strip().lower()
            if label in {"ні", "ni", "no", "false", "нi"}:
                return [item]

    active_truth = _legacy_truthy(active_value)
    if active_truth is True:
        for item in group:
            if str(item.get("label") or "").strip().lower() in {"так", "tak", "yes", "true"}:
                return [item]
    if active_truth is False:
        for item in group:
            if str(item.get("label") or "").strip().lower() in {"ні", "ni", "no", "false", "нi"}:
                return [item]

    return []


def _node_when_value(node: dict, condition_id: str | None):
    if not condition_id:
        return None
    return (node.get("when") or {}).get(condition_id)


def _node_is_active(node: dict, condition_id: str | None, condition_values: dict) -> bool:
    if not condition_id:
        return True
    active_value = condition_values.get(condition_id)
    target = _node_when_value(node, condition_id)
    selection = node.get("selection") or SELECTION_ONE
    if active_value is None:
        if target is not None:
            return False
        return True
    if target is None:
        if selection == SELECTION_ONE:
            return False
        return True
    return _answers_match(target, active_value)


def _rule_has_explicit_choice(rule: dict, condition_values: dict) -> bool:
    condition_id = rule.get("condition_id")
    if not condition_id:
        return False
    return condition_id in condition_values and condition_values[condition_id] is not None


def _rules_ready_to_apply(rules: dict, condition_values: dict) -> list[dict]:
    ready: list[dict] = []
    for rule in rules.get("rules", []):
        if not _rule_is_configured(rule, rules):
            continue
        if not _rule_has_explicit_choice(rule, condition_values):
            continue
        ready.append(rule)
    return ready


def _collect_one_siblings(nodes: list[dict]) -> list[list[dict]]:
    groups: list[list[dict]] = []
    current: list[dict] = []
    for node in nodes:
        if node.get("selection") == SELECTION_ONE:
            current.append(node)
        else:
            if current:
                groups.append(current)
                current = []
    if current:
        groups.append(current)
    return groups


def _node_is_configured(node: dict, condition_id: str | None) -> bool:
    if not condition_id:
        return False
    selection = node.get("selection") or SELECTION_ONE
    children = node.get("children") or []

    if selection == SELECTION_OPTIONAL:
        if children:
            fork_variants = [
                child for child in children if (child.get("selection") or SELECTION_ONE) == SELECTION_ONE
            ]
            if fork_variants:
                with_when = [
                    child
                    for child in fork_variants
                    if _node_when_value(child, condition_id) is not None
                ]
                with_content = [
                    child for child in fork_variants if child.get("content_block_ids")
                ]
                return len(with_when) >= 2 and bool(with_content)
            return all(_node_is_configured(child, condition_id) for child in children)
        if _node_when_value(node, condition_id) is None:
            return False
        return True

    if selection == SELECTION_ONE:
        if _node_when_value(node, condition_id) is None:
            return False
        if not (node.get("content_block_ids") or []):
            return False

    if selection == SELECTION_CONTAINER and not children:
        return False

    for child in children:
        if not _node_is_configured(child, condition_id):
            return False
    return True


def _rule_is_configured(rule: dict, rules: dict) -> bool:
    entries = _entries_for_rule(rules, rule.get("id", ""))
    if not entries:
        return False
    trees = _build_trees_from_entries(entries)
    condition_id = rule.get("condition_id")
    return all(_node_is_configured(tree, condition_id) for tree in trees)


def has_configured_rules(rules: dict | None) -> bool:
    if not rules:
        return False
    return any(_rule_is_configured(rule, rules) for rule in rules.get("rules", []))


def normalize_rules(rules: dict | None) -> dict:
    if not rules:
        return _empty_rules()

    if rules.get("schema_version") == 5:
        return rules

    if rules.get("schema_version") != _SCHEMA_VERSION:
        rules = _migrate_legacy_rules(rules)

    base = dict(rules)
    base["schema_version"] = _SCHEMA_VERSION
    base.setdefault("conditions", [])
    base.setdefault("rules", [])
    base.setdefault("entries", [])

    default_condition_id = base["conditions"][0]["id"] if base["conditions"] else None
    seen_rule_ids: set[str] = set()
    normalized_rules = []
    for rule in base.get("rules", []):
        item = dict(rule)
        if not item.get("id"):
            item["id"] = _new_id("rule")
        while item["id"] in seen_rule_ids:
            item["id"] = _new_id("rule")
        seen_rule_ids.add(item["id"])
        if not item.get("condition_id") and default_condition_id:
            item["condition_id"] = default_condition_id
        normalized_rules.append(item)
    base["rules"] = normalized_rules

    seen_entry_ids: set[str] = set()
    normalized_entries = []
    for entry in base.get("entries", []):
        item = dict(entry)
        if not item.get("id"):
            item["id"] = _new_id("entry")
        while item["id"] in seen_entry_ids:
            item["id"] = _new_id("entry")
        seen_entry_ids.add(item["id"])
        if not item.get("kind"):
            item["kind"] = KIND_VARIANT
        item.setdefault("when", {})
        item.setdefault("content_block_ids", [])
        normalized_entries.append(item)
    base["entries"] = [
        entry
        for entry in normalized_entries
        if any(rule["id"] == entry.get("rule_id") for rule in normalized_rules)
    ]

    base.pop("subpoints", None)
    base.pop("block_groups", None)
    base.pop("rule_items", None)
    base.pop("trees", None)
    _cleanup_legacy_marker_entries(base)
    _repair_legacy_when_values(base)
    _sync_marker_forks(base)
    return base


def _legacy_truthy(value) -> bool | None:
    normalized = _normalize_answer(value)
    if normalized is True:
        return True
    if normalized is False:
        return False
    if isinstance(normalized, str):
        lowered = normalized.strip().lower()
        if lowered in {"tak", "yes", "так", "true", "1"}:
            return True
        if lowered in {"ni", "no", "ні", "нi", "false", "0"}:
            return False
    return None


def _repair_legacy_when_values(rules: dict) -> None:
    conditions = {
        condition["id"]: condition
        for condition in rules.get("conditions", [])
        if condition.get("id")
    }

    for rule in rules.get("rules", []):
        if not rule.get("condition_id") and len(conditions) == 1:
            rule["condition_id"] = next(iter(conditions))

    for entry in rules.get("entries", []):
        rule = next(
            (item for item in rules.get("rules", []) if item.get("id") == entry.get("rule_id")),
            None,
        )
        if not rule:
            continue
        condition_id = rule.get("condition_id")
        condition = conditions.get(condition_id or "")
        if not condition:
            continue

        when = dict(entry.get("when") or {})
        if condition_id not in when and len(when) == 1:
            when[condition_id] = next(iter(when.values()))

        raw = when.get(condition_id)
        if raw is None:
            entry["when"] = when
            continue

        branch = _condition_branch_options(condition)
        yes_value = branch[0]["value"]
        no_value = branch[1]["value"] if len(branch) > 1 else branch[0]["value"]

        if any(_answers_match(option.get("value"), raw) for option in branch):
            when[condition_id] = raw
        else:
            truth = _legacy_truthy(raw)
            if truth is True:
                when[condition_id] = yes_value
            elif truth is False:
                when[condition_id] = no_value
            else:
                for option in branch:
                    label = str(option.get("label") or "").strip().lower()
                    if label and label == str(raw).strip().lower():
                        when[condition_id] = option["value"]
                        break

        entry["when"] = when


def _cleanup_legacy_marker_entries(rules: dict) -> None:
    entries: list[dict] = rules.get("entries", [])
    for rule in rules.get("rules", []):
        rule_id = rule.get("id")
        roots = [
            entry
            for entry in entries
            if entry.get("rule_id") == rule_id and not entry.get("parent_id")
        ]
        if not any(entry.get("kind") == KIND_OPTIONAL for entry in roots):
            continue
        rules["entries"] = [
            entry
            for entry in entries
            if not (
                entry.get("rule_id") == rule_id
                and not entry.get("parent_id")
                and entry.get("kind") == KIND_VARIANT
                and not str(entry.get("header_block_id") or "").strip()
            )
        ]
        entries = rules["entries"]


def _condition_branch_options(condition: dict) -> list[dict]:
    if condition.get("type") == "boolean" or not condition.get("options"):
        return [
            {"value": True, "label": "Так"},
            {"value": False, "label": "Nі"},
        ]
    options: list[dict] = []
    for option in condition.get("options") or []:
        label = str(option.get("label") or "").strip()
        if label in {"—", "-"}:
            continue
        options.append(dict(option))
    if not options:
        return [
            {"value": True, "label": "Так"},
            {"value": False, "label": "Nі"},
        ]
    return options


def _marker_branch_pair(condition: dict) -> tuple[tuple, tuple]:
    options = _condition_branch_options(condition)
    yes = options[0]
    no = options[1] if len(options) > 1 else options[0]
    return (
        (yes.get("value"), yes.get("label") or "Так"),
        (no.get("value"), no.get("label") or "Nі"),
    )


def _sync_marker_forks(rules: dict) -> None:
    conditions = {
        condition["id"]: condition for condition in rules.get("conditions", []) if condition.get("id")
    }
    entries: list[dict] = rules.get("entries", [])

    for rule in rules.get("rules", []):
        condition_id = rule.get("condition_id")
        condition = conditions.get(condition_id or "")
        if not condition:
            continue

        (yes_value, yes_label), (no_value, no_label) = _marker_branch_pair(condition)

        for entry in entries:
            if entry.get("rule_id") != rule.get("id"):
                continue
            if entry.get("kind") != KIND_OPTIONAL or entry.get("parent_id"):
                continue

            when = dict(entry.get("when") or {})
            if condition_id in when and when[condition_id] is not None:
                continue

            children = [
                child
                for child in entries
                if child.get("parent_id") == entry.get("id") and child.get("kind") == KIND_VARIANT
            ]

            yes_entry = next(
                (
                    child
                    for child in children
                    if _answers_match(_node_when_value(child, condition_id), yes_value)
                ),
                None,
            )
            no_entry = next(
                (
                    child
                    for child in children
                    if _answers_match(_node_when_value(child, condition_id), no_value)
                ),
                None,
            )

            if not yes_entry:
                yes_entry = next(
                    (
                        child
                        for child in children
                        if str(child.get("label") or "").strip().lower()
                        in {"так", "tak", "yes", "true"}
                    ),
                    None,
                )
            if not no_entry:
                no_entry = next(
                    (
                        child
                        for child in children
                        if str(child.get("label") or "").strip().lower()
                        in {"ні", "ni", "no", "false", "нi"}
                    ),
                    None,
                )

            if not yes_entry and children:
                yes_entry = children[0]
            if not no_entry and len(children) > 1:
                no_entry = children[1] if children[1] is not yes_entry else (
                    children[2] if len(children) > 2 else None
                )

            if not yes_entry:
                yes_entry = {
                    "id": _new_id("entry"),
                    "rule_id": rule["id"],
                    "header_block_id": "",
                    "label": yes_label,
                    "kind": KIND_VARIANT,
                    "parent_id": entry["id"],
                    "when": {},
                    "content_block_ids": [],
                }
                entries.append(yes_entry)
            if not no_entry:
                no_entry = {
                    "id": _new_id("entry"),
                    "rule_id": rule["id"],
                    "header_block_id": "",
                    "label": no_label,
                    "kind": KIND_VARIANT,
                    "parent_id": entry["id"],
                    "when": {},
                    "content_block_ids": [],
                }
                entries.append(no_entry)

            yes_entry["label"] = yes_label
            yes_entry["when"] = {**(yes_entry.get("when") or {}), condition_id: yes_value}
            yes_entry["parent_id"] = entry["id"]
            yes_entry["kind"] = KIND_VARIANT

            no_entry["label"] = no_label
            no_entry["when"] = {**(no_entry.get("when") or {}), condition_id: no_value}
            no_entry["parent_id"] = entry["id"]
            no_entry["kind"] = KIND_VARIANT

            keep_ids = {yes_entry["id"], no_entry["id"]}
            rules["entries"] = [
                item
                for item in entries
                if not (
                    item.get("parent_id") == entry.get("id")
                    and item.get("kind") == KIND_VARIANT
                    and item.get("id") not in keep_ids
                )
            ]
            entries = rules["entries"]


def _flatten_node_to_entries(
    node: dict,
    rule_id: str,
    parent_id: str | None,
    entries: list[dict],
) -> None:
    selection = node.get("selection")
    if selection == SELECTION_CONTAINER:
        kind = KIND_SECTION
    elif selection == SELECTION_OPTIONAL:
        kind = KIND_OPTIONAL
    elif node.get("kind"):
        kind = node.get("kind")
    else:
        kind = KIND_VARIANT

    entry = {
        "id": node.get("id") or _new_id("entry"),
        "rule_id": rule_id,
        "header_block_id": node.get("header_block_id", ""),
        "label": node.get("label") or "",
        "kind": kind,
        "parent_id": parent_id,
        "when": dict(node.get("when") or {}),
        "content_block_ids": list(node.get("content_block_ids") or []),
    }
    entries.append(entry)
    for child in node.get("children") or []:
        _flatten_node_to_entries(child, rule_id, entry["id"], entries)


def _migrate_legacy_rules(rules: dict) -> dict:
    if rules.get("entries"):
        return dict(rules)

    entries: list[dict] = []
    migrated_rules: list[dict] = []

    if rules.get("trees"):
        linked: dict[str, dict] = {}
        for rule in rules.get("rules") or []:
            node_id = rule.get("node_id")
            if node_id:
                linked[node_id] = rule
        for tree in rules.get("trees") or []:
            rule = linked.get(tree.get("id"))
            rule_id = (rule or {}).get("id") or _new_id("rule")
            if rule:
                migrated_rules.append(
                    {"id": rule_id, "condition_id": rule.get("condition_id")}
                )
            _flatten_node_to_entries(tree, rule_id, None, entries)
        for rule in rules.get("rules") or []:
            if rule.get("node_id"):
                continue
            migrated_rules.append(
                {
                    "id": rule.get("id") or _new_id("rule"),
                    "condition_id": rule.get("condition_id"),
                }
            )
    else:
        rule_map = {rule.get("id"): rule for rule in rules.get("rules") or []}
        item_rule_for_subpoint: dict[str, str] = {}
        for item in rules.get("rule_items") or []:
            subpoint_id = item.get("subpoint_id") or item.get("block_group_id")
            if subpoint_id and item.get("rule_id"):
                item_rule_for_subpoint[subpoint_id] = item["rule_id"]

        for subpoint in rules.get("subpoints") or []:
            rule_id = item_rule_for_subpoint.get(
                subpoint.get("id", ""),
                (rules.get("rules") or [{}])[0].get("id") if rules.get("rules") else _new_id("rule"),
            )
            if rule_id not in rule_map and not any(r["id"] == rule_id for r in migrated_rules):
                migrated_rules.append({"id": rule_id, "condition_id": None})
            section = {
                "id": subpoint.get("id") or _new_id("entry"),
                "header_block_id": subpoint.get("header_block_id", ""),
                "label": subpoint.get("label") or "Підпункт",
                "selection": SELECTION_CONTAINER,
                "when": {},
                "content_block_ids": [],
                "children": [],
            }
            for variant in subpoint.get("variants") or []:
                section["children"].append(
                    {
                        "id": variant.get("id") or _new_id("entry"),
                        "header_block_id": variant.get("header_block_id", ""),
                        "label": variant.get("label") or "Варіант",
                        "selection": SELECTION_ONE,
                        "when": dict(variant.get("when") or {}),
                        "content_block_ids": list(variant.get("content_block_ids") or []),
                        "children": [],
                    }
                )
            _flatten_node_to_entries(section, rule_id, None, entries)

        for block_group in rules.get("block_groups") or []:
            rule_id = item_rule_for_subpoint.get(
                block_group.get("id", ""),
                (rules.get("rules") or [{}])[0].get("id") if rules.get("rules") else _new_id("rule"),
            )
            node = {
                "id": block_group.get("id") or _new_id("entry"),
                "header_block_id": block_group.get("header_block_id", ""),
                "label": block_group.get("label") or "Умовний",
                "selection": SELECTION_OPTIONAL,
                "when": dict(block_group.get("when") or {}),
                "content_block_ids": list(block_group.get("content_block_ids") or []),
                "children": [],
            }
            _flatten_node_to_entries(node, rule_id, None, entries)

        for rule in rules.get("rules") or []:
            if any(item["id"] == rule.get("id") for item in migrated_rules):
                continue
            migrated_rules.append(
                {"id": rule.get("id") or _new_id("rule"), "condition_id": rule.get("condition_id")}
            )

    return {
        "schema_version": _SCHEMA_VERSION,
        "conditions": rules.get("conditions") or [],
        "rules": migrated_rules,
        "entries": entries,
    }


def get_active_condition_ids(rules: dict | None) -> list[str]:
    if not rules:
        return []
    seen: set[str] = set()
    active: list[str] = []
    for rule in rules.get("rules", []):
        if not _entries_for_rule(rules, rule.get("id", "")):
            continue
        condition_id = rule.get("condition_id")
        if not condition_id or condition_id in seen:
            continue
        seen.add(condition_id)
        active.append(condition_id)
    return active


def has_variant_rules(rules: dict | None) -> bool:
    return bool(rules and rules.get("entries"))


def has_contract_variants(html: str) -> bool:
    if not html or not html.strip():
        return False

    soup = BeautifulSoup(f"<div id='variant-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="variant-root")
    if root is None:
        return False

    for block in _top_level_blocks(root):
        if _is_section_intro(block) or _is_variant_header(block) or _is_conditional_include(block):
            return True
    return False


def load_or_detect_rules(html: str, stored: dict | None) -> dict:
    if stored is not None:
        return normalize_rules(stored)
    return _empty_rules()


def _condition_values_from_settings(settings: dict | None) -> dict:
    values = dict((settings or {}).get("condition_values") or {})
    legacy = (settings or {}).get("is_bank_employee")
    if legacy is not None and "bank_employee" not in values:
        values["bank_employee"] = legacy
    return values


def _explicit_condition_values(settings: dict | None) -> dict:
    return {
        key: value
        for key, value in ((settings or {}).get("condition_values") or {}).items()
        if value is not None
    }


def _add_removals(block_ids: list[str], remove: set[str], protected: set[str]) -> None:
    for block_id in block_ids:
        if block_id and block_id not in protected:
            remove.add(block_id)


def _collect_active_blocks_from_children(
    children: list[dict],
    condition_id: str | None,
    condition_values: dict,
    active_blocks: set[str],
    rules: dict,
) -> None:
    index = 0
    while index < len(children):
        child = children[index]
        if child.get("selection") == SELECTION_ONE:
            group: list[dict] = []
            while index < len(children) and children[index].get("selection") == SELECTION_ONE:
                group.append(children[index])
                index += 1
            matched = _resolve_variant_group_match(group, condition_id, condition_values, rules)
            for item in matched:
                _collect_active_blocks_subtree(
                    item, condition_id, condition_values, active_blocks, rules
                )
            continue

        _collect_active_blocks_subtree(child, condition_id, condition_values, active_blocks, rules)
        index += 1


def _collect_active_blocks_subtree(
    node: dict,
    condition_id: str | None,
    condition_values: dict,
    active_blocks: set[str],
    rules: dict,
) -> None:
    if not _node_is_active(node, condition_id, condition_values):
        return

    selection = node.get("selection") or SELECTION_ONE
    children = node.get("children") or []

    if selection in {SELECTION_ONE, SELECTION_OPTIONAL}:
        active_blocks.update(node.get("content_block_ids") or [])

    if selection == SELECTION_OPTIONAL:
        _collect_active_blocks_from_children(
            children, condition_id, condition_values, active_blocks, rules
        )
        return

    if selection == SELECTION_ONE:
        _collect_active_blocks_from_children(
            children, condition_id, condition_values, active_blocks, rules
        )
        return

    if selection == SELECTION_CONTAINER:
        _collect_active_blocks_from_children(
            children, condition_id, condition_values, active_blocks, rules
        )


def _active_content_blocks(rules: dict, condition_values: dict) -> set[str]:
    active_blocks: set[str] = set()

    for rule in _rules_ready_to_apply(rules, condition_values):
        entries = _entries_for_rule(rules, rule.get("id", ""))
        condition_id = rule.get("condition_id")
        for tree in _build_trees_from_entries(entries):
            _collect_active_blocks_subtree(
                tree, condition_id, condition_values, active_blocks, rules
            )

    return active_blocks


def _process_children(
    children: list[dict],
    condition_id: str | None,
    condition_values: dict,
    remove: set[str],
    protected: set[str],
    rules: dict,
    finalize: bool,
) -> None:
    index = 0
    while index < len(children):
        child = children[index]
        if child.get("selection") == SELECTION_ONE:
            group: list[dict] = []
            while index < len(children) and children[index].get("selection") == SELECTION_ONE:
                group.append(children[index])
                index += 1
            matched = _resolve_variant_group_match(group, condition_id, condition_values, rules)
            if not matched:
                continue
            for item in group:
                if item in matched:
                    _collect_removals_for_node(
                        item, condition_id, condition_values, remove, protected, rules, finalize
                    )
                else:
                    _remove_subtree(item, remove, protected)
            continue

        _collect_removals_for_node(
            child, condition_id, condition_values, remove, protected, rules, finalize
        )
        index += 1


def _remove_subtree(
    node: dict,
    remove: set[str],
    protected: set[str] | None = None,
) -> None:
    protected = protected or set()
    header_id = node.get("header_block_id")
    if header_id and header_id not in protected:
        remove.add(header_id)
    _add_removals(node.get("content_block_ids") or [], remove, protected)
    for child in node.get("children") or []:
        _remove_subtree(child, remove, protected)


def _collect_removals_for_node(
    node: dict,
    condition_id: str | None,
    condition_values: dict,
    remove: set[str],
    protected: set[str],
    rules: dict,
    finalize: bool,
) -> None:
    selection = node.get("selection") or SELECTION_ONE
    header_id = node.get("header_block_id")
    if header_id and header_id not in protected and finalize:
        remove.add(header_id)

    children = node.get("children") or []
    content_ids = node.get("content_block_ids") or []
    active = _node_is_active(node, condition_id, condition_values)

    if selection == SELECTION_OPTIONAL:
        if not active:
            _add_removals(content_ids, remove, protected)
            for child in children:
                _remove_subtree(child, remove, protected)
            return
        _process_children(children, condition_id, condition_values, remove, protected, rules, finalize)
        return

    if selection == SELECTION_ONE:
        if not active:
            _add_removals(content_ids, remove, protected)
            for child in children:
                _remove_subtree(child, remove, protected)
            return
        _process_children(children, condition_id, condition_values, remove, protected, rules, finalize)
        return

    if selection == SELECTION_CONTAINER:
        _process_children(children, condition_id, condition_values, remove, protected, rules, finalize)


def _blocks_to_remove(rules: dict, condition_values: dict, *, finalize: bool = False) -> set[str]:
    protected = _active_content_blocks(rules, condition_values)
    remove: set[str] = set()

    for rule in _rules_ready_to_apply(rules, condition_values):
        entries = _entries_for_rule(rules, rule.get("id", ""))
        condition_id = rule.get("condition_id")
        for tree in _build_trees_from_entries(entries):
            _collect_removals_for_node(
                tree, condition_id, condition_values, remove, protected, rules, finalize
            )

    return remove


def strip_preview_decorations(html: str) -> str:
    if not html or not html.strip():
        return html

    soup = BeautifulSoup(f"<div id='strip-deco-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="strip-deco-root")
    if root is None:
        return html

    skip_classes = frozenset({"docx-instruction", "docx-instruction-text"})
    for element in root.find_all(True):
        classes = element.get("class") or []
        filtered = [
            cls
            for cls in classes
            if cls not in skip_classes and not cls.startswith("docx-block--")
        ]
        if filtered:
            element["class"] = filtered
        elif classes:
            del element["class"]

    return root.decode_contents()


def _v5_node_map(model: dict) -> dict[str, dict]:
    return {
        node["id"]: node
        for node in model.get("nodes") or []
        if node.get("id")
    }


def _v5_ordered_children(model: dict, node_id: str) -> list[dict]:
    node = _v5_node_map(model).get(node_id)
    if not node:
        return []
    id_map = _v5_node_map(model)
    return [
        id_map[child_id]
        for child_id in (node.get("children_order") or [])
        if child_id in id_map
    ]


def _v5_block_ids(node: dict | None) -> list[str]:
    if not node:
        return []
    content = node.get("content") or {}
    return list(content.get("block_ids") or [])


def _v5_collect_field_ids(condition: dict | None) -> set[str]:
    ids: set[str] = set()
    if not condition:
        return ids
    if condition.get("type") == "predicate":
        condition_id = condition.get("condition_id")
        if condition_id:
            ids.add(str(condition_id))
        return ids
    if condition.get("type") == "not":
        ids.update(_v5_collect_field_ids(condition.get("item")))
        return ids
    for item in condition.get("items") or []:
        ids.update(_v5_collect_field_ids(item))
    return ids


def _v5_active_field_ids(model: dict) -> list[str]:
    ids: set[str] = set()
    for node in model.get("nodes") or []:
        ids.update(_v5_collect_field_ids(node.get("condition")))
    return sorted(ids)


def _v5_is_exclusive(node: dict) -> bool:
    behavior = (node.get("properties") or {}).get("behavior") or {}
    return node.get("type") == "section" and bool(behavior.get("exclusive"))


def _v5_evaluate_condition(condition: dict | None, values: dict) -> bool:
    if not condition:
        return True
    kind = condition.get("type")
    if kind == "predicate":
        condition_id = condition.get("condition_id")
        if not condition_id or condition_id not in values or values[condition_id] is None:
            return False
        active = values[condition_id]
        operator = condition.get("operator", "eq")
        expected = condition.get("value")
        if operator == "eq":
            return active == expected
        if operator == "neq":
            return active != expected
        return False
    if kind == "not":
        return not _v5_evaluate_condition(condition.get("item"), values)
    if kind == "and":
        items = condition.get("items") or []
        return bool(items) and all(
            _v5_evaluate_condition(item, values) for item in items
        )
    if kind == "or":
        return any(_v5_evaluate_condition(item, values) for item in condition.get("items") or [])
    return False


def _v5_exclusive_field_ids(children: list[dict]) -> set[str]:
    ids: set[str] = set()
    for child in children:
        ids.update(_v5_collect_field_ids(child.get("condition")))
    return ids


def _v5_collect_active_blocks(
    model: dict,
    values: dict,
    *,
    ignore_branch_predicates: bool = False,
) -> set[str]:
    active: set[str] = set()
    roots = [
        node
        for node in model.get("nodes") or []
        if not node.get("parent_id")
    ]

    def walk(node: dict, *, ignore_branch_predicates: bool = False) -> None:
        if not ignore_branch_predicates and not _v5_evaluate_condition(node.get("condition"), values):
            return
        active.update(_v5_block_ids(node))
        children = _v5_ordered_children(model, node["id"])
        if _v5_is_exclusive(node) and children:
            field_ids = _v5_exclusive_field_ids(children)
            has_choice = bool(field_ids) and all(
                values.get(field_id) is not None for field_id in field_ids
            )
            if not has_choice:
                for child in children:
                    walk(child, ignore_branch_predicates=True)
                return
            for child in children:
                if _v5_evaluate_condition(child.get("condition"), values):
                    walk(child)
            return
        for child in children:
            walk(child, ignore_branch_predicates=ignore_branch_predicates)

    for root in roots:
        walk(root, ignore_branch_predicates=ignore_branch_predicates)
    return active


def _v5_all_blocks(model: dict) -> set[str]:
    blocks: set[str] = set()
    for node in model.get("nodes") or []:
        blocks.update(_v5_block_ids(node))
    return blocks


def _v5_rules_ready(model: dict, values: dict) -> bool:
    field_ids = _v5_active_field_ids(model)
    if not field_ids:
        return False
    return all(values.get(field_id) is not None for field_id in field_ids)


def _v5_has_explicit_choice(model: dict, values: dict) -> bool:
    field_ids = _v5_active_field_ids(model)
    return any(values.get(field_id) is not None for field_id in field_ids)


def _v5_highlight_map(model: dict, values: dict) -> dict[str, str]:
    if not _v5_has_explicit_choice(model, values):
        return {}

    active = _v5_collect_active_blocks(model, values)
    all_blocks = _v5_all_blocks(model)
    if not all_blocks:
        return {}

    highlights: dict[str, str] = {}
    for block_id in all_blocks:
        highlights[block_id] = (
            "content-active" if block_id in active else "content-inactive"
        )
    return highlights


def apply_document_model(
    html: str,
    model: dict,
    *,
    condition_values: dict | None = None,
    finalize: bool = False,
) -> str:
    """Застосувати v5 document_model до HTML (перегляд або фіналізація)."""
    if not html or not html.strip():
        return html
    if not model or model.get("schema_version") != 5:
        return html

    values = {
        key: value
        for key, value in (condition_values or {}).items()
        if value is not None
    }
    html = annotate_blocks(html)
    if not values and not finalize:
        return html

    active_blocks = _v5_collect_active_blocks(model, values)
    highlights = _v5_highlight_map(model, values)
    if highlights:
        html = apply_highlights(html, highlights)

    ready = _v5_rules_ready(model, values)
    if not ready and not finalize:
        return html

    soup = BeautifulSoup(f"<div id='v5-apply-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="v5-apply-root")
    if root is None:
        return html

    if finalize and ready:
        remove_ids = _v5_all_blocks(model) - active_blocks
        if remove_ids:
            for block in _top_level_blocks(root):
                block_id = block.get("data-block-id", "")
                if block_id in remove_ids:
                    block.decompose()
        strip_red_content(root)
    elif ready:
        if not highlights:
            mute_red_content(root)

    return root.decode_contents()


def apply_preview_overlay(
    html: str,
    rules: dict,
    *,
    condition_values: dict | None = None,
    is_bank_employee: bool | None = None,
) -> str:
    """Перегляд: усі варіанти на місці, підсвітка + приглушення червоного після вибору."""
    if not html or not html.strip():
        return html

    values = dict(condition_values or {})
    if is_bank_employee is not None and "bank_employee" not in values:
        values["bank_employee"] = is_bank_employee

    active_values = {
        key: value for key, value in values.items() if value is not None
    }

    html = annotate_blocks(html)
    highlights = get_highlight_map(rules, condition_values=active_values)
    if highlights:
        html = apply_highlights(html, highlights)

    if not _rules_ready_to_apply(rules, active_values):
        return html

    soup = BeautifulSoup(f"<div id='overlay-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="overlay-root")
    if root is None:
        return html

    mute_red_content(root)
    return root.decode_contents()


def apply_variant_rules(
    html: str,
    rules: dict,
    is_bank_employee: bool | None = None,
    *,
    condition_values: dict | None = None,
    finalize: bool = False,
    strip_red: bool | None = None,
    mute_red: bool | None = None,
) -> str:
    if not html or not html.strip():
        return html

    if strip_red is None:
        strip_red = finalize
    if mute_red is None:
        mute_red = not finalize

    values = dict(condition_values or {})
    if is_bank_employee is not None and "bank_employee" not in values:
        values["bank_employee"] = is_bank_employee

    active_values = {
        key: value for key, value in values.items() if value is not None
    }
    if not _rules_ready_to_apply(rules, active_values):
        return html

    html = annotate_blocks(html)
    remove_ids = _blocks_to_remove(rules, active_values, finalize=finalize)

    soup = BeautifulSoup(f"<div id='apply-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="apply-root")
    if root is None:
        return html

    for block in _top_level_blocks(root):
        block_id = block.get("data-block-id", "")
        if block_id in remove_ids:
            block.decompose()

    if strip_red:
        strip_red_content(root)
    elif mute_red:
        mute_red_content(root)

    return root.decode_contents()


def _highlight_subtree(
    node: dict,
    condition_id: str | None,
    condition_values: dict,
    highlights: dict[str, str],
    selected_id: str | None,
) -> None:
    active = _node_is_active(node, condition_id, condition_values)
    header_id = node.get("header_block_id")
    selection = node.get("selection") or SELECTION_ONE

    if header_id:
        if selection == SELECTION_CONTAINER:
            highlights[header_id] = "section"
        elif selection == SELECTION_OPTIONAL:
            highlights[header_id] = "group-active" if active else "group-inactive"
        else:
            highlights[header_id] = "variant-active" if active else "variant-inactive"

    role = "content-active" if active else "content-inactive"
    if node.get("id") == selected_id:
        role = "content-active"

    for block_id in node.get("content_block_ids") or []:
        highlights[block_id] = role

    if node.get("id") == selected_id and header_id:
        highlights[header_id] = "selected"

    for child in node.get("children") or []:
        _highlight_subtree(child, condition_id, condition_values, highlights, selected_id)


def get_highlight_map(
    rules: dict,
    is_bank_employee: bool | None = None,
    *,
    condition_values: dict | None = None,
    selected_node_id: str | None = None,
) -> dict[str, str]:
    values = dict(condition_values or {})
    if is_bank_employee is not None and "bank_employee" not in values:
        values["bank_employee"] = is_bank_employee

    highlights: dict[str, str] = {}

    for rule in rules.get("rules", []):
        entries = _entries_for_rule(rules, rule.get("id", ""))
        if not entries:
            continue
        if not _rule_has_explicit_choice(rule, values):
            continue
        for tree in _build_trees_from_entries(entries):
            _highlight_subtree(
                tree,
                rule.get("condition_id"),
                values,
                highlights,
                selected_node_id,
            )

    return highlights


def apply_highlights(html: str, highlights: dict[str, str]) -> str:
    if not html:
        return html

    soup = BeautifulSoup(f"<div id='hl-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="hl-root")
    if root is None:
        return html

    for block in _top_level_blocks(root):
        block_id = block.get("data-block-id", "")
        role = highlights.get(block_id)
        classes = [c for c in (block.get("class") or []) if not c.startswith("docx-block--")]
        if role == "selected":
            classes.append("docx-block--selected")
        elif role:
            classes.append(f"docx-block--{role}")
        if classes:
            block["class"] = classes
        elif block.has_attr("class"):
            del block["class"]

    return root.decode_contents()


def make_structure_editable(html: str, extra_class: str = "") -> str:
    classes = "docx-document docx-editable docx-structure-mode"
    if extra_class:
        classes += f" {extra_class}"
    inner = patch_docx_root(html, classes, editable=False)
    return f'<div class="docx-canvas">{inner}</div>'


def collect_top_level_block_ids(html: str) -> set[str]:
    if not html or not html.strip():
        return set()

    soup = BeautifulSoup(f"<div id='block-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="block-root")
    if root is None:
        return set()

    return {
        block_id
        for block in _top_level_blocks(root)
        if (block_id := block.get("data-block-id"))
    }


def merge_edited_into_source(
    source_html: str,
    edited_html: str,
    *,
    deletable_block_ids: set[str] | None = None,
) -> str:
    """Apply preview edits (by data-block-id) into the full source document."""
    if not source_html:
        return annotate_blocks(edited_html)
    if not edited_html:
        return source_html

    source_soup = BeautifulSoup(f"<div id='src-root'>{source_html}</div>", "html.parser")
    edited_soup = BeautifulSoup(f"<div id='edit-root'>{edited_html}</div>", "html.parser")
    src_root = source_soup.find("div", id="src-root")
    edit_root = edited_soup.find("div", id="edit-root")
    if src_root is None or edit_root is None:
        return annotate_blocks(edited_html or source_html)

    edited_map: dict[str, Tag] = {}
    for block in _top_level_blocks(edit_root):
        block_id = block.get("data-block-id")
        if block_id:
            edited_map[block_id] = block

    if not edited_map:
        return annotate_blocks(edited_html)

    known_ids = set()
    for block in _top_level_blocks(src_root):
        block_id = block.get("data-block-id")
        if not block_id or block_id not in edited_map:
            continue
        block.replace_with(edited_map[block_id].extract())
        known_ids.add(block_id)

    for block_id, block in edited_map.items():
        if block_id not in known_ids and block.parent is edit_root:
            src_root.append(block.extract())

    edited_ids = set(edited_map)
    if deletable_block_ids is not None:
        remove_ids = deletable_block_ids - edited_ids
    elif not has_contract_variants(source_html):
        remove_ids = {
            block.get("data-block-id")
            for block in _top_level_blocks(src_root)
            if block.get("data-block-id") and block.get("data-block-id") not in edited_ids
        }
    else:
        remove_ids = set()

    for block in list(_top_level_blocks(src_root)):
        block_id = block.get("data-block-id")
        if block_id and block_id in remove_ids:
            block.decompose()

    return annotate_blocks(src_root.decode_contents())


def _is_section_intro(block: Tag) -> bool:
    text = _normalize_text(block.get_text(" ", strip=True))
    return bool(_SECTION_INTRO_RE.search(text))


def _is_variant_header(block: Tag) -> bool:
    text = _normalize_text(block.get_text(" ", strip=True))
    return bool(_VARIANT_HEADER_RE.search(text))


def _is_conditional_include(block: Tag) -> bool:
    if _is_section_intro(block) or _is_variant_header(block):
        return False
    text = _normalize_text(block.get_text(" ", strip=True))
    return bool(_CONDITIONAL_INCLUDE_RE.search(text))


def _top_level_blocks(root: Tag) -> list[Tag]:
    blocks: list[Tag] = []

    for child in list(root.children):
        if isinstance(child, NavigableString):
            if not str(child).strip():
                continue
            wrapper = root.new_tag("p")
            wrapper.string = str(child)
            child.replace_with(wrapper)
            blocks.append(wrapper)
            continue

        if not isinstance(child, Tag):
            continue

        classes = child.get("class") or []
        if child.name == "div" and "docx-page-break" in classes:
            blocks.append(child)
            continue
        if child.name == "div":
            blocks.extend(_top_level_blocks(child))
            continue
        if child.name in BLOCK_TAGS:
            blocks.append(child)

    return blocks


def is_red_block(block: Tag) -> bool:
    text = block.get_text(" ", strip=True)
    if not text:
        return False

    red_text, other_text = split_text_by_color(block)
    if not red_text.strip():
        return False
    if not other_text.strip():
        return True
    return len(red_text.strip()) >= len(other_text.strip())


def split_text_by_color(block: Tag) -> tuple[str, str]:
    red_parts: list[str] = []
    other_parts: list[str] = []

    for node in block.descendants:
        if not isinstance(node, NavigableString):
            continue
        content = str(node)
        if not content:
            continue
        if node_has_red_color(node):
            red_parts.append(content)
        else:
            other_parts.append(content)

    return "".join(red_parts), "".join(other_parts)


def node_has_red_color(node: NavigableString) -> bool:
    parent = node.parent if isinstance(node.parent, Tag) else None
    if parent is None:
        return False
    return element_is_red(parent)


def element_is_red(element: Tag) -> bool:
    current: Tag | None = element
    while current is not None and isinstance(current, Tag):
        if style_has_red(current.get("style", "")):
            return True
        if current.name == "font" and current.get("color"):
            if color_value_is_red(current["color"]):
                return True
        if current.name in BLOCK_TAGS and current is not element:
            return False
        parent = current.parent
        current = parent if isinstance(parent, Tag) else None
    return False


def _append_class(element: Tag, class_name: str) -> None:
    classes = [c for c in (element.get("class") or []) if c != class_name]
    classes.append(class_name)
    element["class"] = classes


def mute_red_content(root: Tag) -> None:
    for block in _top_level_blocks(root):
        if is_red_block(block):
            _append_class(block, "docx-instruction")

    for element in root.find_all(True):
        if element_is_red(element):
            _append_class(element, "docx-instruction-text")
        style = element.get("style")
        if style and style_has_red(style):
            _append_class(element, "docx-instruction-text")
        if element.name == "font" and element.get("color"):
            if color_value_is_red(element["color"]):
                _append_class(element, "docx-instruction-text")


def strip_red_content(root: Tag) -> None:
    for block in list(root.find_all(BLOCK_TAGS)):
        if is_red_block(block):
            block.decompose()
            continue

        for span in list(block.find_all("span")):
            if element_is_red(span):
                span.unwrap()

        for font in list(block.find_all("font")):
            if element_is_red(font):
                font.unwrap()

    for element in root.find_all(True):
        style = element.get("style")
        if not style:
            continue
        cleaned = remove_red_color_from_style(style)
        if cleaned:
            element["style"] = cleaned
        else:
            del element["style"]

        if element.name == "font" and element.get("color"):
            if color_value_is_red(element["color"]):
                del element["color"]
