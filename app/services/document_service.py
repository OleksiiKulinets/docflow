import html
import re
from datetime import datetime, timezone
from pathlib import Path

from docflow_docx.pages import (
    load_document_settings,
    load_edit_html,
    load_source_html,
    load_variant_rules,
    load_draft_source_html,
    make_editable,
    needs_numbering_refresh,
    prepare_edit_html,
    save_edit_html,
    save_draft_source_html,
    save_variant_rules,
)
from docflow_docx.renderer import render_docx_html
from docflow_docx.structure import (
    annotate_blocks,
    apply_highlights,
    apply_preview_overlay,
    apply_variant_rules,
    get_highlight_map,
    collect_top_level_block_ids,
    get_active_condition_ids,
    has_configured_rules,
    has_contract_variants,
    has_variant_rules,
    load_or_detect_rules,
    make_structure_editable,
    merge_edited_into_source,
    normalize_rules,
    strip_preview_decorations,
    _condition_values_from_settings,
    _explicit_condition_values,
    _rules_ready_to_apply,
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
    settings["active_condition_ids"] = get_active_condition_ids(ctx["rules"])
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
        ctx["rules"] = normalize_rules(ctx["rules"])
        save_variant_rules(path, ctx["rules"])

        open_settings = dict(ctx["settings"])
        open_settings["condition_values"] = {}
        open_settings.pop("is_bank_employee", None)
        open_settings["approved"] = False
        open_settings["approval_pending"] = False
        open_settings.pop("approved_at", None)

        display_html = _build_preview_display_html(
            ctx["source_html"],
            ctx["rules"],
            open_settings,
        )

        save_edit_html(
            path,
            display_html,
            source_html=ctx["source_html"],
            settings=open_settings,
            variant_rules=ctx["rules"],
        )
        save_draft_source_html(path, ctx["source_html"])

        preview = make_editable(display_html)
        settings = _document_settings({**ctx, "settings": open_settings})
        return None, preview, settings

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
    clean_html = annotate_blocks(
        strip_preview_decorations(prepare_edit_html(html_content))
    )
    source_html = _session_source_html(
        ctx["source_html"], clean_html, ctx["settings"], rules=ctx["rules"]
    )
    session_ctx = {**ctx, "source_html": source_html}
    return _build_edit_view_from_source(session_ctx)


def build_preview_from_html(path: Path, html_content: str) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    clean_html = annotate_blocks(
        strip_preview_decorations(prepare_edit_html(html_content))
    )
    source_html = _session_source_html(
        ctx["source_html"], clean_html, ctx["settings"], rules=ctx["rules"]
    )
    session_ctx = {**ctx, "source_html": source_html}
    display_html = _resolve_display_html(session_ctx)
    save_edit_html(
        path,
        display_html,
        source_html=source_html,
        settings=ctx["settings"],
        variant_rules=ctx["rules"],
    )
    return make_editable(display_html), _document_settings(session_ctx)


def sync_document_source(path: Path, html_content: str) -> tuple[str, str, dict]:
    ctx = _load_docx_context(path)
    clean_html = annotate_blocks(
        strip_preview_decorations(prepare_edit_html(html_content))
    )
    source_html = _session_source_html(
        ctx["source_html"], clean_html, ctx["settings"], rules=ctx["rules"]
    )
    session_ctx = {**ctx, "source_html": source_html}

    preview_html = _build_preview_display_html(
        source_html,
        ctx["rules"],
        ctx["settings"],
    )
    edit_html, _ = _build_edit_view_from_source(session_ctx)

    save_edit_html(
        path,
        preview_html,
        source_html=source_html,
        settings=ctx["settings"],
        variant_rules=ctx["rules"],
    )
    save_draft_source_html(path, source_html)

    return (
        make_editable(preview_html),
        edit_html,
        _document_settings(session_ctx),
    )


def _session_source_html(
    stored_source: str,
    clean_html: str,
    settings: dict,
    *,
    rules: dict | None = None,
) -> str:
    if not clean_html:
        return annotate_blocks(stored_source or "")
    if stored_source:
        deletable_block_ids = None
        if rules is not None:
            preview_html = _build_preview_display_html(stored_source, rules, settings)
            deletable_block_ids = collect_top_level_block_ids(preview_html)
        return annotate_blocks(
            merge_edited_into_source(
                stored_source,
                clean_html,
                deletable_block_ids=deletable_block_ids,
            )
        )
    return annotate_blocks(clean_html)


def _build_edit_view_from_source(ctx: dict) -> tuple[str, dict]:
    condition_values = _condition_values_from_settings(ctx["settings"])
    highlights = get_highlight_map(ctx["rules"], condition_values=condition_values)
    marked_html = apply_highlights(ctx["source_html"], highlights)
    return make_structure_editable(marked_html), _document_settings(ctx)


def apply_document_setting(
    path: Path,
    condition_id: str,
    value,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    if rules is not None:
        ctx["rules"] = normalize_rules(rules)
    else:
        ctx["rules"] = normalize_rules(ctx["rules"])
    save_variant_rules(path, ctx["rules"])

    if all_condition_values is not None:
        condition_values = {
            key: val
            for key, val in all_condition_values.items()
            if val is not None
        }
    else:
        condition_values = _explicit_condition_values(ctx["settings"])
        condition_values[condition_id] = value

    filtered_html = _build_preview_display_html(
        ctx["source_html"],
        ctx["rules"],
        {
            **ctx["settings"],
            "condition_values": condition_values,
        },
    )

    settings = {
        **ctx["settings"],
        "condition_values": condition_values,
        "approved": False,
        "approval_pending": False,
        "has_contract_variants": has_contract_variants(ctx["source_html"]),
        "has_configured_rules": has_configured_rules(ctx["rules"]),
        "active_condition_ids": get_active_condition_ids(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    settings.pop("approved_at", None)
    if condition_id == "bank_employee":
        settings["is_bank_employee"] = value

    save_edit_html(
        path,
        filtered_html,
        source_html=ctx["source_html"],
        settings=settings,
        variant_rules=ctx["rules"],
    )
    return make_editable(filtered_html), settings


def apply_bank_employee_setting(path: Path, is_bank_employee: bool) -> tuple[str, dict]:
    return apply_document_setting(path, "bank_employee", is_bank_employee)


def clear_document_setting(
    path: Path,
    condition_id: str,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    if rules is not None:
        ctx["rules"] = normalize_rules(rules)
    else:
        ctx["rules"] = normalize_rules(ctx["rules"])
    save_variant_rules(path, ctx["rules"])

    if all_condition_values is not None:
        condition_values = {
            key: val
            for key, val in all_condition_values.items()
            if val is not None
        }
    else:
        condition_values = _explicit_condition_values(ctx["settings"])
        condition_values.pop(condition_id, None)

    settings = {
        **ctx["settings"],
        "condition_values": condition_values,
        "approved": False,
        "has_contract_variants": has_contract_variants(ctx["source_html"]),
        "has_configured_rules": has_configured_rules(ctx["rules"]),
        "active_condition_ids": get_active_condition_ids(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    settings.pop("approved_at", None)
    if condition_id == "bank_employee":
        settings.pop("is_bank_employee", None)

    display_html = _build_preview_display_html(
        ctx["source_html"],
        ctx["rules"],
        settings,
    )
    save_edit_html(
        path,
        display_html,
        source_html=ctx["source_html"],
        settings=settings,
        variant_rules=ctx["rules"],
    )
    return make_editable(display_html), settings


def preview_approval_document(
    path: Path,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    if rules is not None:
        ctx["rules"] = normalize_rules(rules)
    else:
        ctx["rules"] = normalize_rules(ctx["rules"])
    save_variant_rules(path, ctx["rules"])

    if all_condition_values is not None:
        condition_values = {
            key: val
            for key, val in all_condition_values.items()
            if val is not None
        }
    else:
        condition_values = _explicit_condition_values(ctx["settings"])

    if not _rules_ready_to_apply(ctx["rules"], condition_values):
        raise ValueError(
            "Заповніть усі умови та правила (група або маркер) перед затвердженням"
        )

    preview_html = apply_variant_rules(
        ctx["source_html"],
        ctx["rules"],
        condition_values=condition_values,
        finalize=True,
    )

    draft_source = ctx["source_html"]
    settings = {
        **ctx["settings"],
        "condition_values": condition_values,
        "approved": False,
        "approval_pending": True,
        "has_contract_variants": has_contract_variants(draft_source),
        "has_configured_rules": has_configured_rules(ctx["rules"]),
        "active_condition_ids": get_active_condition_ids(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    settings.pop("approved_at", None)

    save_edit_html(
        path,
        preview_html,
        source_html=draft_source,
        settings=settings,
        variant_rules=ctx["rules"],
    )
    save_draft_source_html(path, draft_source)
    return make_editable(preview_html), settings


def cancel_approval_preview(
    path: Path,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    if not ctx["settings"].get("approval_pending"):
        raise ValueError("Немає перегляду для скасування")

    if rules is not None:
        ctx["rules"] = normalize_rules(rules)
    else:
        ctx["rules"] = normalize_rules(ctx["rules"])
    save_variant_rules(path, ctx["rules"])

    draft_source = load_draft_source_html(path) or ctx["source_html"]

    if all_condition_values is not None:
        condition_values = {
            key: val
            for key, val in all_condition_values.items()
            if val is not None
        }
    else:
        condition_values = _explicit_condition_values(ctx["settings"])

    settings = {
        **ctx["settings"],
        "condition_values": condition_values,
        "approved": False,
        "approval_pending": False,
        "has_contract_variants": has_contract_variants(draft_source),
        "has_configured_rules": has_configured_rules(ctx["rules"]),
        "active_condition_ids": get_active_condition_ids(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    settings.pop("approved_at", None)

    preview_html = _build_preview_display_html(draft_source, ctx["rules"], settings)
    save_edit_html(
        path,
        preview_html,
        source_html=draft_source,
        settings=settings,
        variant_rules=ctx["rules"],
    )
    save_draft_source_html(path, draft_source)
    return make_editable(preview_html), settings


def approve_document(
    path: Path,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    if rules is not None:
        ctx["rules"] = normalize_rules(rules)
    else:
        ctx["rules"] = normalize_rules(ctx["rules"])
    save_variant_rules(path, ctx["rules"])

    if all_condition_values is not None:
        condition_values = {
            key: val
            for key, val in all_condition_values.items()
            if val is not None
        }
    else:
        condition_values = _explicit_condition_values(ctx["settings"])

    if not ctx["settings"].get("approval_pending"):
        raise ValueError(
            "Спочатку натисніть «Затвердити» і перегляньте документ без інструкцій"
        )

    if not _rules_ready_to_apply(ctx["rules"], condition_values):
        raise ValueError(
            "Заповніть усі умови та правила (група або маркер) перед затвердженням"
        )

    final_html = apply_variant_rules(
        ctx["source_html"],
        ctx["rules"],
        condition_values=condition_values,
        finalize=True,
    )

    draft_source = ctx["source_html"]

    settings = {
        **ctx["settings"],
        "condition_values": condition_values,
        "approved": True,
        "approval_pending": False,
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "has_contract_variants": has_contract_variants(draft_source),
        "has_configured_rules": has_configured_rules(ctx["rules"]),
        "active_condition_ids": get_active_condition_ids(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }

    write_docx_from_html(path, final_html)
    save_edit_html(
        path,
        final_html,
        source_html=draft_source,
        settings=settings,
        variant_rules=ctx["rules"],
    )
    save_draft_source_html(path, draft_source)
    return make_editable(final_html), settings


def revert_document_approval(
    path: Path,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    if not ctx["settings"].get("approved"):
        raise ValueError("Документ ще не затверджено")

    if rules is not None:
        ctx["rules"] = normalize_rules(rules)
    else:
        ctx["rules"] = normalize_rules(ctx["rules"])
    save_variant_rules(path, ctx["rules"])

    draft_source = load_draft_source_html(path)
    if not draft_source:
        raise ValueError("Немає збереженої чернетки для відновлення редагування")

    if all_condition_values is not None:
        condition_values = {
            key: val
            for key, val in all_condition_values.items()
            if val is not None
        }
    else:
        condition_values = _explicit_condition_values(ctx["settings"])

    settings = {
        **ctx["settings"],
        "condition_values": condition_values,
        "approved": False,
        "approval_pending": False,
        "has_contract_variants": has_contract_variants(draft_source),
        "has_configured_rules": has_configured_rules(ctx["rules"]),
        "active_condition_ids": get_active_condition_ids(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    settings.pop("approved_at", None)

    preview_html = _build_preview_display_html(draft_source, ctx["rules"], settings)

    write_docx_from_html(path, draft_source)
    save_edit_html(
        path,
        preview_html,
        source_html=draft_source,
        settings=settings,
        variant_rules=ctx["rules"],
    )
    save_draft_source_html(path, draft_source)
    return make_editable(preview_html), settings


def save_docx_content(path: Path, html_content: str) -> dict:
    clean_html = prepare_edit_html(html_content)
    clean_html = annotate_blocks(clean_html)

    settings = load_document_settings(path)
    stored_rules = load_variant_rules(path)
    existing_source = load_source_html(path) or ""
    rules = load_or_detect_rules(existing_source or clean_html, stored_rules)

    if existing_source:
        deletable_block_ids = collect_top_level_block_ids(
            _build_preview_display_html(existing_source, rules, settings)
        )
        merged = merge_edited_into_source(
            existing_source,
            clean_html,
            deletable_block_ids=deletable_block_ids,
        )
        source_html = annotate_blocks(merged)
    else:
        source_html = clean_html

    display_html = _resolve_preview_html(source_html, rules, settings)

    write_docx_from_html(path, display_html)
    save_edit_html(
        path,
        display_html,
        source_html=source_html,
        settings=settings,
        variant_rules=rules,
    )
    save_variant_rules(path, rules)
    save_draft_source_html(path, source_html)

    return {
        **settings,
        "has_contract_variants": has_contract_variants(source_html),
        "has_configured_rules": has_configured_rules(rules),
        "active_condition_ids": get_active_condition_ids(rules),
        "variant_rules": rules,
    }


def save_rules_and_refresh(path: Path, rules: dict) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
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

    highlights = get_highlight_map(
        rules,
        condition_values=_condition_values_from_settings(ctx["settings"]),
    )
    marked_html = apply_highlights(ctx["source_html"], highlights)

    return make_structure_editable(marked_html), _document_settings(ctx)


def _build_preview_display_html(source_html: str, rules: dict, settings: dict) -> str:
    condition_values = _explicit_condition_values(settings)

    if settings.get("approved") and _rules_ready_to_apply(rules, condition_values):
        return apply_variant_rules(
            source_html,
            rules,
            condition_values=condition_values,
            finalize=True,
        )

    if settings.get("approval_pending") and _rules_ready_to_apply(rules, condition_values):
        return apply_variant_rules(
            source_html,
            rules,
            condition_values=condition_values,
            finalize=True,
        )

    return apply_preview_overlay(
        source_html,
        rules,
        condition_values=condition_values,
    )


def _resolve_preview_html(source_html: str, rules: dict, settings: dict) -> str:
    return _build_preview_display_html(source_html, rules, settings)


def refresh_docx_for_export(path: Path) -> None:
    """Перегенерує DOCX на диску з HTML, який бачить користувач у перегляді."""
    ctx = _load_docx_context(path)
    export_html = _build_preview_display_html(
        ctx["source_html"],
        ctx["rules"],
        ctx["settings"],
    )
    write_docx_from_html(path, export_html)


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
