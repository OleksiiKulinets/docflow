from pathlib import Path

from docflow_docx.pages import save_edit_html
from services.document_service import build_preview


def test_build_preview_preserves_condition_values_and_approval(tmp_path: Path) -> None:
    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"docx")

    source = '<p data-block-id="blk-0">Body</p>'
    save_edit_html(
        docx,
        source,
        source_html=source,
        settings={
            "condition_values": {"field-1": True},
            "approved": True,
            "approved_at": "2026-01-01T00:00:00+00:00",
        },
        variant_rules={"schema_version": 5, "fields": [], "nodes": [], "meta": {}},
    )

    _, preview_html, settings = build_preview(docx, ".docx", "sample.docx")

    assert settings.get("condition_values") == {"field-1": True}
    assert settings.get("approved") is True
    assert "approved_at" in settings
    assert "docx-structure-mode" not in preview_html
