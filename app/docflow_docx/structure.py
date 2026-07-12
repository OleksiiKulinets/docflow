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
_BANK_EMPLOYEE_HINT_RE = re.compile(
    r"працівник(?:ом)?\s+банку|працівник\s+банку",
    re.IGNORECASE,
)

DEFAULT_CONDITIONS = [
    {
        "id": "bank_employee",
        "label": "Позичальник є працівником банку",
        "type": "boolean",
    }
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


def classify_variant_when(text: str) -> dict[str, bool | None]:
    normalized = _normalize_text(text)
    if _EXCEPT_EMPLOYEE_RE.search(normalized):
        return {"bank_employee": False}
    if _IF_EMPLOYEE_RE.search(normalized) or _EMPLOYEE_POSITIVE_RE.search(normalized):
        return {"bank_employee": True}
    if "не є працівник" in normalized:
        return {"bank_employee": False}
    return {"bank_employee": None}


def detect_structure(html: str) -> dict:
    html = annotate_blocks(html)
    soup = BeautifulSoup(f"<div id='detect-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="detect-root")
    if root is None:
        return _empty_rules()

    blocks = _top_level_blocks(root)
    subpoints: list[dict] = []
    current_subpoint: dict | None = None
    current_variant: dict | None = None

    for block in blocks:
        block_id = block.get("data-block-id", "")
        text = block.get_text(" ", strip=True)

        if is_red_block(block) and _is_section_intro(block):
            current_subpoint = {
                "id": _new_id("sp"),
                "header_block_id": block_id,
                "label": _truncate(text),
                "variants": [],
            }
            subpoints.append(current_subpoint)
            current_variant = None
            continue

        if (
            is_red_block(block)
            and _is_variant_header(block)
            and current_subpoint is not None
        ):
            current_variant = {
                "id": _new_id("var"),
                "header_block_id": block_id,
                "label": _truncate(text),
                "when": classify_variant_when(text),
                "content_block_ids": [],
            }
            current_subpoint["variants"].append(current_variant)
            continue

        if current_variant is not None and not (
            is_red_block(block) and _is_variant_related_red(block)
        ):
            current_variant["content_block_ids"].append(block_id)

    return normalize_rules(
        {
            "conditions": list(DEFAULT_CONDITIONS),
            "rules": [],
            "rule_items": [],
            "subpoints": subpoints,
        }
    )


def _empty_rules() -> dict:
    return {
        "conditions": list(DEFAULT_CONDITIONS),
        "rules": [],
        "rule_items": [],
        "subpoints": [],
    }


def subpoint_is_configured(subpoint: dict | None) -> bool:
    if not subpoint:
        return False
    variants = subpoint.get("variants") or []
    if not variants:
        return False
    return all(
        variant.get("when", {}).get("bank_employee") is not None
        for variant in variants
    )


def _configured_subpoint_ids(rules: dict | None) -> set[str]:
    if not rules:
        return set()
    return {
        subpoint["id"]
        for subpoint in rules.get("subpoints", [])
        if subpoint.get("id") and subpoint_is_configured(subpoint)
    }


def _active_rule_subpoint_ids(rules: dict | None) -> set[str]:
    if not rules:
        return set()
    configured = _configured_subpoint_ids(rules)
    return {
        item["subpoint_id"]
        for item in rules.get("rule_items", [])
        if item.get("subpoint_id") in configured
    }


def _applicable_subpoints(rules: dict | None) -> list[dict]:
    if not rules:
        return []
    active_ids = _active_rule_subpoint_ids(rules)
    if not active_ids:
        return []
    return [
        subpoint
        for subpoint in rules.get("subpoints", [])
        if subpoint.get("id") in active_ids
    ]


def has_configured_rules(rules: dict | None) -> bool:
    return bool(_active_rule_subpoint_ids(rules))


def normalize_rules(rules: dict | None) -> dict:
    base = dict(rules or {})
    base.setdefault("conditions", list(DEFAULT_CONDITIONS))
    base.setdefault("rules", [])
    base.setdefault("rule_items", [])
    base.setdefault("subpoints", [])

    if not base["conditions"]:
        base["conditions"] = list(DEFAULT_CONDITIONS)

    if not base["rules"] and base["subpoints"]:
        configured = [
            subpoint
            for subpoint in base["subpoints"]
            if subpoint_is_configured(subpoint)
        ]
        if configured:
            rule_id = _new_id("rule")
            base["rules"] = [{"id": rule_id, "condition_id": "bank_employee"}]
            base["rule_items"] = [
                {
                    "id": _new_id("ri"),
                    "rule_id": rule_id,
                    "subpoint_id": subpoint["id"],
                }
                for subpoint in configured
            ]

    return base


def has_variant_rules(rules: dict | None) -> bool:
    return bool(rules and rules.get("subpoints"))


def has_contract_variants(html: str) -> bool:
    if not html:
        return False
    soup = BeautifulSoup(f"<div id='scan-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="scan-root")
    if root is None:
        return False

    found_variant = False
    found_employee_hint = False
    for block in _top_level_blocks(root):
        if not is_red_block(block):
            continue
        text = _normalize_text(block.get_text(" ", strip=True))
        if _VARIANT_HEADER_RE.search(text) or _SECTION_INTRO_RE.search(text):
            found_variant = True
        if _BANK_EMPLOYEE_HINT_RE.search(text):
            found_employee_hint = True
    return found_variant and found_employee_hint


def load_or_detect_rules(html: str, stored: dict | None) -> dict:
    if stored and stored.get("subpoints"):
        return normalize_rules(stored)
    return detect_structure(html)


def apply_variant_rules(
    html: str,
    rules: dict,
    is_bank_employee: bool | None,
    *,
    strip_red: bool = True,
) -> str:
    if not html or not html.strip():
        return html
    if is_bank_employee is None or not has_configured_rules(rules):
        return html

    html = annotate_blocks(html)
    remove_ids = _blocks_to_remove(rules, is_bank_employee)

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

    return root.decode_contents()


def _blocks_to_remove(rules: dict, is_bank_employee: bool) -> set[str]:
    remove: set[str] = set()

    for subpoint in _applicable_subpoints(rules):
        header_id = subpoint.get("header_block_id")
        if header_id:
            remove.add(header_id)

        for variant in subpoint.get("variants", []):
            when = variant.get("when", {})
            target = when.get("bank_employee")
            header_id = variant.get("header_block_id", "")
            content_ids = variant.get("content_block_ids", [])

            if target is not None and target != is_bank_employee:
                if header_id:
                    remove.add(header_id)
                remove.update(content_ids)
            else:
                if header_id:
                    remove.add(header_id)

    return remove


def variant_is_active(variant: dict, is_bank_employee: bool | None) -> bool:
    if is_bank_employee is None:
        return True
    target = variant.get("when", {}).get("bank_employee")
    if target is None:
        return True
    return target == is_bank_employee


def get_highlight_map(rules: dict, is_bank_employee: bool | None) -> dict[str, str]:
    highlights: dict[str, str] = {}

    for subpoint in _applicable_subpoints(rules):
        header_id = subpoint.get("header_block_id")
        if header_id:
            highlights[header_id] = "subpoint"

        for variant in subpoint.get("variants", []):
            active = variant_is_active(variant, is_bank_employee)
            header_id = variant.get("header_block_id")
            if header_id:
                highlights[header_id] = "variant-active" if active else "variant-inactive"

            role = "content-active" if active else "content-inactive"
            for block_id in variant.get("content_block_ids", []):
                highlights[block_id] = role

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
        if role:
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


def merge_edited_into_source(source_html: str, edited_html: str) -> str:
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

    return annotate_blocks(src_root.decode_contents())


def _is_section_intro(block: Tag) -> bool:
    text = _normalize_text(block.get_text(" ", strip=True))
    return bool(_SECTION_INTRO_RE.search(text))


def _is_variant_header(block: Tag) -> bool:
    text = _normalize_text(block.get_text(" ", strip=True))
    return bool(_VARIANT_HEADER_RE.search(text))


def _is_variant_related_red(block: Tag) -> bool:
    if not is_red_block(block):
        return False
    text = _normalize_text(block.get_text(" ", strip=True))
    return bool(
        _VARIANT_HEADER_RE.search(text)
        or _SECTION_INTRO_RE.search(text)
        or _BANK_EMPLOYEE_HINT_RE.search(text)
    )


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
