import json
import threading
from pathlib import Path

from docflow_docx.pages import edit_json_path, load_edit_data, save_document_model


def test_concurrent_edit_json_writes(tmp_path: Path) -> None:
    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"docx")

    model = {
        "schema_version": 5,
        "fields": [{"id": "field-1", "label": "Test", "type": "boolean"}],
        "nodes": [],
        "meta": {},
    }
    errors: list[Exception] = []

    def writer(suffix: str) -> None:
        try:
            payload = dict(model)
            payload["meta"] = {"writer": suffix}
            save_document_model(docx, payload)
        except Exception as exc:  # pragma: no cover - surfaced via errors list
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(str(index),)) for index in range(12)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors

    sidecar = edit_json_path(docx)
    assert sidecar.exists()
    data = json.loads(sidecar.read_text(encoding="utf-8"))
    assert data.get("document_model", {}).get("schema_version") == 5


def test_load_edit_data_normalizes_v5_payload(tmp_path: Path) -> None:
    docx = tmp_path / "sample.docx"
    docx.write_bytes(b"docx")
    sidecar = edit_json_path(docx)
    sidecar.write_text(
        json.dumps(
            {
                "document_model": {
                    "schema_version": 5,
                    "fields": [],
                    "nodes": [],
                },
                "variant_rules": {"legacy": True},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    data = load_edit_data(docx)
    assert "variant_rules" not in data
    assert data["document_model"]["schema_version"] == 5
