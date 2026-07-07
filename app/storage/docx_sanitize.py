import re

from bs4 import BeautifulSoup, NavigableString, Tag

BLOCK_TAGS = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "div"}
CELL_TAGS = {"td", "th"}
ZWSP = "\u200b"


def sanitize_edit_html(html: str) -> str:
    if not html or not html.strip():
        return html

    soup = BeautifulSoup(f"<div id='docx-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="docx-root")
    if root is None:
        return html

    _remove_orphan_table_parts(root)
    _normalize_tables(root)
    _normalize_paragraphs(root)
    _strip_editor_artifacts(root)

    return root.decode_contents()


def _remove_orphan_table_parts(root: Tag) -> None:
    for tag_name in ("tr", "td", "th", "tbody", "thead", "tfoot"):
        for node in list(root.find_all(tag_name)):
            if node.find_parent("table") is None:
                node.decompose()


def _normalize_tables(root: Tag) -> None:
    for table in list(root.find_all("table")):
        rows = table.find_all("tr")
        if not rows:
            table.decompose()
            continue

        if table.find("tbody") is None:
            tbody = root.new_tag("tbody")
            for row in list(table.find_all("tr", recursive=False)):
                tbody.append(row.extract())
            table.append(tbody)

        for row in list(table.find_all("tr")):
            cells = row.find_all(list(CELL_TAGS), recursive=False)
            if not cells:
                row.decompose()
                continue
            for cell in cells:
                _normalize_cell(cell)


def _normalize_cell(cell: Tag) -> None:
    for div in cell.find_all("div", recursive=False):
        if div.parent is cell:
            div.name = "p"
            classes = list(div.get("class") or [])
            if "docx-p" not in classes:
                classes.append("docx-p")
            if "docx-cell-p" not in classes:
                classes.append("docx-cell-p")
            div["class"] = classes

    blocks = [
        child
        for child in cell.children
        if isinstance(child, Tag) and child.name in BLOCK_TAGS
    ]

    if not blocks:
        text = cell.get_text().replace(ZWSP, "").replace("\xa0", "").strip()
        cell.clear()
        p = cell.new_tag("p")
        p["class"] = ["docx-p", "docx-cell-p"]
        p["style"] = "margin:0"
        p.append(NavigableString(text if text else "\xa0"))
        cell.append(p)
        return

    for block in blocks:
        classes = list(block.get("class") or [])
        if "docx-p" not in classes:
            classes.append("docx-p")
        if "docx-cell-p" not in classes:
            classes.append("docx-cell-p")
        block["class"] = classes
        if not block.get("style"):
            block["style"] = "margin:0"

        text = block.get_text().replace(ZWSP, "").replace("\xa0", "").strip()
        if not text and not block.find("img") and not block.find("br"):
            block.clear()
            block.append(NavigableString("\xa0"))


def _normalize_paragraphs(root: Tag) -> None:
    for p in root.find_all("p"):
        if p.find_parent("table"):
            continue
        text = p.get_text().replace(ZWSP, "").replace("\xa0", "").strip()
        if not text and not p.find("img") and not p.find("br"):
            p.clear()
            p.append(NavigableString("\xa0"))


def _strip_editor_artifacts(root: Tag) -> None:
    for span in list(root.find_all("span")):
        style = span.get("style", "")
        has_style = any(
            key in style
            for key in ("font-size", "font-family", "color", "background", "font-weight", "font-style")
        )
        text = span.get_text().replace(ZWSP, "")
        if not text.strip() and not span.find() and not has_style:
            span.decompose()
            continue
        if ZWSP in span.get_text():
            for text_node in span.find_all(string=True):
                cleaned = str(text_node).replace(ZWSP, "")
                if cleaned:
                    text_node.replace_with(cleaned)
                else:
                    text_node.extract()

    for font in list(root.find_all("font")):
        font.unwrap()

    for br in list(root.find_all("br")):
        if br.parent and br.parent.name in CELL_TAGS:
            br.decompose()
