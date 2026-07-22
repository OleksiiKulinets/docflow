import logging
import threading

from api.encoding import encode_html_fields
from api.export_dialog import export_file_to_dialog
from services import file_service

_log = logging.getLogger("docflow.api")


class DocFlowApi:
    def __init__(self) -> None:
        self._window = None
        self._close_confirmed = False
        self._close_prompt_active = False

    def attach_window(self, window) -> None:
        self._window = window

    def defer_close_prompt(self) -> None:
        if self._close_prompt_active:
            return
        self._close_prompt_active = True
        threading.Timer(0.05, self._run_close_prompt).start()

    def _run_close_prompt(self) -> None:
        if self._window is None:
            self._close_prompt_active = False
            return
        try:
            self._window.evaluate_js(
                "DocFlow.handleAppClose()",
                callback=lambda _result: None,
            )
        except Exception:
            self._close_prompt_active = False
            raise

    def cancel_close_prompt(self) -> dict:
        self._close_prompt_active = False
        return {"ok": True}

    def prepare_close(self) -> dict:
        self._close_confirmed = True
        threading.Timer(0.05, self._destroy_window).start()
        return {"ok": True}

    def _destroy_window(self) -> None:
        if self._window is not None:
            self._window.destroy()

    def _ok(self, data: dict | None = None) -> dict:
        payload = {"ok": True}
        if data:
            payload.update(data)
        return payload

    def _fail(self, exc: Exception) -> dict:
        _log.exception("API error: %s", exc)
        return {"ok": False, "error": str(exc)}

    def debug_log(self, source: str, message: str, detail: str | None = None) -> dict:
        text = f"{source}: {message}"
        if detail:
            text = f"{text} | {detail}"
        _log.info(text)
        return {"ok": True}

    def _encode(self, data: dict) -> dict:
        return encode_html_fields(data)

    def upload_file(self, filename: str, content_b64: str) -> dict:
        try:
            data = file_service.upload_file(filename, content_b64)
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def list_files(self, query: str = "") -> dict:
        try:
            return self._ok({"files": file_service.list_files(query)})
        except Exception as exc:
            return self._fail(exc)

    def get_file(self, file_id: str) -> dict:
        try:
            data = file_service.get_file_content(file_id)
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def apply_bank_employee_setting(self, file_id: str, is_bank_employee: bool) -> dict:
        try:
            data = file_service.apply_bank_employee_setting(file_id, is_bank_employee)
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def apply_condition_setting(
        self,
        file_id: str,
        condition_id: str,
        value,
        rules: dict | None = None,
        all_condition_values: dict | None = None,
    ) -> dict:
        try:
            data = file_service.apply_condition_setting(
                file_id,
                condition_id,
                value,
                rules=rules,
                all_condition_values=all_condition_values,
            )
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def clear_condition_setting(
        self,
        file_id: str,
        condition_id: str,
        rules: dict | None = None,
        all_condition_values: dict | None = None,
    ) -> dict:
        try:
            data = file_service.clear_condition_setting(
                file_id,
                condition_id,
                rules=rules,
                all_condition_values=all_condition_values,
            )
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def approve_document(
        self,
        file_id: str,
        rules: dict | None = None,
        all_condition_values: dict | None = None,
    ) -> dict:
        try:
            data = file_service.approve_document(
                file_id,
                rules=rules,
                all_condition_values=all_condition_values,
            )
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def preview_approval_document(
        self,
        file_id: str,
        rules: dict | None = None,
        all_condition_values: dict | None = None,
    ) -> dict:
        try:
            data = file_service.preview_approval_document(
                file_id,
                rules=rules,
                all_condition_values=all_condition_values,
            )
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def cancel_approval_preview(
        self,
        file_id: str,
        rules: dict | None = None,
        all_condition_values: dict | None = None,
    ) -> dict:
        try:
            data = file_service.cancel_approval_preview(
                file_id,
                rules=rules,
                all_condition_values=all_condition_values,
            )
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def revert_document_approval(
        self,
        file_id: str,
        rules: dict | None = None,
        all_condition_values: dict | None = None,
    ) -> dict:
        try:
            data = file_service.revert_document_approval(
                file_id,
                rules=rules,
                all_condition_values=all_condition_values,
            )
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def get_edit_view(self, file_id: str, html_b64: str | None = None) -> dict:
        try:
            _log.info("get_edit_view file_id=%s html_b64=%s", file_id, bool(html_b64))
            data = file_service.get_edit_view(file_id, html_b64)
            edit_html = data.get("edit_html") or ""
            _log.info(
                "get_edit_view ok file_id=%s edit_html_chars=%d",
                file_id,
                len(edit_html),
            )
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def get_preview_from_html(self, file_id: str, html_b64: str) -> dict:
        try:
            data = file_service.get_preview_from_html(file_id, html_b64)
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def sync_document_source(self, file_id: str, html_b64: str) -> dict:
        try:
            _log.info("sync_document_source file_id=%s html_b64_chars=%d", file_id, len(html_b64 or ""))
            data = file_service.sync_document_source(file_id, html_b64)
            edit_html = data.get("edit_html") or ""
            preview_html = data.get("preview_html") or ""
            _log.info(
                "sync_document_source ok file_id=%s preview_chars=%d edit_chars=%d",
                file_id,
                len(preview_html),
                len(edit_html),
            )
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def save_variant_rules(self, file_id: str, rules: dict) -> dict:
        try:
            data = file_service.save_variant_rules(file_id, rules)
            return self._ok(self._encode(data))
        except Exception as exc:
            return self._fail(exc)

    def save_file(self, file_id: str, content: str | None = None, html: str | None = None) -> dict:
        try:
            data = file_service.save_file(file_id, content, html)
            if data.get("preview_html") or data.get("edit_html"):
                return self._ok(self._encode(data))
            return self._ok(data)
        except Exception as exc:
            return self._fail(exc)

    def delete_file(self, file_id: str) -> dict:
        try:
            entry = file_service.delete_file(file_id)
            return self._ok({"file": entry})
        except Exception as exc:
            return self._fail(exc)

    def export_file(self, file_id: str) -> dict:
        try:
            data = export_file_to_dialog(file_id)
            return self._ok(data)
        except Exception as exc:
            return self._fail(exc)
