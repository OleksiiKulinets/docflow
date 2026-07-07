import shutil

import webview

try:
    from webview import FileDialog
except ImportError:
    FileDialog = None

from storage import files as file_storage

_FILE_TYPES = {
    ".docx": ("Word Documents (*.docx)", "All files (*.*)"),
    ".txt": ("Text Files (*.txt)", "All files (*.*)"),
    ".pdf": ("PDF Files (*.pdf)", "All files (*.*)"),
}


class DocFlowApi:
    def upload_file(self, filename: str, content_b64: str) -> dict:
        try:
            entry = file_storage.upload_file(filename, content_b64)
            return {"ok": True, "file": entry}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def list_files(self, query: str = "") -> dict:
        try:
            return {"ok": True, "files": file_storage.list_files(query)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def get_file(self, file_id: str) -> dict:
        try:
            data = file_storage.get_file_content(file_id)
            return {"ok": True, **data}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def save_file(self, file_id: str, content: str | None = None, html: str | None = None) -> dict:
        try:
            entry = file_storage.save_file(file_id, content, html)
            return {"ok": True, "file": entry}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def delete_file(self, file_id: str) -> dict:
        try:
            entry = file_storage.delete_file(file_id)
            return {"ok": True, "file": entry}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def export_file(self, file_id: str) -> dict:
        try:
            entry, content = file_storage.get_file_bytes(file_id)
            window = webview.active_window()
            if window is None:
                raise RuntimeError("Application window is not available")

            file_types = _FILE_TYPES.get(entry["extension"], ("All files (*.*)",))
            dialog_type = FileDialog.SAVE if FileDialog is not None else webview.SAVE_DIALOG
            destination = window.create_file_dialog(
                dialog_type,
                save_filename=entry["name"],
                file_types=file_types,
            )

            if not destination:
                return {"ok": True, "cancelled": True}

            dest_path = destination[0] if isinstance(destination, (tuple, list)) else destination
            shutil.copy2(file_storage.FILES_DIR / entry["stored_name"], dest_path)

            return {"ok": True, "cancelled": False, "path": dest_path, "file": entry}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
