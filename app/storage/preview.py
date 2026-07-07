import html
import re
from pathlib import Path

from storage.docx_pages import load_edit_html, make_editable, needs_numbering_refresh
from storage.docx_renderer import render_docx_html


def build_preview(path: Path, extension: str, name: str) -> tuple[str | None, str]:
    if extension == ".txt":
        text = path.read_text(encoding="utf-8", errors="replace")
        saved = load_edit_html(path)
        preview = make_editable(saved or _text_to_preview_html(text), "txt-document")
        return text, preview

    if extension == ".docx":
        saved = load_edit_html(path)
        if saved and needs_numbering_refresh(saved):
            saved = None
        source = saved if saved else render_docx_html(path)
        preview = make_editable(source)
        return None, preview

    if extension == ".pdf":
        return None, _pdf_to_preview_html(path)

    return None, (
        f'<p class="preview-placeholder">'
        f'Unsupported preview for <code>{html.escape(extension)}</code>.'
        f"</p>"
    )


def _text_to_preview_html(text: str) -> str:
    lines = text.splitlines()
    if not lines:
        return '<p class="preview-empty">Empty file</p>'

    if len(lines) == 1:
        return f"<p class=\"docx-p\">{html.escape(lines[0])}</p>"

    body = "".join(
        f"<p class=\"docx-p\">{html.escape(line) if line else '&nbsp;'}</p>"
        for line in lines
    )
    return body


def html_to_text(html_content: str) -> str:
    content = html_content
    content = re.sub(r"<br\s*/?>", "\n", content, flags=re.I)
    content = re.sub(r"<[^>]+>", "\n", content)
    lines = [line.replace("\xa0", " ").rstrip() for line in content.splitlines()]
    return "\n".join(lines).strip() + ("\n" if lines else "")


def _pdf_to_preview_html(path: Path) -> str:
    uri = html.escape(path.resolve().as_uri())
    return (
        f'<div class="pdf-preview">'
        f'<embed src="{uri}" type="application/pdf" class="pdf-embed">'
        f"</div>"
    )
