from docflow_docx.structure import (
    annotate_blocks,
    apply_preview_overlay,
    apply_variant_rules,
    get_active_condition_ids,
    has_configured_rules,
    merge_edited_into_source,
    normalize_rules,
)


def test_empty_rules():
    rules = normalize_rules(None)
    assert rules["schema_version"] == 3
    assert rules["entries"] == []
    assert not has_configured_rules(rules)


def test_rule_without_entries_not_active():
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [{"id": "c1", "label": "Test", "type": "boolean"}],
            "rules": [{"id": "r1", "condition_id": "c1"}],
            "entries": [],
        }
    )
    assert not has_configured_rules(rules)
    assert get_active_condition_ids(rules) == []


def test_group_apply():
    html = annotate_blocks(
        "<p>Section header</p>"
        "<p>Variant A body</p>"
        "<p>Variant B header</p>"
        "<p>Variant B body</p>"
    )
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [{"id": "c1", "label": "Choice", "type": "boolean"}],
            "rules": [{"id": "r1", "condition_id": "c1"}],
            "entries": [
                {
                    "id": "g1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Group",
                    "kind": "section",
                    "parent_id": None,
                    "when": {},
                    "content_block_ids": [],
                },
                {
                    "id": "v1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Var A",
                    "kind": "variant",
                    "parent_id": "g1",
                    "when": {"c1": True},
                    "content_block_ids": ["blk-1"],
                },
                {
                    "id": "v2",
                    "rule_id": "r1",
                    "header_block_id": "blk-2",
                    "label": "Var B",
                    "kind": "variant",
                    "parent_id": "g1",
                    "when": {"c1": False},
                    "content_block_ids": ["blk-3"],
                },
            ],
        }
    )
    assert has_configured_rules(rules)
    out_true = apply_variant_rules(html, rules, condition_values={"c1": True})
    out_false = apply_variant_rules(html, rules, condition_values={"c1": False})
    assert "Variant A body" in out_true
    assert "Variant B body" not in out_true
    assert "Variant B body" in out_false


def test_marker_fork_apply():
    html = annotate_blocks(
        "<p>Red condition</p>"
        "<p>Standard clause body</p>"
        "<p>Alt clause body</p>"
    )
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [{"id": "c1", "label": "Choice", "type": "boolean"}],
            "rules": [{"id": "r1", "condition_id": "c1"}],
            "entries": [
                {
                    "id": "m1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Marker",
                    "kind": "optional",
                    "parent_id": None,
                    "when": {},
                    "content_block_ids": [],
                },
                {
                    "id": "yes",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Так",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": True},
                    "content_block_ids": ["blk-2"],
                },
                {
                    "id": "no",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Ні",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": False},
                    "content_block_ids": ["blk-1"],
                },
            ],
        }
    )
    assert has_configured_rules(rules)
    out_true = apply_variant_rules(html, rules, condition_values={"c1": True})
    out_false = apply_variant_rules(html, rules, condition_values={"c1": False})
    assert "Alt clause body" in out_true
    assert "Standard clause body" not in out_true
    assert "Standard clause body" in out_false
    assert "Alt clause body" not in out_false


def test_overlapping_variant_content_keeps_active():
    html = annotate_blocks(
        "<p>Shared block</p>"
        "<p>Only false</p>"
    )
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [{"id": "c1", "label": "Choice", "type": "boolean"}],
            "rules": [{"id": "r1", "condition_id": "c1"}],
            "entries": [
                {
                    "id": "m1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Marker",
                    "kind": "optional",
                    "parent_id": None,
                    "when": {},
                    "content_block_ids": [],
                },
                {
                    "id": "yes",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Tak",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": True},
                    "content_block_ids": ["blk-0", "blk-1"],
                },
                {
                    "id": "no",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Ni",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": False},
                    "content_block_ids": ["blk-0"],
                },
            ],
        }
    )
    out_true = apply_variant_rules(html, rules, condition_values={"c1": True})
    out_false = apply_variant_rules(html, rules, condition_values={"c1": False})
    assert "Shared block" in out_true
    assert "Only false" in out_true
    assert "Shared block" in out_false
    assert "Only false" not in out_false


def test_no_apply_without_explicit_choice():
    html = annotate_blocks("<p>Keep me</p><p>Alt</p>")
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [{"id": "c1", "label": "Choice", "type": "boolean"}],
            "rules": [{"id": "r1", "condition_id": "c1"}],
            "entries": [
                {
                    "id": "m1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Marker",
                    "kind": "optional",
                    "parent_id": None,
                    "when": {},
                    "content_block_ids": [],
                },
                {
                    "id": "yes",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Tak",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": True},
                    "content_block_ids": ["blk-1"],
                },
                {
                    "id": "no",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Ni",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": False},
                    "content_block_ids": ["blk-0"],
                },
            ],
        }
    )
    out = apply_variant_rules(html, rules, condition_values={})
    assert "Keep me" in out
    assert "Alt" in out


def test_marker_choice_condition_apply():
    html = annotate_blocks(
        "<p>Instruction</p>"
        "<p>Yes body</p>"
        "<p>No body</p>"
    )
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [
                {
                    "id": "vehicle",
                    "label": "Vehicle rights",
                    "type": "choice",
                    "options": [
                        {"value": "tak", "label": "Так"},
                        {"value": "ni", "label": "Nі"},
                        {"value": "dash", "label": "—"},
                    ],
                }
            ],
            "rules": [{"id": "r1", "condition_id": "vehicle"}],
            "entries": [
                {
                    "id": "m1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Marker",
                    "kind": "optional",
                    "parent_id": None,
                    "when": {},
                    "content_block_ids": [],
                },
                {
                    "id": "yes",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Так",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"vehicle": "true"},
                    "content_block_ids": ["blk-1"],
                },
                {
                    "id": "no",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Nі",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"vehicle": "false"},
                    "content_block_ids": ["blk-2"],
                },
            ],
        }
    )
    out_yes = apply_variant_rules(html, rules, condition_values={"vehicle": "tak"})
    out_no = apply_variant_rules(html, rules, condition_values={"vehicle": "ni"})
    assert "Yes body" in out_yes
    assert "No body" not in out_yes
    assert "No body" in out_no
    assert "Yes body" not in out_no


def test_preview_keeps_red_text():
    html = annotate_blocks(
        '<p style="color:#ff0000">Instruction text</p>'
        "<p>Variant body</p>"
        "<p>Other body</p>"
    )
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [{"id": "c1", "label": "Choice", "type": "boolean"}],
            "rules": [{"id": "r1", "condition_id": "c1"}],
            "entries": [
                {
                    "id": "m1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Marker",
                    "kind": "optional",
                    "parent_id": None,
                    "when": {},
                    "content_block_ids": [],
                },
                {
                    "id": "yes",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Tak",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": True},
                    "content_block_ids": ["blk-1"],
                },
                {
                    "id": "no",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Ni",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": False},
                    "content_block_ids": ["blk-2"],
                },
            ],
        }
    )
    out = apply_variant_rules(html, rules, condition_values={"c1": True}, finalize=False)
    assert "Instruction text" in out
    assert "Variant body" in out
    assert "Other body" not in out


def test_finalize_strips_red_text():
    html = annotate_blocks(
        '<p style="color:#ff0000">Instruction text</p>'
        "<p>Variant body</p>"
        "<p>Other body</p>"
    )
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [{"id": "c1", "label": "Choice", "type": "boolean"}],
            "rules": [{"id": "r1", "condition_id": "c1"}],
            "entries": [
                {
                    "id": "m1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Marker",
                    "kind": "optional",
                    "parent_id": None,
                    "when": {},
                    "content_block_ids": [],
                },
                {
                    "id": "yes",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Tak",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": True},
                    "content_block_ids": ["blk-1"],
                },
                {
                    "id": "no",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Ni",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": False},
                    "content_block_ids": ["blk-2"],
                },
            ],
        }
    )
    out = apply_variant_rules(html, rules, condition_values={"c1": True}, finalize=True)
    assert "Instruction text" not in out


def test_preview_overlay_keeps_all_variants():
    html = annotate_blocks(
        "<p>Red instruction</p>"
        "<p>Yes body</p>"
        "<p>No body</p>"
    )
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [{"id": "c1", "label": "Choice", "type": "boolean"}],
            "rules": [{"id": "r1", "condition_id": "c1"}],
            "entries": [
                {
                    "id": "m1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Marker",
                    "kind": "optional",
                    "parent_id": None,
                    "when": {},
                    "content_block_ids": [],
                },
                {
                    "id": "yes",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Tak",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": True},
                    "content_block_ids": ["blk-1"],
                },
                {
                    "id": "no",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Ni",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"c1": False},
                    "content_block_ids": ["blk-2"],
                },
            ],
        }
    )
    out = apply_preview_overlay(html, rules, condition_values={"c1": True})
    assert "Yes body" in out
    assert "No body" in out
    assert "Red instruction" in out


def test_legacy_when_values_repaired():
    html = annotate_blocks("<p>Marker</p><p>Yes</p><p>No</p>")
    rules = normalize_rules(
        {
            "schema_version": 3,
            "conditions": [
                {
                    "id": "vehicle",
                    "label": "Vehicle",
                    "type": "choice",
                    "options": [
                        {"value": "tak", "label": "Так"},
                        {"value": "ni", "label": "Nі"},
                    ],
                }
            ],
            "rules": [{"id": "r1", "condition_id": "vehicle"}],
            "entries": [
                {
                    "id": "m1",
                    "rule_id": "r1",
                    "header_block_id": "blk-0",
                    "label": "Marker",
                    "kind": "optional",
                    "parent_id": None,
                    "when": {},
                    "content_block_ids": [],
                },
                {
                    "id": "yes",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Tak",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"vehicle": "true"},
                    "content_block_ids": ["blk-1"],
                },
                {
                    "id": "no",
                    "rule_id": "r1",
                    "header_block_id": "",
                    "label": "Ni",
                    "kind": "variant",
                    "parent_id": "m1",
                    "when": {"vehicle": "false"},
                    "content_block_ids": ["blk-2"],
                },
            ],
        }
    )
    out = apply_variant_rules(html, rules, condition_values={"vehicle": "tak"})
    assert "Yes" in out
    assert "No" not in out


def test_merge_edited_into_source_removes_deleted_blocks():
    from docflow_docx.structure import (
        collect_top_level_block_ids,
        merge_edited_into_source,
    )

    source = annotate_blocks(
        '<p data-block-id="a">Keep</p>'
        '<p data-block-id="b">Remove me</p>'
        '<p data-block-id="c">Also keep</p>'
    )
    edited = annotate_blocks(
        '<p data-block-id="a">Keep</p>'
        '<p data-block-id="c">Also keep</p>'
    )
    deletable = collect_top_level_block_ids(source)
    merged = merge_edited_into_source(source, edited, deletable_block_ids=deletable)
    assert "Keep" in merged
    assert "Also keep" in merged
    assert "Remove me" not in merged

    merged_fallback = merge_edited_into_source(source, edited)
    assert "Remove me" not in merged_fallback


def test_annotate_table_cell_paragraphs_separately():
    from bs4 import BeautifulSoup

    html = annotate_blocks(
        '<table class="docx-table"><tbody><tr>'
        '<td><p class="docx-p">Variant 1 text</p><p class="docx-p">Variant 2 text</p></td>'
        "</tr></tbody></table>"
    )
    soup = BeautifulSoup(f"<div>{html}</div>", "html.parser")
    blocks = soup.find_all(attrs={"data-block-id": True})
    assert len(blocks) == 2
    texts = [block.get_text(strip=True) for block in blocks]
    assert "Variant 1 text" in texts
    assert "Variant 2 text" in texts
    assert soup.find("table").get("data-block-id") is None


def test_merge_removes_deleted_table_without_empty_shell():
    from bs4 import BeautifulSoup
    from docflow_docx.sanitize import sanitize_edit_html

    source = annotate_blocks(
        '<table class="docx-table"><tbody><tr>'
        '<td><p class="docx-p">Cell A</p><p class="docx-p">Cell B</p></td>'
        "</tr></tbody></table>"
        "<p>After table</p>"
    )
    soup = BeautifulSoup(f"<div>{source}</div>", "html.parser")
    after_block = next(
        p for p in soup.find_all("p") if p.get_text(strip=True) == "After table"
    )
    after_id = after_block["data-block-id"]
    edited = f'<p data-block-id="{after_id}">After table</p>'

    merged = merge_edited_into_source(source, edited)
    assert "Cell A" not in merged
    assert "Cell B" not in merged
    assert "After table" in merged
    assert "<table" not in merged.lower()

    cleaned = sanitize_edit_html(
        '<table class="docx-table"><tbody><tr>'
        '<td><p class="docx-p">&nbsp;</p></td></tr>'
        '<tr><td><p class="docx-p"> </p></td></tr>'
        "</tbody></table>"
    )
    assert "<table" not in cleaned.lower()
