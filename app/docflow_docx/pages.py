import json
import re
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag

from docflow_docx.renderer import DOCX_PAGE_STYLE
from docflow_docx.sanitize import sanitize_edit_html

_DOCX_ROOT_CLASS_RE = re.compile(r'class="docx-document([^"]*)"', re.IGNORECASE)


def edit_json_path(file_path: Path) -> Path:
    return file_path.parent / f"{file_path.name}.edit.json"


def load_edit_data(file_path: Path) -> dict[str, Any]:
    path = edit_json_path(file_path)
    if not path.exists():
        return {}

    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def load_edit_html(file_path: Path) -> str | None:
    data = load_edit_data(file_path)
    if "html" in data:
        return data["html"]
    if "pages" in data:
        return "".join(page.get("html", "") for page in data["pages"])
    return None


def load_source_html(file_path: Path) -> str | None:
    data = load_edit_data(file_path)
    source = data.get("source_html")
    if isinstance(source, str) and source.strip():
        return source
    return load_edit_html(file_path)


def load_document_settings(file_path: Path) -> dict[str, Any]:
    data = load_edit_data(file_path)
    settings = data.get("settings")
    return settings if isinstance(settings, dict) else {}


def load_variant_rules(file_path: Path) -> dict[str, Any] | None:
    data = load_edit_data(file_path)
    rules = data.get("variant_rules")
    return rules if isinstance(rules, dict) else None


def save_variant_rules(file_path: Path, rules: dict[str, Any]) -> None:
    path = edit_json_path(file_path)
    data = load_edit_data(file_path)
    data["variant_rules"] = rules
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def save_edit_html(
    file_path: Path,
    html: str,
    *,
    source_html: str | None = None,
    settings: dict[str, Any] | None = None,
    variant_rules: dict[str, Any] | None = None,
) -> None:
    path = edit_json_path(file_path)
    data = load_edit_data(file_path)

    data["html"] = html
    if source_html is not None:
        data["source_html"] = source_html
    elif "source_html" not in data:
        data["source_html"] = html

    if settings is not None:
        data["settings"] = settings
    elif "settings" not in data:
        data["settings"] = {}

    if variant_rules is not None:
        data["variant_rules"] = variant_rules

    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def save_document_settings(file_path: Path, settings: dict[str, Any]) -> None:
    path = edit_json_path(file_path)
    data = load_edit_data(file_path)
    data["settings"] = settings
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def strip_variant_wrappers(html: str) -> str:
    if not html or "docx-variant" not in html:
        return html

    soup = BeautifulSoup(f"<div id='strip-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="strip-root")
    if root is None:
        return html

    for variant in list(root.find_all("div", class_="docx-variant")):
        blocks: list[Tag] = []
        condition = variant.find("div", class_="docx-variant-condition")
        body = variant.find("div", class_="docx-variant-body")

        if condition:
            for block in list(condition.children):
                if isinstance(block, Tag):
                    blocks.append(block.extract())
        if body:
            for block in list(body.children):
                if isinstance(block, Tag):
                    blocks.append(block.extract())

        for block in blocks:
            variant.insert_before(block)
        variant.decompose()

    return root.decode_contents()


def needs_numbering_refresh(html: str) -> bool:
    if not html:
        return False
    return "docx-list" in html and "docx-num-marker" not in html


def patch_docx_root(html: str, classes: str, *, editable: bool) -> str:
    flag = "true" if editable else "false"

    def _replace(match: re.Match[str]) -> str:
        extra = match.group(1).strip()
        merged = f"{classes} {extra}".strip() if extra else classes
        return (
            f'class="{merged}" contenteditable="{flag}" spellcheck="{flag}"'
        )

    if _DOCX_ROOT_CLASS_RE.search(html):
        return _DOCX_ROOT_CLASS_RE.sub(_replace, html, count=1)

    return (
        f'<div class="{classes}" contenteditable="{flag}" spellcheck="{flag}" '
        f'style="{DOCX_PAGE_STYLE}">'
        f"{html}</div>"
    )


def make_editable(html: str, extra_class: str = "") -> str:
    classes = "docx-document docx-editable"
    if extra_class:
        classes += f" {extra_class}"

    inner = patch_docx_root(html, classes, editable=True)
    return f'<div class="docx-canvas">{inner}</div>'


def prepare_edit_html(html: str) -> str:
    return sanitize_edit_html(strip_variant_wrappers(html))
