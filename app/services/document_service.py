import html
import re
from datetime import datetime, timezone
from pathlib import Path

from docflow_docx.pages import (
    load_document_model,
    load_document_settings,
    load_edit_html,
    load_source_html,
    load_variant_rules,
    load_draft_source_html,
    make_editable,
    needs_numbering_refresh,
    prepare_edit_html,
    save_document_model,
    save_edit_html,
    save_draft_source_html,
    save_variant_rules,
)
from docflow_docx.renderer import render_docx_html
from docflow_docx.structure import (
    annotate_blocks,
    apply_document_model,
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


def _is_v5_model(rules: dict | None) -> bool:
    return isinstance(rules, dict) and rules.get("schema_version") == 5


def _empty_v5_model() -> dict:
    return {"schema_version": 5, "fields": [], "nodes": [], "meta": {}}


def _collect_v5_field_ids(condition) -> set[str]:
    ids: set[str] = set()
    if not condition:
        return ids
    if condition.get("type") == "predicate":
        condition_id = condition.get("condition_id")
        if condition_id:
            ids.add(str(condition_id))
        return ids
    if condition.get("type") == "not":
        ids.update(_collect_v5_field_ids(condition.get("item")))
        return ids
    for item in condition.get("items") or []:
        ids.update(_collect_v5_field_ids(item))
    return ids


def _v5_active_field_ids(model: dict) -> list[str]:
    ids: set[str] = set()
    for node in model.get("nodes") or []:
        ids.update(_collect_v5_field_ids(node.get("condition")))
    return sorted(ids)


def _v5_node_configured(model: dict, node: dict) -> bool:
    behavior = (node.get("properties") or {}).get("behavior") or {}
    if node.get("type") == "section" and behavior.get("exclusive"):
        branches = [
            child
            for child in model.get("nodes") or []
            if child.get("parent_id") == node.get("id")
            and child.get("type") == "section"
            and child.get("condition")
        ]
        if len(branches) >= 2:
            return all(_v5_node_configured(model, branch) for branch in branches)

    block_ids = ((node.get("content") or {}).get("block_ids") or [])
    if block_ids:
        return True

    children = [
        child
        for child in model.get("nodes") or []
        if child.get("parent_id") == node.get("id")
    ]
    if not children:
        return False
    return any(_v5_node_configured(model, child) for child in children)


def _v5_has_configured(model: dict) -> bool:
    roots = [node for node in model.get("nodes") or [] if not node.get("parent_id")]
    if not roots:
        return False
    return any(_v5_node_configured(model, root) for root in roots)


def _v5_rules_ready_to_apply(model: dict, condition_values: dict) -> bool:
    active_ids = _v5_active_field_ids(model)
    if not active_ids:
        return False
    if not _v5_has_configured(model):
        return False
    return all(condition_values.get(field_id) is not None for field_id in active_ids)


def _v5_preview_conditions_ready(model: dict, condition_values: dict) -> bool:
    """True when every referenced condition field has a chosen value."""
    active_ids = _v5_active_field_ids(model)
    if not active_ids:
        return False
    return all(condition_values.get(field_id) is not None for field_id in active_ids)


def _coerce_rules(rules: dict | None) -> dict:
    if _is_v5_model(rules):
        return rules
    return normalize_rules(rules)


def _resolve_ctx_rules(ctx: dict, rules: dict | None = None) -> dict:
    if rules is not None:
        return _coerce_rules(rules)
    if _is_v5_model(ctx["rules"]):
        return ctx["rules"]
    return normalize_rules(ctx["rules"])


def _persist_rules(path: Path, rules: dict) -> dict:
    rules = _coerce_rules(rules)
    if _is_v5_model(rules):
        save_document_model(path, rules)
    else:
        save_variant_rules(path, rules)
    return rules


def _rules_meta(rules: dict) -> dict[str, object]:
    if _is_v5_model(rules):
        return {
            "has_configured_rules": _v5_has_configured(rules),
            "active_condition_ids": _v5_active_field_ids(rules),
        }
    return {
        "has_configured_rules": has_configured_rules(rules),
        "active_condition_ids": get_active_condition_ids(rules),
    }


def _rules_ready(rules: dict, condition_values: dict) -> bool:
    if _is_v5_model(rules):
        return _v5_rules_ready_to_apply(rules, condition_values)
    return bool(_rules_ready_to_apply(rules, condition_values))


def _should_finalize_preview(
    rules: dict,
    condition_values: dict,
    settings: dict | None = None,
) -> bool:
    """Remove inactive blocks only for approved / approval-preview export views."""
    settings = settings or {}
    if not condition_values:
        return False
    if not settings.get("approved") and not settings.get("approval_pending"):
        return False
    if _is_v5_model(rules):
        return _v5_preview_conditions_ready(rules, condition_values)
    return _rules_ready(rules, condition_values)


def _load_rules_for_document(path: Path, source_html: str) -> dict:
    document_model = load_document_model(path)
    if _is_v5_model(document_model):
        return document_model
    stored_rules = load_variant_rules(path)
    return load_or_detect_rules(source_html, stored_rules)


def _load_docx_context(path: Path) -> dict:
    saved_html = load_edit_html(path)
    if saved_html and needs_numbering_refresh(saved_html):
        saved_html = None

    source_html = load_source_html(path)
    if not source_html:
        source_html = render_docx_html(path)

    source_html = annotate_blocks(source_html)
    settings = load_document_settings(path)
    rules = _load_rules_for_document(path, source_html)

    return {
        "saved_html": saved_html,
        "source_html": source_html,
        "settings": settings,
        "rules": rules,
    }


def _document_settings(ctx: dict) -> dict:
    settings = dict(ctx["settings"])
    rules = ctx["rules"]
    settings["has_contract_variants"] = has_contract_variants(ctx["source_html"])
    if _is_v5_model(rules):
        settings["document_model"] = rules
        settings["variant_rules"] = rules
        settings["has_configured_rules"] = _v5_has_configured(rules)
        settings["active_condition_ids"] = _v5_active_field_ids(rules)
        return settings

    settings["has_configured_rules"] = has_configured_rules(rules)
    settings["active_condition_ids"] = get_active_condition_ids(rules)
    settings["variant_rules"] = rules
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
        if not _is_v5_model(ctx["rules"]):
            ctx["rules"] = normalize_rules(ctx["rules"])
            save_variant_rules(path, ctx["rules"])

        settings = dict(ctx["settings"])
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
        save_draft_source_html(path, ctx["source_html"])

        preview = make_editable(display_html)
        settings = _document_settings({**ctx, "settings": settings})
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
    rules = ctx["rules"]

    if _is_v5_model(rules):
        # Rules editor: full source for block assignment — no condition overlay.
        html = annotate_blocks(ctx["source_html"])
        return make_structure_editable(html), _document_settings(ctx)

    highlights = get_highlight_map(
        rules,
        condition_values=_condition_values_from_settings(ctx["settings"]),
    )
    marked_html = apply_highlights(ctx["source_html"], highlights)
    return make_structure_editable(marked_html), _document_settings(ctx)


def _apply_rules_setting(
    ctx: dict,
    *,
    condition_values: dict,
    rules: dict | None = None,
) -> tuple[str, dict]:
    if rules is not None:
        ctx = {**ctx, "rules": _coerce_rules(rules)}

    settings = {
        **ctx["settings"],
        "condition_values": condition_values,
        "approved": False,
        "approval_pending": False,
        "has_contract_variants": has_contract_variants(ctx["source_html"]),
        **_rules_meta(ctx["rules"]),
    }
    settings.pop("approved_at", None)
    if _is_v5_model(ctx["rules"]):
        settings["document_model"] = ctx["rules"]
        settings.pop("variant_rules", None)
    else:
        settings["variant_rules"] = ctx["rules"]

    filtered_html = _build_preview_display_html(
        ctx["source_html"],
        ctx["rules"],
        settings,
    )
    return filtered_html, settings


def apply_document_setting(
    path: Path,
    condition_id: str,
    value,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> tuple[str, dict]:
    ctx = _load_docx_context(path)
    ctx["rules"] = _resolve_ctx_rules(ctx, rules)

    if all_condition_values is not None:
        condition_values = {
            key: val
            for key, val in all_condition_values.items()
            if val is not None
        }
    else:
        condition_values = _explicit_condition_values(ctx["settings"])
        condition_values[condition_id] = value

    filtered_html, settings = _apply_rules_setting(
        ctx,
        condition_values=condition_values,
        rules=ctx["rules"],
    )
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
    ctx["rules"] = _resolve_ctx_rules(ctx, rules)

    if all_condition_values is not None:
        condition_values = {
            key: val
            for key, val in all_condition_values.items()
            if val is not None
        }
    else:
        condition_values = _explicit_condition_values(ctx["settings"])
        condition_values.pop(condition_id, None)

    display_html, settings = _apply_rules_setting(
        ctx,
        condition_values=condition_values,
        rules=ctx["rules"],
    )
    if condition_id == "bank_employee":
        settings.pop("is_bank_employee", None)

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
    ctx["rules"] = _resolve_ctx_rules(ctx, rules)

    if all_condition_values is not None:
        condition_values = {
            key: val
            for key, val in all_condition_values.items()
            if val is not None
        }
    else:
        condition_values = _explicit_condition_values(ctx["settings"])

    if not _rules_ready(ctx["rules"], condition_values):
        raise ValueError(
            "Заповніть усі умови та правила (група або маркер) перед затвердженням"
        )

    if _is_v5_model(ctx["rules"]):
        preview_html = apply_document_model(
            ctx["source_html"],
            ctx["rules"],
            condition_values=condition_values,
            finalize=True,
        )
    else:
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
        **_rules_meta(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    settings.pop("approved_at", None)
    if _is_v5_model(ctx["rules"]):
        settings["document_model"] = ctx["rules"]

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

    ctx["rules"] = _resolve_ctx_rules(ctx, rules)

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
        **_rules_meta(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    settings.pop("approved_at", None)
    if _is_v5_model(ctx["rules"]):
        settings["document_model"] = ctx["rules"]

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
    ctx["rules"] = _resolve_ctx_rules(ctx, rules)

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

    if not _rules_ready(ctx["rules"], condition_values):
        raise ValueError(
            "Заповніть усі умови та правила (група або маркер) перед затвердженням"
        )

    if _is_v5_model(ctx["rules"]):
        final_html = apply_document_model(
            ctx["source_html"],
            ctx["rules"],
            condition_values=condition_values,
            finalize=True,
        )
    else:
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
        **_rules_meta(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    if _is_v5_model(ctx["rules"]):
        settings["document_model"] = ctx["rules"]

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

    ctx["rules"] = _resolve_ctx_rules(ctx, rules)

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
        **_rules_meta(ctx["rules"]),
        "variant_rules": ctx["rules"],
    }
    settings.pop("approved_at", None)
    if _is_v5_model(ctx["rules"]):
        settings["document_model"] = ctx["rules"]

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

    if _is_v5_model(rules):
        ctx["rules"] = rules
        display_html = _build_preview_display_html(
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
        return make_structure_editable(ctx["source_html"]), _document_settings(ctx)

    rules = normalize_rules(rules)
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
    finalize = _should_finalize_preview(rules, condition_values, settings)

    if _is_v5_model(rules):
        return apply_document_model(
            source_html,
            rules,
            condition_values=condition_values,
            finalize=finalize,
        )

    if finalize:
        return apply_variant_rules(
            source_html,
            rules,
            condition_values=condition_values,
            finalize=True,
        )

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
