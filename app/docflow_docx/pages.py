import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag

from docflow_docx.renderer import DOCX_PAGE_STYLE
from docflow_docx.sanitize import sanitize_edit_html

_DOCX_ROOT_CLASS_RE = re.compile(r'class="docx-document([^"]*)"', re.IGNORECASE)


def edit_json_path(file_path: Path) -> Path:
    return file_path.parent / f"{file_path.name}.edit.json"


def _repair_document_model_fragment(remainder: str) -> dict[str, Any] | None:
    remainder = remainder.lstrip()
    if not remainder.startswith(('"label"', '"id"', '"type"')):
        return None

    field_id = "field-1"
    match = re.search(r'"condition_id"\s*:\s*"([^"]+)"', remainder)
    if match:
        field_id = match.group(1)

    prefix = f'{{"schema_version":5,"fields":[{{"id":"{field_id}",'
    text = prefix + remainder
    for candidate in (text, text.rstrip()[:-1] if text.rstrip().endswith("}") else text):
        try:
            model = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(model, dict) and model.get("schema_version") == 5:
            return model
    return None


def _parse_edit_json(raw: str) -> dict[str, Any]:
    raw = raw.lstrip("\ufeff").strip()
    if not raw:
        return {}

    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError as exc:
        if "Extra data" not in str(exc):
            raise

    decoder = json.JSONDecoder()
    data, idx = decoder.raw_decode(raw)
    if not isinstance(data, dict):
        return {}

    tail = raw[idx:].lstrip()
    if not tail:
        return data

    model = data.get("document_model")
    if not isinstance(model, dict):
        model = {}
    if model.get("fields") or model.get("nodes"):
        return data

    repaired = _repair_document_model_fragment(tail)
    if not repaired:
        return data

    data["document_model"] = repaired
    settings = data.get("settings")
    if isinstance(settings, dict):
        settings["document_model"] = repaired
        settings.pop("variant_rules", None)
        field_ids = [
            str(field.get("id"))
            for field in repaired.get("fields") or []
            if field.get("id")
        ]
        if field_ids:
            settings["active_condition_ids"] = sorted(set(field_ids))
    return data


def _normalize_edit_payload(data: dict[str, Any]) -> dict[str, Any]:
    payload = dict(data)
    model = payload.get("document_model")
    if isinstance(model, dict) and model.get("schema_version") == 5:
        payload["document_model"] = model
        payload.pop("variant_rules", None)
        settings = payload.get("settings")
        if isinstance(settings, dict):
            settings = dict(settings)
            settings["document_model"] = model
            settings.pop("variant_rules", None)
            payload["settings"] = settings
    return payload


_edit_json_locks_guard = threading.Lock()
_edit_json_locks: dict[str, threading.Lock] = {}


def _edit_json_lock(path: Path) -> threading.Lock:
    key = str(path.resolve())
    with _edit_json_locks_guard:
        lock = _edit_json_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _edit_json_locks[key] = lock
        return lock


def _write_edit_data(file_path: Path, data: dict[str, Any]) -> None:
    path = edit_json_path(file_path)
    payload = _normalize_edit_payload(data)
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    path.parent.mkdir(parents=True, exist_ok=True)

    with _edit_json_lock(path):
        temp_path = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            temp_path.write_text(encoded, encoding="utf-8")
            for attempt in range(8):
                try:
                    os.replace(temp_path, path)
                    return
                except PermissionError:
                    if attempt == 7:
                        break
                    time.sleep(0.05 * (attempt + 1))
                except OSError as exc:
                    if getattr(exc, "winerror", None) == 2 or exc.errno == 2:
                        if attempt == 7:
                            break
                        temp_path.write_text(encoded, encoding="utf-8")
                        continue
                    raise
            path.write_text(encoded, encoding="utf-8")
        finally:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass


def _raw_has_extra_json(raw: str) -> bool:
    try:
        json.loads(raw.lstrip("\ufeff").strip())
        return False
    except json.JSONDecodeError as exc:
        return "Extra data" in str(exc)


def load_edit_data(file_path: Path) -> dict[str, Any]:
    path = edit_json_path(file_path)
    if not path.exists():
        return {}

    raw = path.read_text(encoding="utf-8")
    data = _parse_edit_json(raw)
    normalized = _normalize_edit_payload(data)
    if normalized != data or _raw_has_extra_json(raw):
        try:
            _write_edit_data(file_path, normalized)
        except OSError:
            # Sidecar may be locked on Windows while the app reads it; keep in-memory data.
            pass
    return normalized


def load_edit_html(file_path: Path) -> str | None:
    data = load_edit_data(file_path)
    if "html" in data:
        return data["html"]
    if "pages" in data:
        return "".join(page.get("html", "") for page in data["pages"])
    return None


def load_draft_source_html(file_path: Path) -> str | None:
    data = load_edit_data(file_path)
    draft = data.get("draft_source_html")
    if isinstance(draft, str) and draft.strip():
        return draft
    return load_source_html(file_path)


def save_draft_source_html(file_path: Path, html: str) -> None:
    data = load_edit_data(file_path)
    data["draft_source_html"] = html
    _write_edit_data(file_path, data)


def load_source_html(file_path: Path) -> str | None:
    data = load_edit_data(file_path)
    source = data.get("source_html")
    if isinstance(source, str) and source.strip():
        return source
    return load_edit_html(file_path)


def load_document_settings(file_path: Path) -> dict[str, Any]:
    data = load_edit_data(file_path)
    settings = data.get("settings")
    return settings if isinstance(settings, dict) else {}


def load_variant_rules(file_path: Path) -> dict[str, Any] | None:
    data = load_edit_data(file_path)
    rules = data.get("variant_rules")
    return rules if isinstance(rules, dict) else None


def save_variant_rules(file_path: Path, rules: dict[str, Any]) -> None:
    data = load_edit_data(file_path)
    if isinstance(rules, dict) and rules.get("schema_version") == 5:
        data["document_model"] = rules
        data.pop("variant_rules", None)
    else:
        data["variant_rules"] = rules
    _write_edit_data(file_path, data)


def load_document_model(file_path: Path) -> dict[str, Any] | None:
    data = load_edit_data(file_path)
    model = data.get("document_model")
    return model if isinstance(model, dict) else None


def save_document_model(file_path: Path, model: dict[str, Any]) -> None:
    data = load_edit_data(file_path)
    data["document_model"] = model
    data.pop("variant_rules", None)
    _write_edit_data(file_path, data)


def save_edit_html(
    file_path: Path,
    html: str,
    *,
    source_html: str | None = None,
    settings: dict[str, Any] | None = None,
    variant_rules: dict[str, Any] | None = None,
) -> None:
    data = load_edit_data(file_path)

    data["html"] = html
    if source_html is not None:
        data["source_html"] = source_html
    elif "source_html" not in data:
        data["source_html"] = html

    if settings is not None:
        data["settings"] = settings

    if variant_rules is not None:
        if variant_rules.get("schema_version") == 5:
            data["document_model"] = variant_rules
            data.pop("variant_rules", None)
        else:
            data["variant_rules"] = variant_rules

    if "settings" not in data:
        data["settings"] = {}

    _write_edit_data(file_path, data)


def save_document_settings(file_path: Path, settings: dict[str, Any]) -> None:
    data = load_edit_data(file_path)
    data["settings"] = settings
    _write_edit_data(file_path, data)


def strip_variant_wrappers(html: str) -> str:
    if not html or "docx-variant" not in html:
        return html

    soup = BeautifulSoup(f"<div id='strip-root'>{html}</div>", "html.parser")
    root = soup.find("div", id="strip-root")
    if root is None:
        return html

    for variant in list(root.find_all("div", class_="docx-variant")):
        blocks: list[Tag] = []
        condition = variant.find("div", class_="docx-variant-condition")
        body = variant.find("div", class_="docx-variant-body")

        if condition:
            for block in list(condition.children):
                if isinstance(block, Tag):
                    blocks.append(block.extract())
        if body:
            for block in list(body.children):
                if isinstance(block, Tag):
                    blocks.append(block.extract())

        for block in blocks:
            variant.insert_before(block)
        variant.decompose()

    return root.decode_contents()


def needs_numbering_refresh(html: str) -> bool:
    if not html:
        return False
    return "docx-list" in html and "docx-num-marker" not in html


def patch_docx_root(html: str, classes: str, *, editable: bool) -> str:
    flag = "true" if editable else "false"

    def _replace(match: re.Match[str]) -> str:
        extra = match.group(1).strip()
        merged = f"{classes} {extra}".strip() if extra else classes
        return (
            f'class="{merged}" contenteditable="{flag}" spellcheck="{flag}"'
        )

    if _DOCX_ROOT_CLASS_RE.search(html):
        return _DOCX_ROOT_CLASS_RE.sub(_replace, html, count=1)

    return (
        f'<div class="{classes}" contenteditable="{flag}" spellcheck="{flag}" '
        f'style="{DOCX_PAGE_STYLE}">'
        f"{html}</div>"
    )


def make_editable(html: str, extra_class: str = "") -> str:
    classes = "docx-document docx-editable"
    if extra_class:
        classes += f" {extra_class}"

    inner = patch_docx_root(html, classes, editable=True)
    return f'<div class="docx-canvas">{inner}</div>'


def prepare_edit_html(html: str) -> str:
    return sanitize_edit_html(strip_variant_wrappers(html))
