import html
import re
from pathlib import Path

from docflow_docx.pages import (
    load_document_settings,
    load_edit_html,
    load_source_html,
    load_variant_rules,
    make_editable,
    needs_numbering_refresh,
    prepare_edit_html,
    save_edit_html,
    save_variant_rules,
)
from docflow_docx.renderer import render_docx_html
from docflow_docx.structure import (
    annotate_blocks,
    apply_highlights,
    apply_variant_rules,
    detect_structure,
    get_highlight_map,
    has_configured_rules,
    has_contract_variants,
    has_variant_rules,
    load_or_detect_rules,
    make_structure_editable,
    merge_edited_into_source,
    normalize_rules,
)
from docflow_docx.writer import write_docx_from_html


def _load_docx_context(path: Path) -> dict:
    saved_html = load_edit_html(path)
    if saved_html and needs_numbering_refresh(saved_html):
        saved_html = None

    source_html = load_source_html(path)
    if not source_html:
        source_html = render_docx_html(path)

    source_html = annotate_blocks(source_html)
    settings = load_document_settings(path)
    stored_rules = load_variant_rules(path)
    rules = load_or_detect_rules(source_html, stored_rules)

    if stored_rules is None and has_variant_rules(rules):
        save_variant_rules(path, rules)

    return {
        "saved_html": saved_html,
        "source_html": source_html,
        "settings": settings,
        "rules": rules,
    }


def _document_settings(ctx: dict) -> dict:
    settings = dict(ctx["settings"])
    settings["has_contract_variants"] = has_contract_variants(ctx["source_html"])
    settings["has_configured_rules"] = has_configured_rules(ctx["rules"])
    settings["variant_rules"] = ctx["rules"]
    return settings


def _resolve_display_html(ctx: dict) -> str:
    """Єдине джерело вмісту — source_html; html лише кеш відображення."""
    return _resolve_preview_html(
        ctx["source_html"],
        ctx["rules"],
        ctx["settings"],
    )


def build_preview(path: Path, extension: str, name: str) -> tuple[str | None, str, dict]:
    document_settings: dict = {}

    if extension == ".txt":
        text = path.read_text(encoding="utf-8", errors="replace")
        saved = load_edit_html(path)
        preview = make_editable(saved or _text_to_preview_html(text), "txt-document")
        return text, preview, document_settings

    if extension == ".docx":
        ctx = _load_docx_context(path)
        display_html = _resolve_display_html(ctx)

        if ctx["saved_html"] is None:
            save_edit_html(
                path,
                display_html,
                source_html=ctx["source_html"],
                settings=ctx["settings"],
                variant_rules=ctx["rules"],
            )

        preview = make_editable(display_html)
        return None, preview, _document_settings(ctx)

    if extension == ".pdf":
        return None, _pdf_to_preview_html(path), document_settings

    return None, (
        f'<p class="preview-placeholder">'
        f'Попередній перегляд не підтримується для <code>{html.escape(extension)}</code>.'
        f"</p>"
    ), document_settings


def build_edit_view(path: Path) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    return _build_edit_view_from_source(ctx)


def build_edit_view_from_html(path: Path, html_content: str) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    clean_html = annotate_blocks(prepare_edit_html(html_content))
    source_html = _session_source_html(ctx["source_html"], clean_html, ctx["settings"])
    session_ctx = {**ctx, "source_html": source_html}
    return _build_edit_view_from_source(session_ctx)


def build_preview_from_html(path: Path, html_content: str) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    clean_html = annotate_blocks(prepare_edit_html(html_content))
    source_html = _session_source_html(ctx["source_html"], clean_html, ctx["settings"])
    session_ctx = {**ctx, "source_html": source_html}
    display_html = _resolve_display_html(session_ctx)
    return make_editable(display_html), _document_settings(session_ctx)


def _session_source_html(
    stored_source: str,
    clean_html: str,
    settings: dict,
) -> str:
    if settings.get("is_bank_employee") is not None and stored_source:
        return annotate_blocks(merge_edited_into_source(stored_source, clean_html))
    return clean_html


def _build_edit_view_from_source(ctx: dict) -> tuple[str, dict]:
    is_bank_employee = ctx["settings"].get("is_bank_employee")
    highlights = get_highlight_map(ctx["rules"], is_bank_employee)
    marked_html = apply_highlights(ctx["source_html"], highlights)
    return make_structure_editable(marked_html), _document_settings(ctx)


def apply_document_setting(path: Path, is_bank_employee: bool) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    filtered_html = apply_variant_rules(
        ctx["source_html"],
        ctx["rules"],
        is_bank_employee,
    )

    settings = {
        **ctx["settings"],
        "is_bank_employee": is_bank_employee,
        "has_contract_variants": has_contract_variants(ctx["source_html"]),
        "has_configured_rules": has_configured_rules(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    save_edit_html(
        path,
        filtered_html,
        source_html=ctx["source_html"],
        settings=settings,
        variant_rules=ctx["rules"],
    )
    return make_editable(filtered_html), settings


def save_docx_content(path: Path, html_content: str) -> dict:
    clean_html = prepare_edit_html(html_content)
    clean_html = annotate_blocks(clean_html)

    settings = load_document_settings(path)
    stored_rules = load_variant_rules(path)
    existing_source = load_source_html(path) or ""

    if settings.get("is_bank_employee") is not None and existing_source:
        merged = merge_edited_into_source(existing_source, clean_html)
        source_html = annotate_blocks(merged)
    else:
        source_html = clean_html

    rules = load_or_detect_rules(source_html, stored_rules)
    display_html = _resolve_preview_html(source_html, rules, settings)

    write_docx_from_html(path, clean_html)
    save_edit_html(
        path,
        display_html,
        source_html=source_html,
        settings=settings,
        variant_rules=rules,
    )

    return {
        **settings,
        "has_contract_variants": has_contract_variants(source_html),
        "has_configured_rules": has_configured_rules(rules),
        "variant_rules": rules,
    }


def save_rules_and_refresh(path: Path, rules: dict) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    if not rules.get("subpoints"):
        preserved_rules = rules.get("rules") or []
        preserved_items = rules.get("rule_items") or []
        rules = detect_structure(ctx["source_html"])
        rules["rules"] = preserved_rules
        rules["rule_items"] = [
            item
            for item in preserved_items
            if any(sp["id"] == item.get("subpoint_id") for sp in rules["subpoints"])
        ]

    rules = normalize_rules(rules)

    save_variant_rules(path, rules)
    ctx["rules"] = rules

    display_html = _resolve_preview_html(
        ctx["source_html"],
        rules,
        ctx["settings"],
    )
    save_edit_html(
        path,
        display_html,
        source_html=ctx["source_html"],
        settings=ctx["settings"],
        variant_rules=rules,
    )

    highlights = get_highlight_map(rules, ctx["settings"].get("is_bank_employee"))
    marked_html = apply_highlights(ctx["source_html"], highlights)

    return make_structure_editable(marked_html), _document_settings(ctx)


def _resolve_preview_html(source_html: str, rules: dict, settings: dict) -> str:
    is_bank_employee = settings.get("is_bank_employee")
    if is_bank_employee is None:
        return source_html
    return apply_variant_rules(source_html, rules, bool(is_bank_employee))


def _text_to_preview_html(text: str) -> str:
    lines = text.splitlines()
    if not lines:
        return '<p class="preview-empty">Порожній файл</p>'

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
