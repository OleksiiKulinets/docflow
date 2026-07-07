import base64
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from storage.docx_pages import prepare_edit_html, save_edit_html
from storage.docx_writer import write_docx_from_html
from storage.preview import build_preview, html_to_text

BASE_DIR = Path(__file__).resolve().parent.parent
FILES_DIR = BASE_DIR / "data" / "files"
MANIFEST_PATH = BASE_DIR / "data" / "manifest.json"
ALLOWED_EXTENSIONS = {".txt", ".docx", ".pdf"}


def _ensure_storage() -> None:
    FILES_DIR.mkdir(parents=True, exist_ok=True)
    if not MANIFEST_PATH.exists():
        MANIFEST_PATH.write_text('{"files": []}', encoding="utf-8")


def _load_manifest() -> dict:
    _ensure_storage()
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _save_manifest(data: dict) -> None:
    MANIFEST_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _find_entry(manifest: dict, file_id: str) -> dict | None:
    return next((f for f in manifest["files"] if f["id"] == file_id), None)


def upload_file(filename: str, content_b64: str) -> dict:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}")

    _ensure_storage()
    content = base64.b64decode(content_b64)
    file_id = str(uuid.uuid4())
    stored_name = f"{file_id}{ext}"
    (FILES_DIR / stored_name).write_bytes(content)

    entry = {
        "id": file_id,
        "name": filename,
        "stored_name": stored_name,
        "size": len(content),
        "extension": ext,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }

    manifest = _load_manifest()
    manifest["files"].insert(0, entry)
    _save_manifest(manifest)
    return entry


def list_files(query: str = "") -> list[dict]:
    files = _load_manifest()["files"]
    q = query.strip().lower()
    if not q:
        return files
    return [f for f in files if q in f["name"].lower()]


def get_file_content(file_id: str) -> dict:
    manifest = _load_manifest()
    entry = _find_entry(manifest, file_id)
    if entry is None:
        raise FileNotFoundError("File not found")

    path = FILES_DIR / entry["stored_name"]
    if not path.exists():
        raise FileNotFoundError("File not found on disk")

    content, preview_html = build_preview(path, entry["extension"], entry["name"])

    return {
        "meta": entry,
        "content": content,
        "preview_html": preview_html,
        "editable": entry["extension"] in {".txt", ".docx"},
    }


def save_file(
    file_id: str,
    content: str | None = None,
    html: str | None = None,
) -> dict:
    manifest = _load_manifest()
    entry = _find_entry(manifest, file_id)
    if entry is None:
        raise FileNotFoundError("File not found")

    path = FILES_DIR / entry["stored_name"]
    extension = entry["extension"]

    if extension == ".txt":
        text = content if content is not None else html_to_text(html or "")
        encoded = text.encode("utf-8")
        path.write_bytes(encoded)
        if html:
            save_edit_html(path, html)
        entry["size"] = len(encoded)

    elif extension == ".docx":
        if not html:
            raise ValueError("HTML content is required to save DOCX")
        clean_html = prepare_edit_html(html)
        write_docx_from_html(path, clean_html)
        save_edit_html(path, clean_html)
        entry["size"] = path.stat().st_size

    else:
        raise ValueError(f"Cannot save {extension} files")

    entry["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_manifest(manifest)
    return entry


def delete_file(file_id: str) -> dict:
    manifest = _load_manifest()
    entry = _find_entry(manifest, file_id)
    if entry is None:
        raise FileNotFoundError("File not found")

    path = FILES_DIR / entry["stored_name"]
    edit_path = path.parent / f"{path.name}.edit.json"

    if path.exists():
        path.unlink()
    if edit_path.exists():
        edit_path.unlink()

    manifest["files"] = [f for f in manifest["files"] if f["id"] != file_id]
    _save_manifest(manifest)
    return entry


def get_file_bytes(file_id: str) -> tuple[dict, bytes]:
    manifest = _load_manifest()
    entry = _find_entry(manifest, file_id)
    if entry is None:
        raise FileNotFoundError("File not found")

    path = FILES_DIR / entry["stored_name"]
    if not path.exists():
        raise FileNotFoundError("File not found on disk")

    return entry, path.read_bytes()
