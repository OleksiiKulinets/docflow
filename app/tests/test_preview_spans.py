"""Preview overlay for text-span (partial) content assignments."""

from __future__ import annotations

from docflow_docx.structure import annotate_blocks
from services.document_service import _build_preview_display_html


def _yes_no_span_model():
    """Yes = whole block; No = text span inside a shared paragraph."""
    return {
        "schema_version": 5,
        "fields": [{"id": "c1", "label": "Choice", "type": "boolean"}],
        "nodes": [
            {
                "id": "fork",
                "type": "section",
                "parent_id": None,
                "children_order": ["yes", "no"],
                "condition": None,
                "content": None,
                "properties": {"behavior": {"exclusive": True}},
                "metadata": {"label": "Так / Ні"},
            },
            {
                "id": "yes",
                "type": "section",
                "parent_id": "fork",
                "children_order": ["p-yes"],
                "condition": {
                    "type": "predicate",
                    "condition_id": "c1",
                    "operator": "eq",
                    "value": True,
                },
                "content": None,
                "properties": {},
                "metadata": {"label": "Так"},
            },
            {
                "id": "no",
                "type": "section",
                "parent_id": "fork",
                "children_order": ["p-no"],
                "condition": {
                    "type": "predicate",
                    "condition_id": "c1",
                    "operator": "eq",
                    "value": False,
                },
                "content": None,
                "properties": {},
                "metadata": {"label": "Ні"},
            },
            {
                "id": "p-yes",
                "type": "paragraph",
                "parent_id": "yes",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-0"]},
                "properties": {},
                "metadata": {},
            },
            {
                "id": "p-no",
                "type": "paragraph",
                "parent_id": "no",
                "children_order": [],
                "condition": None,
                "content": {
                    "spans": [
                        {
                            "id": "span-no",
                            "block_id": "blk-1",
                            "start": 3,
                            "end": 7,
                            "text": "body",
                        }
                    ]
                },
                "properties": {},
                "metadata": {},
            },
        ],
        "meta": {},
    }


def test_preview_span_mode_shows_fragment_not_whole_block():
    model = _yes_no_span_model()
    html = annotate_blocks(
        '<p id="blk-0">Yes body</p><p id="blk-1">No body text</p>',
    )
    settings = {"condition_values": {"c1": True}}

    out = _build_preview_display_html(html, model, settings)

    assert "docx-block--content-active" in out
    assert "docx-block--content-inactive" not in out or "blk-0" in out
    assert "docx-block--span-mode" in out
    assert "docx-span--content-inactive" in out
    assert "docx-span--content-active" not in out
    assert "body" in out
    assert "No " in out or "No" in out


def test_preview_span_mode_active_fragment_when_branch_selected():
    model = _yes_no_span_model()
    html = annotate_blocks(
        '<p id="blk-0">Yes body</p><p id="blk-1">No body text</p>',
    )
    settings = {"condition_values": {"c1": False}}

    out = _build_preview_display_html(html, model, settings)

    assert "docx-span--content-active" in out
    assert "docx-block--content-inactive" in out
    assert "docx-block--content-active" not in out


def test_finalize_keeps_block_and_trims_inactive_span_text():
    model = _yes_no_span_model()
    html = annotate_blocks(
        '<p id="blk-0">Yes body</p><p id="blk-1">No body text</p>',
    )
    settings = {"condition_values": {"c1": True}, "approved": True}

    out = _build_preview_display_html(html, model, settings)

    assert "Yes body" in out
    assert "No body text" not in out
    assert "No  text" in out or "No text" in out
    assert 'id="blk-1"' in out
    assert "docx-block--content-inactive" not in out


def test_finalize_keeps_only_active_span_excerpt():
    model = _yes_no_span_model()
    html = annotate_blocks(
        '<p id="blk-0">Yes body</p><p id="blk-1">No body text</p>',
    )
    settings = {"condition_values": {"c1": False}, "approved": True}

    out = _build_preview_display_html(html, model, settings)

    assert "body" in out
    assert "Yes body" not in out
    assert "No body text" not in out
    assert "No " not in out
