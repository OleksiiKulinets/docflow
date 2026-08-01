from __future__ import annotations

from pathlib import Path

from docflow_docx.pages import save_edit_html, structure_edit_cache_key
from docflow_docx.structure import annotate_blocks
from services.document_service import save_rules_and_refresh


def _empty_v5_model() -> dict:
    return {"schema_version": 5, "fields": [], "nodes": [], "meta": {}}


def test_save_empty_rules_uses_fast_path(tmp_path: Path) -> None:
    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"PK\x05\x06")
    source = annotate_blocks("<p>Hello rules fast path</p>")
    save_edit_html(
        docx,
        source,
        source_html=source,
        settings={"condition_values": {}},
        variant_rules=_empty_v5_model(),
    )

    _, preview_html, meta, unchanged_first = save_rules_and_refresh(docx, _empty_v5_model())
    _, _, _, unchanged_second = save_rules_and_refresh(docx, _empty_v5_model())

    assert unchanged_first is False
    assert unchanged_second is True
    assert "Hello rules fast path" in preview_html
    assert meta.get("has_configured_rules") is False


def test_save_empty_rules_caches_structure_edit_html(tmp_path: Path) -> None:
    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"PK\x05\x06")
    source = annotate_blocks("<p>Cached structure html</p>")
    save_edit_html(
        docx,
        source,
        source_html=source,
        settings={},
        variant_rules=_empty_v5_model(),
    )

    save_rules_and_refresh(docx, _empty_v5_model())
    _, _, _, unchanged_second = save_rules_and_refresh(docx, _empty_v5_model())

    assert unchanged_second is True
    assert structure_edit_cache_key(source)
