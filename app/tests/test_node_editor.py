"""Tests for v5 node editor frontend model layer."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from docflow_docx.engine.validation import validate_model
from docflow_docx.migration.v4_schema import TYPE_VARIANT, normalize_v4_model
from docflow_docx.migration.v4_to_v5 import migrate_v4_to_v5

APP_DIR = Path(__file__).resolve().parents[1]
NODE_MODEL_JS = APP_DIR / "resources" / "js" / "node-model.js"
TEMPLATES_JS = APP_DIR / "resources" / "js" / "templates.js"

LEGACY_NODE_TYPES = frozenset(
    {"variant", "choice", "group", "Variant", "Choice", "Group", "optional"}
)


def _sample_v5():
    v4 = normalize_v4_model(
        {
            "schema_version": 4,
            "conditions": [{"id": "c1", "label": "Borrower", "type": "boolean"}],
            "nodes": [
                {
                    "id": "v1",
                    "type": TYPE_VARIANT,
                    "parent_id": None,
                    "children_order": [],
                    "condition": {
                        "type": "predicate",
                        "condition_id": "c1",
                        "operator": "eq",
                        "value": True,
                    },
                    "content": {"block_ids": ["blk-0"]},
                    "metadata": {"label": "Yes branch"},
                },
            ],
        }
    )
    return migrate_v4_to_v5(v4)


def _model_with_fields_and_condition_ast():
    return {
        "schema_version": 5,
        "fields": [
            {"id": "f_bool", "label": "Borrower", "type": "boolean"},
            {
                "id": "f_choice",
                "label": "Product",
                "type": "choice",
                "options": [
                    {"value": "a", "label": "Option A"},
                    {"value": "b", "label": "Option B"},
                ],
            },
        ],
        "nodes": [
            {
                "id": "sec1",
                "type": "section",
                "parent_id": None,
                "children_order": ["p1"],
                "condition": {
                    "type": "and",
                    "items": [
                        {
                            "type": "predicate",
                            "condition_id": "f_bool",
                            "operator": "eq",
                            "value": True,
                        },
                        {
                            "type": "predicate",
                            "condition_id": "f_choice",
                            "operator": "eq",
                            "value": "a",
                        },
                    ],
                },
                "content": None,
                "properties": {"behavior": {"exclusive": True}},
                "metadata": {"label": "Terms"},
            },
            {
                "id": "p1",
                "type": "paragraph",
                "parent_id": "sec1",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-1"]},
                "properties": {},
                "metadata": {},
            },
        ],
        "meta": {},
    }


@pytest.mark.skipif(shutil.which("node") is None, reason="node.js not installed")
def test_templates_selftest():
    result = subprocess.run(
        ["node", str(TEMPLATES_JS), "--self-test"],
        cwd=APP_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def _yes_no_template_model():
    """v5 shape produced by createYesNoTemplate()."""
    return {
        "schema_version": 5,
        "fields": [{"id": "f_bool", "label": "Поле", "type": "boolean"}],
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
                    "condition_id": "f_bool",
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
                    "condition_id": "f_bool",
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
                "content": {"block_ids": ["blk-yes"]},
                "properties": {},
                "metadata": {},
            },
            {
                "id": "p-no",
                "type": "paragraph",
                "parent_id": "no",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-no"]},
                "properties": {},
                "metadata": {},
            },
        ],
        "meta": {},
    }


def test_yes_no_template_creates_valid_v5_model():
    model = _yes_no_template_model()
    assert validate_model(model) == []
    fork = next(node for node in model["nodes"] if node["id"] == "fork")
    assert fork["properties"]["behavior"]["exclusive"] is True
    for node in model["nodes"]:
        assert node["type"] not in LEGACY_NODE_TYPES
        assert node["type"] == node["type"].lower()


def test_yes_no_template_exclusive_resolve():
    from docflow_docx.engine.model import get_ordered_children
    from docflow_docx.engine.policies import TraversalMode
    from docflow_docx.engine.registry import get_registry

    model = _yes_no_template_model()
    fork = next(node for node in model["nodes"] if node["id"] == "fork")
    children = get_ordered_children(fork, model)
    registry = get_registry()

    assert registry.traversal_mode(fork, children) == TraversalMode.EXCLUSIVE
    matched_true = registry.resolve_exclusive_children(fork, children, {"f_bool": True})
    matched_false = registry.resolve_exclusive_children(fork, children, {"f_bool": False})
    assert [node["id"] for node in matched_true] == ["yes"]
    assert [node["id"] for node in matched_false] == ["no"]


def test_yes_no_template_save_load_roundtrip(tmp_path: Path):
    from docflow_docx.pages import load_document_model, save_document_model

    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"docx")
    model = _yes_no_template_model()
    assert validate_model(model) == []

    save_document_model(docx, model)
    loaded = load_document_model(docx)
    assert loaded is not None
    assert loaded["schema_version"] == 5
    fork = next(node for node in loaded["nodes"] if node["id"] == "fork")
    assert fork["properties"]["behavior"]["exclusive"] is True
    assert validate_model(loaded) == []
    for node in loaded["nodes"]:
        assert node["type"] not in LEGACY_NODE_TYPES


def test_exclusive_choice_template_shape_validates():
    model = {
        "schema_version": 5,
        "fields": [
            {
                "id": "f_pay",
                "label": "Payment",
                "type": "choice",
                "options": [
                    {"value": "cash", "label": "Cash"},
                    {"value": "credit", "label": "Credit"},
                ],
            }
        ],
        "nodes": [
            {
                "id": "fork",
                "type": "section",
                "parent_id": None,
                "children_order": ["cash", "credit"],
                "condition": None,
                "content": None,
                "properties": {"behavior": {"exclusive": True}},
                "metadata": {"label": "Варіанти"},
            },
            {
                "id": "cash",
                "type": "section",
                "parent_id": "fork",
                "children_order": [],
                "condition": {
                    "type": "predicate",
                    "condition_id": "f_pay",
                    "operator": "eq",
                    "value": "cash",
                },
                "content": None,
                "properties": {},
                "metadata": {"label": "Cash"},
            },
            {
                "id": "credit",
                "type": "section",
                "parent_id": "fork",
                "children_order": [],
                "condition": {
                    "type": "predicate",
                    "condition_id": "f_pay",
                    "operator": "eq",
                    "value": "credit",
                },
                "content": None,
                "properties": {},
                "metadata": {"label": "Credit"},
            },
        ],
        "meta": {},
    }
    assert validate_model(model) == []
    for node in model["nodes"]:
        assert node["type"] not in LEGACY_NODE_TYPES


@pytest.mark.skipif(shutil.which("node") is None, reason="node.js not installed")
def test_node_model_selftest():
    result = subprocess.run(
        ["node", str(NODE_MODEL_JS), "--self-test"],
        cwd=APP_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_sample_v5_model_is_valid_for_node_editor():
    model = _sample_v5()
    assert model["schema_version"] == 5
    assert model["fields"]
    assert model["nodes"]
    errors = validate_model(model)
    assert errors == []


def test_v5_node_shape_matches_editor_contract():
    """Node editor expects lowercase types and explicit children_order."""
    node = _sample_v5()["nodes"][0]
    assert node["type"] == node["type"].lower()
    assert "children_order" in node
    assert "properties" in node
    assert "metadata" in node


def test_v5_model_roundtrip_json():
    model = _sample_v5()
    restored = json.loads(json.dumps(model))
    assert validate_model(restored) == []


def test_fields_catalog_and_condition_ast_validate():
    model = _model_with_fields_and_condition_ast()
    assert validate_model(model) == []


def test_unknown_field_in_condition_ast_rejected():
    model = _model_with_fields_and_condition_ast()
    model["nodes"][0]["condition"]["items"][0]["condition_id"] = "missing"
    errors = validate_model(model)
    assert any("unknown field" in error for error in errors)


def test_duplicate_field_id_rejected():
    model = _model_with_fields_and_condition_ast()
    model["fields"].append(dict(model["fields"][0]))
    errors = validate_model(model)
    assert any("Duplicate field" in error for error in errors)


def test_block_ids_content_roundtrip():
    model = _model_with_fields_and_condition_ast()
    paragraph = model["nodes"][1]
    paragraph["content"] = {"block_ids": ["blk-1", "blk-2", "blk-3"]}
    assert validate_model(model) == []

    restored = json.loads(json.dumps(model))
    saved_blocks = restored["nodes"][1]["content"]["block_ids"]
    assert saved_blocks == ["blk-1", "blk-2", "blk-3"]


def test_find_node_by_block_id_contract():
    model = _model_with_fields_and_condition_ast()
    model["nodes"][1]["content"] = {"block_ids": ["blk-target"]}
    owner = next(
        node
        for node in model["nodes"]
        if "blk-target" in (node.get("content") or {}).get("block_ids", [])
    )
    assert owner["id"] == "p1"


def test_marker_table_paragraph_support_block_content():
    for node_type in ("paragraph", "table", "marker"):
        model = {
            "schema_version": 5,
            "fields": [{"id": "f1", "label": "F", "type": "boolean"}],
            "nodes": [
                {
                    "id": "n1",
                    "type": node_type,
                    "parent_id": None,
                    "children_order": [],
                    "condition": None,
                    "content": {"block_ids": ["blk-0"]},
                    "properties": {},
                    "metadata": {},
                }
            ],
            "meta": {},
        }
        assert validate_model(model) == []


def test_tree_operations_save_load_roundtrip(tmp_path: Path):
    """Sidecar roundtrip after a v5 tree shaped like post-duplicate/reorder state."""
    import json

    from docflow_docx.pages import load_document_model, save_document_model

    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"docx")
    model = _model_with_fields_and_condition_ast()
    dup_id = "sec1-copy"
    model["nodes"].append(
        {
            "id": dup_id,
            "type": "section",
            "parent_id": None,
            "children_order": ["p1-copy"],
            "condition": model["nodes"][0]["condition"],
            "content": None,
            "properties": {"behavior": {"exclusive": True}},
            "metadata": {"label": "Terms copy"},
        }
    )
    model["nodes"].append(
        {
            "id": "p1-copy",
            "type": "paragraph",
            "parent_id": dup_id,
            "children_order": [],
            "condition": None,
            "content": {"block_ids": ["blk-2"]},
            "properties": {},
            "metadata": {},
        }
    )
    assert validate_model(model) == []

    save_document_model(docx, model)
    loaded = load_document_model(docx)
    assert loaded is not None
    assert loaded["schema_version"] == 5
    assert any(node["id"] == dup_id for node in loaded["nodes"])
    assert validate_model(loaded) == []

    sidecar = tmp_path / "sample.docx.edit.json"
    saved = json.loads(sidecar.read_text(encoding="utf-8"))
    assert "document_model" in saved
    assert "variant_rules" not in saved


def test_leaf_node_cannot_have_children_in_tree_validation():
    model = _model_with_fields_and_condition_ast()
    model["nodes"][1]["children_order"] = ["ghost"]
    model["nodes"].append(
        {
            "id": "ghost",
            "type": "paragraph",
            "parent_id": "p1",
            "children_order": [],
            "condition": None,
            "content": {"block_ids": ["blk-x"]},
            "properties": {},
            "metadata": {},
        }
    )
    errors = validate_model(model)
    assert any("cannot have children" in error.lower() for error in errors)


def test_reparent_cycle_rejected_by_validation():
    model = _model_with_fields_and_condition_ast()
    model["nodes"][0]["parent_id"] = "p1"
    errors = validate_model(model)
    assert any("cycle" in error.lower() for error in errors)


def test_children_order_reorder_roundtrip():
    model = _model_with_fields_and_condition_ast()
    model["nodes"][0]["children_order"] = ["p1"]
    restored = json.loads(json.dumps(model))
    assert restored["nodes"][0]["children_order"] == ["p1"]
    assert validate_model(restored) == []


def test_tree_drop_reorder_save_load_roundtrip(tmp_path: Path):
    """Sidecar roundtrip after model state shaped like post-DnD reorder/reparent."""
    from docflow_docx.pages import load_document_model, save_document_model

    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"docx")
    model = {
        "schema_version": 5,
        "fields": [],
        "nodes": [
            {
                "id": "sec-a",
                "type": "section",
                "parent_id": None,
                "children_order": ["p-b", "p-a", "p-c"],
                "condition": None,
                "content": None,
                "properties": {},
                "metadata": {"label": "Section A"},
            },
            {
                "id": "sec-b",
                "type": "section",
                "parent_id": None,
                "children_order": [],
                "condition": None,
                "content": None,
                "properties": {},
                "metadata": {"label": "Section B"},
            },
            {
                "id": "p-a",
                "type": "paragraph",
                "parent_id": "sec-a",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-a"]},
                "properties": {},
                "metadata": {},
            },
            {
                "id": "p-b",
                "type": "paragraph",
                "parent_id": "sec-a",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-b"]},
                "properties": {},
                "metadata": {},
            },
            {
                "id": "p-c",
                "type": "paragraph",
                "parent_id": "sec-a",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-c"]},
                "properties": {},
                "metadata": {},
            },
        ],
        "meta": {},
    }
    assert validate_model(model) == []

    save_document_model(docx, model)
    loaded = load_document_model(docx)
    assert loaded is not None
    sec_a = next(node for node in loaded["nodes"] if node["id"] == "sec-a")
    assert sec_a["children_order"] == ["p-b", "p-a", "p-c"]
    assert validate_model(loaded) == []


def test_logic_node_roundtrip_preserves_v5_shape():
    """Simulate tab sync: canonical v5 JSON must survive serialize/deserialize."""
    original = _model_with_fields_and_condition_ast()
    synced = json.loads(json.dumps(original))
    assert synced["fields"][0]["type"] == "boolean"
    assert synced["fields"][1]["options"][0]["value"] == "a"
    assert synced["nodes"][0]["condition"]["type"] == "and"
    assert validate_model(synced) == []


def test_load_edit_data_recovers_trailing_document_model_fragment(tmp_path: Path):
    from docflow_docx.pages import edit_json_path, load_document_model, load_edit_data

    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"docx")
    sidecar = edit_json_path(docx)
    sidecar.write_text(
        (
            '{'
            '"html":"<p>Body</p>",'
            '"source_html":"<p>Body</p>",'
            '"settings":{"condition_values":{}},'
            '"document_model":{"schema_version":5,"fields":[],"nodes":[],"meta":{}}'
            '}'
            '"label":"Borrower","type":"boolean"}'
            '],'
            '"nodes":[{"id":"sec","type":"section","parent_id":null,'
            '"children_order":[],"condition":null,"content":null,'
            '"properties":{},"metadata":{}}],'
            '"meta":{}}'
            '}'
        ),
        encoding="utf-8",
    )

    load_edit_data(docx)
    model = load_document_model(docx)
    assert model is not None
    assert model["schema_version"] == 5
    assert len(model["fields"]) == 1
    assert len(model["nodes"]) == 1
    json.loads(sidecar.read_text(encoding="utf-8"))
