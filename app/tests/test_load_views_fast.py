from __future__ import annotations

from pathlib import Path

from docflow_docx.pages import save_edit_html, save_structure_edit_cache_only
from docflow_docx.structure import annotate_blocks
from services.document_service import (
    _try_fast_docx_preview_parts,
    build_edit_view,
    resolve_preview_content,
)
from services.document_service import _load_docx_context


def _empty_v5_model() -> dict:
    return {"schema_version": 5, "fields": [], "nodes": [], "meta": {}}


def test_fast_preview_skips_overlay_without_conditions(tmp_path: Path) -> None:
    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"PK\x05\x06")
    source = annotate_blocks("<p>Fast preview load</p>")
    save_edit_html(
        docx,
        source,
        source_html=source,
        settings={},
        variant_rules=_empty_v5_model(),
    )

    ctx = _load_docx_context(docx)
    fast = _try_fast_docx_preview_parts(ctx)
    assert fast is not None
    preview, _, meta = fast
    assert "Fast preview load" in preview
    assert meta.get("has_configured_rules") is False

    _, resolved_preview, resolved_meta = resolve_preview_content(docx, ".docx", "sample.docx")
    assert "Fast preview load" in resolved_preview
    assert resolved_meta.get("has_configured_rules") is False


def test_build_edit_view_uses_structure_cache(tmp_path: Path) -> None:
    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"PK\x05\x06")
    source = annotate_blocks("<p>Cached edit view</p>")
    save_edit_html(
        docx,
        source,
        source_html=source,
        settings={},
        variant_rules=_empty_v5_model(),
    )

    edit_html, _, from_cache_first = build_edit_view(docx)
    assert from_cache_first is False
    assert "docx-structure-mode" in edit_html

    save_structure_edit_cache_only(docx, edit_html, source)
    _, _, from_cache_second = build_edit_view(docx)
    assert from_cache_second is True
