"""Preview overlay vs finalize (approved export only)."""

from __future__ import annotations

from docflow_docx.structure import annotate_blocks
from services.document_service import (
    _build_preview_display_html,
    _should_finalize_preview,
    _v5_rules_ready_to_apply,
)


def _yes_no_v5_model(*, with_no_blocks: bool = True):
    nodes = [
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
            "children_order": ["p-no"] if with_no_blocks else [],
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
    ]
    if with_no_blocks:
        nodes.append(
            {
                "id": "p-no",
                "type": "paragraph",
                "parent_id": "no",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-1"]},
                "properties": {},
                "metadata": {},
            }
        )
    return {
        "schema_version": 5,
        "fields": [{"id": "c1", "label": "Choice", "type": "boolean"}],
        "nodes": nodes,
        "meta": {},
    }


def test_should_finalize_preview_only_when_approved():
    model = _yes_no_v5_model(with_no_blocks=False)
    values = {"c1": True}

    assert _v5_rules_ready_to_apply(model, values) is False
    assert _should_finalize_preview(model, values, {}) is False
    assert _should_finalize_preview(model, values, {"approved": True}) is True


def test_build_preview_overlay_highlights_active_and_grays_inactive():
    model = _yes_no_v5_model()
    html = annotate_blocks(
        '<p id="blk-0">Yes body</p><p id="blk-1">No body</p>',
    )
    settings = {"condition_values": {"c1": True}}

    out = _build_preview_display_html(html, model, settings)

    assert "Yes body" in out
    assert "No body" in out
    assert "docx-block--content-active" in out
    assert "docx-block--content-inactive" in out


def test_build_preview_finalizes_when_approved():
    model = _yes_no_v5_model()
    html = annotate_blocks(
        '<p id="blk-0">Yes body</p><p id="blk-1">No body</p>',
    )
    settings = {"condition_values": {"c1": True}, "approved": True}

    out = _build_preview_display_html(html, model, settings)

    assert "Yes body" in out
    assert "No body" not in out
