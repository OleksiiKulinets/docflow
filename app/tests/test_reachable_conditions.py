from docflow_docx.structure import _v5_collect_reachable_field_ids


def _nested_variant_model():
    return {
        "schema_version": 5,
        "fields": [
            {"id": "main_choice", "label": "Main", "type": "choice", "options": [
                {"value": "v1", "label": "V1"},
                {"value": "v2", "label": "V2"},
                {"value": "v3", "label": "V3"},
            ]},
            {"id": "sub_choice", "label": "Sub", "type": "choice", "options": [
                {"value": "a", "label": "A"},
                {"value": "b", "label": "B"},
                {"value": "c", "label": "C"},
            ]},
        ],
        "nodes": [
            {
                "id": "root",
                "type": "section",
                "parent_id": None,
                "children_order": ["fork"],
                "properties": {"behavior": {"exclusive": True}},
            },
            {
                "id": "fork",
                "type": "section",
                "parent_id": "root",
                "children_order": ["b1", "b2", "b3"],
                "properties": {"behavior": {"exclusive": True}},
            },
            {
                "id": "b1",
                "type": "section",
                "parent_id": "fork",
                "children_order": ["p1"],
                "condition": {
                    "type": "predicate",
                    "condition_id": "main_choice",
                    "operator": "eq",
                    "value": "v1",
                },
            },
            {"id": "p1", "type": "paragraph", "parent_id": "b1", "children_order": []},
            {
                "id": "b2",
                "type": "section",
                "parent_id": "fork",
                "children_order": ["p2"],
                "condition": {
                    "type": "predicate",
                    "condition_id": "main_choice",
                    "operator": "eq",
                    "value": "v2",
                },
            },
            {"id": "p2", "type": "paragraph", "parent_id": "b2", "children_order": []},
            {
                "id": "b3",
                "type": "section",
                "parent_id": "fork",
                "children_order": ["subfork"],
                "condition": {
                    "type": "predicate",
                    "condition_id": "main_choice",
                    "operator": "eq",
                    "value": "v3",
                },
            },
            {
                "id": "subfork",
                "type": "section",
                "parent_id": "b3",
                "children_order": ["sb1", "sb2", "sb3"],
                "properties": {"behavior": {"exclusive": True}},
            },
            {
                "id": "sb1",
                "type": "section",
                "parent_id": "subfork",
                "children_order": [],
                "condition": {
                    "type": "predicate",
                    "condition_id": "sub_choice",
                    "operator": "eq",
                    "value": "a",
                },
            },
            {
                "id": "sb2",
                "type": "section",
                "parent_id": "subfork",
                "children_order": [],
                "condition": {
                    "type": "predicate",
                    "condition_id": "sub_choice",
                    "operator": "eq",
                    "value": "b",
                },
            },
            {
                "id": "sb3",
                "type": "section",
                "parent_id": "subfork",
                "children_order": [],
                "condition": {
                    "type": "predicate",
                    "condition_id": "sub_choice",
                    "operator": "eq",
                    "value": "c",
                },
            },
        ],
        "meta": {},
    }


def test_reachable_fields_show_parent_first():
    model = _nested_variant_model()
    assert _v5_collect_reachable_field_ids(model, {}) == ["main_choice"]


def test_reachable_fields_hide_nested_until_parent_branch_active():
    model = _nested_variant_model()
    assert _v5_collect_reachable_field_ids(model, {"main_choice": "v1"}) == ["main_choice"]
    assert _v5_collect_reachable_field_ids(model, {"main_choice": "v2"}) == ["main_choice"]


def test_reachable_fields_show_nested_only_for_matching_branch():
    model = _nested_variant_model()
    assert _v5_collect_reachable_field_ids(model, {"main_choice": "v3"}) == [
        "main_choice",
        "sub_choice",
    ]
    assert _v5_collect_reachable_field_ids(model, {"main_choice": "v3", "sub_choice": "a"}) == [
        "main_choice",
        "sub_choice",
    ]
