"""v5 Node Editor workflow parity tests (post UI-4 Logic retirement)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from docflow_docx.engine.model import get_ordered_children
from docflow_docx.engine.policies import TraversalMode
from docflow_docx.engine.registry import get_registry
from docflow_docx.engine.validation import validate_model
from docflow_docx.structure import annotate_blocks, apply_document_model

APP_DIR = Path(__file__).resolve().parents[1]
PARITY_JS = APP_DIR / "resources" / "js" / "logic-nodes-parity.js"

LEGACY_NODE_TYPES = frozenset(
    {"variant", "choice", "group", "Variant", "Choice", "Group", "optional"}
)


def _yes_no_v5_model():
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
                "content": {"block_ids": ["blk-1"]},
                "properties": {},
                "metadata": {},
            },
        ],
        "meta": {},
    }


def _marker_fork_v5_model():
    return {
        "schema_version": 5,
        "fields": [{"id": "c1", "label": "Choice", "type": "boolean"}],
        "nodes": [
            {
                "id": "m1",
                "type": "marker",
                "parent_id": None,
                "children_order": ["yes", "no"],
                "condition": None,
                "content": {"block_ids": ["blk-0"]},
                "properties": {"behavior": {"marker_mode": "fork"}},
                "metadata": {"label": "Marker"},
            },
            {
                "id": "yes",
                "type": "section",
                "parent_id": "m1",
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
                "parent_id": "m1",
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
                "content": {"block_ids": ["blk-1"]},
                "properties": {},
                "metadata": {},
            },
            {
                "id": "p-no",
                "type": "paragraph",
                "parent_id": "no",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-2"]},
                "properties": {},
                "metadata": {},
            },
        ],
        "meta": {},
    }


def _deep_nesting_v5_model():
    return {
        "schema_version": 5,
        "fields": [{"id": "c1", "label": "C", "type": "boolean"}],
        "nodes": [
            {
                "id": "root",
                "type": "section",
                "parent_id": None,
                "children_order": ["mid"],
                "condition": None,
                "content": None,
                "properties": {"behavior": {"exclusive": True}},
                "metadata": {},
            },
            {
                "id": "mid",
                "type": "section",
                "parent_id": "root",
                "children_order": ["leaf-wrap"],
                "condition": {
                    "type": "predicate",
                    "condition_id": "c1",
                    "operator": "eq",
                    "value": True,
                },
                "content": None,
                "properties": {},
                "metadata": {},
            },
            {
                "id": "leaf-wrap",
                "type": "section",
                "parent_id": "mid",
                "children_order": ["leaf-a", "leaf-b"],
                "condition": None,
                "content": None,
                "properties": {"behavior": {"exclusive": True}},
                "metadata": {},
            },
            {
                "id": "leaf-a",
                "type": "section",
                "parent_id": "leaf-wrap",
                "children_order": ["p-a"],
                "condition": {
                    "type": "predicate",
                    "condition_id": "c1",
                    "operator": "eq",
                    "value": True,
                },
                "content": None,
                "properties": {},
                "metadata": {},
            },
            {
                "id": "leaf-b",
                "type": "section",
                "parent_id": "leaf-wrap",
                "children_order": ["p-b"],
                "condition": {
                    "type": "predicate",
                    "condition_id": "c1",
                    "operator": "eq",
                    "value": False,
                },
                "content": None,
                "properties": {},
                "metadata": {},
            },
            {
                "id": "p-a",
                "type": "paragraph",
                "parent_id": "leaf-a",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-0"]},
                "properties": {},
                "metadata": {},
            },
            {
                "id": "p-b",
                "type": "paragraph",
                "parent_id": "leaf-b",
                "children_order": [],
                "condition": None,
                "content": {"block_ids": ["blk-1"]},
                "properties": {},
                "metadata": {},
            },
        ],
        "meta": {},
    }


def _assert_no_legacy_types(model: dict) -> None:
    for node in model.get("nodes") or []:
        assert node.get("type") not in LEGACY_NODE_TYPES
        assert node.get("type") == node.get("type", "").lower()


@pytest.mark.skipif(shutil.which("node") is None, reason="node.js not installed")
def test_logic_nodes_parity_js():
    result = subprocess.run(
        ["node", str(PARITY_JS), "--parity-test"],
        cwd=APP_DIR,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_parity_yes_no_template_validates_and_resolves():
    model = _yes_no_v5_model()
    assert validate_model(model) == []
    _assert_no_legacy_types(model)

    fork = next(node for node in model["nodes"] if node["id"] == "fork")
    children = get_ordered_children(fork, model)
    registry = get_registry()
    assert registry.traversal_mode(fork, children) == TraversalMode.EXCLUSIVE
    assert registry.resolve_exclusive_children(fork, children, {"c1": True})[0]["id"] == "yes"
    assert registry.resolve_exclusive_children(fork, children, {"c1": False})[0]["id"] == "no"


def test_parity_yes_no_apply_export():
    html = annotate_blocks("<p>Yes body</p><p>No body</p>")
    model = _yes_no_v5_model()
    out_true = apply_document_model(html, model, condition_values={"c1": True}, finalize=True)
    out_false = apply_document_model(html, model, condition_values={"c1": False}, finalize=True)
    assert "Yes body" in out_true
    assert "No body" not in out_true
    assert "No body" in out_false
    assert "Yes body" not in out_false


def test_parity_marker_fork_apply():
    html = annotate_blocks("<p>Marker</p><p>Yes body</p><p>No body</p>")
    model = _marker_fork_v5_model()
    assert validate_model(model) == []
    out_true = apply_document_model(html, model, condition_values={"c1": True}, finalize=True)
    out_false = apply_document_model(html, model, condition_values={"c1": False}, finalize=True)
    assert "Yes body" in out_true
    assert "No body" not in out_true
    assert "No body" in out_false


def test_parity_deep_nesting_validates_and_resolves():
    model = _deep_nesting_v5_model()
    assert validate_model(model) == []
    _assert_no_legacy_types(model)

    leaf_wrap = next(node for node in model["nodes"] if node["id"] == "leaf-wrap")
    children = get_ordered_children(leaf_wrap, model)
    registry = get_registry()
    assert registry.traversal_mode(leaf_wrap, children) == TraversalMode.EXCLUSIVE
    assert registry.resolve_exclusive_children(leaf_wrap, children, {"c1": True})[0]["id"] == "leaf-a"
    assert registry.resolve_exclusive_children(leaf_wrap, children, {"c1": False})[0]["id"] == "leaf-b"


def test_parity_logic_roundtrip_save_load_no_data_loss(tmp_path: Path):
    from docflow_docx.pages import load_document_model, save_document_model

    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"docx")
    original = _yes_no_v5_model()
    assert validate_model(original) == []

    save_document_model(docx, original)
    loaded = load_document_model(docx)
    assert loaded is not None
    assert loaded["schema_version"] == 5
    assert "fields" in loaded
    assert "conditions" not in loaded
    assert validate_model(loaded) == []

    synced = json.loads(json.dumps(loaded))
    assert len(synced["nodes"]) == len(original["nodes"])
    assert {node["id"] for node in synced["nodes"]} == {node["id"] for node in original["nodes"]}
    _assert_no_legacy_types(synced)


def test_parity_complex_ast_validates():
    model = {
        "schema_version": 5,
        "fields": [
            {"id": "f_bool", "label": "Borrower", "type": "boolean"},
            {
                "id": "f_choice",
                "label": "Product",
                "type": "choice",
                "options": [
                    {"value": "a", "label": "A"},
                    {"value": "b", "label": "B"},
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
                            "type": "or",
                            "items": [
                                {
                                    "type": "predicate",
                                    "condition_id": "f_choice",
                                    "operator": "eq",
                                    "value": "a",
                                },
                                {
                                    "type": "predicate",
                                    "condition_id": "f_choice",
                                    "operator": "eq",
                                    "value": "b",
                                },
                            ],
                        },
                    ],
                },
                "content": None,
                "properties": {},
                "metadata": {},
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
    assert validate_model(model) == []
    broken = json.loads(json.dumps(model))
    broken["nodes"][0]["condition"]["items"][0]["condition_id"] = "missing"
    assert validate_model(broken)


def test_parity_v5_sidecar_shape(tmp_path: Path):
    import json as json_mod

    from docflow_docx.pages import save_document_model

    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"docx")
    save_document_model(docx, _yes_no_v5_model())
    sidecar = json_mod.loads((tmp_path / "sample.docx.edit.json").read_text(encoding="utf-8"))
    assert "document_model" in sidecar
    assert sidecar["document_model"]["schema_version"] == 5
    assert "variant_rules" not in sidecar
