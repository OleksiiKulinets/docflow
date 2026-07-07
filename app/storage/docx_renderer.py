import base64
import html
from pathlib import Path

from docx import Document
from docx.document import Document as DocumentObject
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_UNDERLINE
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from storage.docx_numbering import (
    NumberingState,
    build_numbering_state,
    is_list_paragraph,
)

DOCX_PAGE_STYLE = (
    "width:210mm;min-height:297mm;margin:0 auto;"
    "padding:25.4mm;box-sizing:border-box;"
    "background:#fff;"
    "font-family:Calibri,'Segoe UI',Arial,sans-serif;"
    "font-size:11pt;line-height:1.15;color:#000;"
)

ALIGNMENT_MAP = {
    WD_ALIGN_PARAGRAPH.LEFT: "left",
    WD_ALIGN_PARAGRAPH.CENTER: "center",
    WD_ALIGN_PARAGRAPH.RIGHT: "right",
    WD_ALIGN_PARAGRAPH.JUSTIFY: "justify",
}


def render_docx_html(path: Path) -> str:
    doc = Document(path)
    numbering = build_numbering_state(doc)
    parts = ['<div class="docx-document" style="', DOCX_PAGE_STYLE, '">']

    for block in _iter_block_items(doc):
        if isinstance(block, Paragraph):
            if is_list_paragraph(block):
                parts.append(_render_list_paragraph(block, numbering))
            else:
                parts.append(_render_paragraph(block))
        else:
            parts.append(_render_table(block, numbering))

    parts.append("</div>")

    body = "".join(parts).strip()
    if body == f'<div class="docx-document" style="{DOCX_PAGE_STYLE}"></div>':
        return '<p class="preview-empty">Empty document</p>'
    return body


def _iter_block_items(parent: DocumentObject):
    for child in parent.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def _render_list_paragraph(paragraph: Paragraph, numbering: NumberingState) -> str:
    label, is_bullet = numbering.label_for(paragraph)
    text_html = _render_runs(paragraph)
    images = _render_images(paragraph)

    prefix = ""
    if label:
        escaped = html.escape(label)
        if is_bullet:
            prefix = f'<span class="docx-num-marker">{escaped}</span>&nbsp;'
        else:
            suffix = "" if label.endswith((" ", ".", ")", ":", ";")) else " "
            prefix = f'<span class="docx-num-marker">{escaped}</span>{suffix}'

    style = _paragraph_style(paragraph)
    style_attr = f' style="{style}"' if style else ""
    return (
        f'<p class="docx-p docx-numbered"{style_attr}>{prefix}{text_html}{images}</p>'
    )


def _render_paragraph(paragraph: Paragraph) -> str:
    if _is_page_break(paragraph):
        return '<div class="docx-page-break"></div>'

    images = _render_images(paragraph)
    text_html = _render_runs(paragraph)

    if not text_html and not images:
        return '<p class="docx-p" style="margin:0">&nbsp;</p>'

    style = _paragraph_style(paragraph)
    tag = _paragraph_tag(paragraph)
    style_attr = f' style="{style}"' if style else ""

    return f"<{tag} class=\"docx-p\"{style_attr}>{text_html}{images}</{tag}>"


def _paragraph_tag(paragraph: Paragraph) -> str:
    style_name = (paragraph.style.name or "").lower()
    if "heading 1" in style_name or style_name == "title":
        return "h1"
    if "heading 2" in style_name:
        return "h2"
    if "heading 3" in style_name:
        return "h3"
    if "heading 4" in style_name:
        return "h4"
    if "heading 5" in style_name:
        return "h5"
    if "heading 6" in style_name:
        return "h6"
    return "p"


def _paragraph_style(paragraph: Paragraph) -> str:
    pf = paragraph.paragraph_format
    styles: list[str] = []

    if pf.alignment is not None:
        align = ALIGNMENT_MAP.get(pf.alignment)
        if align:
            styles.append(f"text-align:{align}")

    for attr, css_prop in (
        (pf.left_indent, "margin-left"),
        (pf.right_indent, "margin-right"),
        (pf.first_line_indent, "text-indent"),
        (pf.space_before, "margin-top"),
        (pf.space_after, "margin-bottom"),
    ):
        pt = _length_pt(attr)
        if pt is not None:
            styles.append(f"{css_prop}:{pt}pt")

    line_spacing = _line_spacing_css(pf)
    if line_spacing:
        styles.append(f"line-height:{line_spacing}")

    style_font = _style_font_css(paragraph)
    if style_font:
        styles.append(style_font)

    return ";".join(styles)


def _style_font_css(paragraph: Paragraph) -> str | None:
    try:
        font = paragraph.style.font
    except Exception:
        return None

    parts: list[str] = []
    if font.name:
        parts.append(f"font-family:'{font.name}',Calibri,sans-serif")
    if font.size and font.size.pt:
        parts.append(f"font-size:{font.size.pt}pt")
    if font.bold:
        parts.append("font-weight:bold")
    if font.italic:
        parts.append("font-style:italic")
    if font.color and font.color.rgb:
        parts.append(f"color:#{font.color.rgb}")

    return ";".join(parts) if parts else None


def _line_spacing_css(pf) -> str | None:
    spacing = pf.line_spacing
    spacing_rule = pf.line_spacing_rule

    if spacing is None:
        return None

    if spacing_rule == WD_LINE_SPACING.MULTIPLE:
        return str(round(float(spacing), 2))

    pt = _length_pt(spacing)
    if pt is not None:
        return f"{pt}pt"
    return None


def _length_pt(value) -> float | None:
    if value is None:
        return None
    try:
        pt = value.pt
        return round(pt, 2) if pt else None
    except Exception:
        return None


def _render_runs(paragraph: Paragraph) -> str:
    return "".join(_render_run(run) for run in paragraph.runs)


def _render_run(run) -> str:
    text = run.text
    if not text:
        return ""

    escaped = html.escape(text).replace("\t", "&emsp;&emsp;")
    styles = _run_style(run)

    if run.font.superscript:
        return f'<sup style="{styles}">{escaped}</sup>' if styles else f"<sup>{escaped}</sup>"
    if run.font.subscript:
        return f'<sub style="{styles}">{escaped}</sub>' if styles else f"<sub>{escaped}</sub>"

    if styles:
        return f'<span style="{styles}">{escaped}</span>'
    return escaped


def _run_style(run) -> str:
    font = run.font
    styles: list[str] = []
    decorations: list[str] = []

    if run.bold or (font.bold is True):
        styles.append("font-weight:bold")
    if run.italic or (font.italic is True):
        styles.append("font-style:italic")

    underline = font.underline
    if underline and underline != WD_UNDERLINE.NONE:
        decorations.append("underline")
    if font.strike:
        decorations.append("line-through")
    if decorations:
        styles.append(f"text-decoration:{' '.join(decorations)}")

    if font.name:
        styles.append(f"font-family:'{font.name}',Calibri,sans-serif")
    if font.size and font.size.pt:
        styles.append(f"font-size:{font.size.pt}pt")
    if font.color and font.color.rgb:
        styles.append(f"color:#{font.color.rgb}")
    if font.highlight_color:
        styles.append(f"background-color:{_highlight_color(font.highlight_color)}")

    return ";".join(styles)


def _highlight_color(value) -> str:
    colors = {
        1: "#ffff00",
        2: "#00ff00",
        3: "#00ffff",
        4: "#ff00ff",
        5: "#0000ff",
        6: "#ff0000",
        7: "#00008b",
        8: "#008b8b",
    }
    return colors.get(int(value), "#ffff00")


def _render_images(paragraph: Paragraph) -> str:
    parts: list[str] = []
    for run in paragraph.runs:
        for blip in run._element.findall(".//" + qn("a:blip")):
            embed = blip.get(qn("r:embed"))
            if not embed:
                continue
            try:
                image_part = paragraph.part.related_parts[embed]
                blob = image_part.blob
                content_type = image_part.content_type
                encoded = base64.b64encode(blob).decode("ascii")
                parts.append(
                    f'<img class="docx-image" src="data:{content_type};base64,{encoded}" '
                    f'alt="" style="max-width:100%;height:auto;display:inline-block;vertical-align:middle">'
                )
            except Exception:
                continue
    return "".join(parts)


def _render_table(table: Table, numbering: NumberingState) -> str:
    rows_html: list[str] = []
    for row in table.rows:
        cells_html: list[str] = []
        for cell in row.cells:
            blocks: list[str] = []
            for p in cell.paragraphs:
                if is_list_paragraph(p):
                    blocks.append(_render_list_paragraph(p, numbering))
                else:
                    blocks.append(_render_paragraph(p))
            cell_content = "".join(blocks)
            if not cell_content.strip():
                cell_content = '<p class="docx-p docx-cell-p" style="margin:0">&nbsp;</p>'
            cell_style = _table_cell_style(cell)
            cells_html.append(f'<td style="{cell_style}">{cell_content}</td>')
        rows_html.append(f"<tr>{''.join(cells_html)}</tr>")

    table_style = "border-collapse:collapse;width:100%;margin:8pt 0;font-size:inherit"
    return f'<table class="docx-table" style="{table_style}"><tbody>{"".join(rows_html)}</tbody></table>'


def _table_cell_style(cell) -> str:
    styles = ["border:1px solid #bfbfbf;padding:4pt 6pt;vertical-align:top"]
    try:
        width = cell.width
        if width and width.pt:
            styles.append(f"width:{width.pt}pt")
    except Exception:
        pass
    return ";".join(styles)


def _is_page_break(paragraph: Paragraph) -> bool:
    for run in paragraph.runs:
        for br in run._element.findall(".//" + qn("w:br")):
            if br.get(qn("w:type")) == "page":
                return True
    return False


