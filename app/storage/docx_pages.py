import json
from pathlib import Path

from bs4 import BeautifulSoup, Tag

from storage.docx_sanitize import sanitize_edit_html


def edit_json_path(file_path: Path) -> Path:
    return file_path.parent / f"{file_path.name}.edit.json"


def load_edit_html(file_path: Path) -> str | None:
    path = edit_json_path(file_path)
    if not path.exists():
        return None

    data = json.loads(path.read_text(encoding="utf-8"))
    if "html" in data:
        return data["html"]
    if "pages" in data:
        return "".join(page.get("html", "") for page in data["pages"])
    return None


def save_edit_html(file_path: Path, html: str) -> None:
    path = edit_json_path(file_path)
    path.write_text(
        json.dumps({"html": html}, ensure_ascii=False, indent=2),
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


def make_editable(html: str, extra_class: str = "") -> str:
    html = strip_variant_wrappers(html)
    classes = "docx-document docx-editable"
    if extra_class:
        classes += f" {extra_class}"

    if 'class="docx-document' in html:
        inner = html.replace(
            'class="docx-document',
            f'class="{classes}" contenteditable="true" spellcheck="true"',
            1,
        )
    else:
        inner = (
            f'<div class="{classes}" contenteditable="true" spellcheck="true">'
            f"{html}</div>"
        )

    return f'<div class="docx-canvas">{inner}</div>'


def prepare_edit_html(html: str) -> str:
    return sanitize_edit_html(strip_variant_wrappers(html))
