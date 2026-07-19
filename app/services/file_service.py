import base64
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import ALLOWED_EXTENSIONS
from docflow_docx.pages import load_document_settings, load_variant_rules, save_edit_html
from docflow_docx.structure import get_active_condition_ids, has_configured_rules, normalize_rules
from repositories.file_store import FileStore
from repositories.manifest import ManifestRepository
from services import document_service

_manifest = ManifestRepository()
_files = FileStore()


def _require_entry(file_id: str) -> dict:
    entry = _manifest.find(file_id)
    if entry is None:
        raise FileNotFoundError("Файл не знайдено")
    return entry


def _require_path(entry: dict) -> Path:
    path = _files.path_for(entry["stored_name"])
    if not path.exists():
        raise FileNotFoundError("Файл не знайдено на диску")
    return path


def upload_file(filename: str, content_b64: str) -> dict:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Непідтримуваний тип файлу: {ext}")

    content = base64.b64decode(content_b64)
    file_id = str(uuid.uuid4())
    stored_name = f"{file_id}{ext}"
    path = _files.write_bytes(stored_name, content)

    entry = {
        "id": file_id,
        "name": filename,
        "stored_name": stored_name,
        "size": len(content),
        "extension": ext,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }

    _manifest.insert(entry)

    payload = {
        "file": entry,
        "meta": entry,
        "content": None,
        "preview_html": None,
        "editable": ext in {".txt", ".docx"},
        "document_settings": {},
    }

    if ext in {".txt", ".docx", ".pdf"}:
        content_text, preview_html, document_settings = document_service.build_preview(
            path,
            ext,
            filename,
        )
        payload["content"] = content_text
        payload["preview_html"] = preview_html
        payload["document_settings"] = document_settings

    return payload


def list_files(query: str = "") -> list[dict]:
    return _manifest.list_files(query)


def get_file_content(file_id: str) -> dict:
    entry = _require_entry(file_id)
    path = _require_path(entry)

    content, preview_html, document_settings = document_service.build_preview(
        path,
        entry["extension"],
        entry["name"],
    )

    return {
        "meta": entry,
        "content": content,
        "preview_html": preview_html,
        "editable": entry["extension"] in {".txt", ".docx"},
        "document_settings": document_settings,
    }


def apply_bank_employee_setting(file_id: str, is_bank_employee: bool) -> dict:
    return apply_condition_setting(file_id, "bank_employee", is_bank_employee)


def apply_condition_setting(
    file_id: str,
    condition_id: str,
    value,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Налаштування варіантів доступні лише для DOCX")

    path = _require_path(entry)
    preview_html, document_settings = document_service.apply_document_setting(
        path,
        condition_id,
        value,
        rules=rules,
        all_condition_values=all_condition_values,
    )

    return {
        "preview_html": preview_html,
        "document_settings": document_settings,
    }


def approve_document(
    file_id: str,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Затвердження доступне лише для DOCX")

    path = _require_path(entry)
    preview_html, document_settings = document_service.approve_document(
        path,
        rules=rules,
        all_condition_values=all_condition_values,
    )

    return {
        "preview_html": preview_html,
        "document_settings": document_settings,
    }


def preview_approval_document(
    file_id: str,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Перегляд затвердження доступний лише для DOCX")

    path = _require_path(entry)
    preview_html, document_settings = document_service.preview_approval_document(
        path,
        rules=rules,
        all_condition_values=all_condition_values,
    )

    return {
        "preview_html": preview_html,
        "document_settings": document_settings,
    }


def cancel_approval_preview(
    file_id: str,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Скасування перегляду доступне лише для DOCX")

    path = _require_path(entry)
    preview_html, document_settings = document_service.cancel_approval_preview(
        path,
        rules=rules,
        all_condition_values=all_condition_values,
    )

    return {
        "preview_html": preview_html,
        "document_settings": document_settings,
    }


def revert_document_approval(
    file_id: str,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Скасування затвердження доступне лише для DOCX")

    path = _require_path(entry)
    preview_html, document_settings = document_service.revert_document_approval(
        path,
        rules=rules,
        all_condition_values=all_condition_values,
    )

    return {
        "preview_html": preview_html,
        "document_settings": document_settings,
    }


def clear_condition_setting(
    file_id: str,
    condition_id: str,
    rules: dict | None = None,
    all_condition_values: dict | None = None,
) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Налаштування варіантів доступні лише для DOCX")

    path = _require_path(entry)
    preview_html, document_settings = document_service.clear_document_setting(
        path,
        condition_id,
        rules=rules,
        all_condition_values=all_condition_values,
    )

    return {
        "preview_html": preview_html,
        "document_settings": document_settings,
    }


def get_edit_view(file_id: str, html_b64: str | None = None) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Редагування правил доступне лише для DOCX")

    path = _require_path(entry)
    if html_b64:
        html = base64.b64decode(html_b64).decode("utf-8")
        edit_html, meta = document_service.build_edit_view_from_html(path, html)
    else:
        edit_html, meta = document_service.build_edit_view(path)
    return {"edit_html": edit_html, "document_settings": meta}


def get_preview_from_html(file_id: str, html_b64: str) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Попередній перегляд доступний лише для DOCX")

    path = _require_path(entry)
    html = base64.b64decode(html_b64).decode("utf-8")
    preview_html, document_settings = document_service.build_preview_from_html(path, html)
    return {
        "preview_html": preview_html,
        "document_settings": document_settings,
    }


def sync_document_source(file_id: str, html_b64: str) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Синхронізація доступна лише для DOCX")

    path = _require_path(entry)
    html = base64.b64decode(html_b64).decode("utf-8")
    preview_html, edit_html, document_settings = document_service.sync_document_source(
        path,
        html,
    )
    return {
        "preview_html": preview_html,
        "edit_html": edit_html,
        "document_settings": document_settings,
    }


def save_variant_rules(file_id: str, rules: dict) -> dict:
    entry = _require_entry(file_id)
    if entry["extension"] != ".docx":
        raise ValueError("Правила варіантів доступні лише для DOCX")

    path = _require_path(entry)
    edit_html, meta = document_service.save_rules_and_refresh(path, rules)
    return {"edit_html": edit_html, "document_settings": meta}


def save_file(
    file_id: str,
    content: str | None = None,
    html: str | None = None,
) -> dict:
    entry = _require_entry(file_id)
    path = _require_path(entry)
    extension = entry["extension"]
    document_settings: dict = {}

    if extension == ".txt":
        text = content if content is not None else document_service.html_to_text(html or "")
        encoded = text.encode("utf-8")
        path.write_bytes(encoded)
        if html:
            save_edit_html(path, html)
        entry["size"] = len(encoded)

    elif extension == ".docx":
        if not html:
            raise ValueError("Для збереження DOCX потрібен HTML-вміст")
        document_settings = document_service.save_docx_content(path, html)
        _, preview_html, _ = document_service.build_preview(path, extension, entry["name"])
        edit_html, _ = document_service.build_edit_view(path)
        entry["size"] = path.stat().st_size
        entry["updated_at"] = datetime.now(timezone.utc).isoformat()
        _manifest.update(entry)
        return {
            "file": entry,
            "document_settings": document_settings,
            "preview_html": preview_html,
            "edit_html": edit_html,
        }

    else:
        raise ValueError(f"Неможливо зберегти файли {extension}")

    entry["updated_at"] = datetime.now(timezone.utc).isoformat()
    _manifest.update(entry)
    return {"file": entry, "document_settings": document_settings}


def delete_file(file_id: str) -> dict:
    entry = _require_entry(file_id)
    _files.delete(entry["stored_name"])
    removed = _manifest.remove(file_id)
    if removed is None:
        raise FileNotFoundError("Файл не знайдено")
    return removed


def _require_export_ready(entry: dict, path: Path) -> None:
    if entry["extension"] != ".docx":
        return

    rules = normalize_rules(load_variant_rules(path))
    if not has_configured_rules(rules):
        return

    active_ids = get_active_condition_ids(rules)
    if not active_ids:
        return

    settings = load_document_settings(path)
    if not settings.get("approved"):
        raise ValueError("Спочатку затвердіть документ на вкладці «Перегляд»")


def get_file_bytes(file_id: str) -> tuple[dict, bytes]:
    entry = _require_entry(file_id)
    path = _require_path(entry)
    _require_export_ready(entry, path)
    if entry["extension"] == ".docx":
        document_service.refresh_docx_for_export(path)
    return entry, _files.read_bytes(entry["stored_name"])


FILES_DIR = _files.files_dir
