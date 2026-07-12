import shutil

import webview

try:
    from webview import FileDialog
except ImportError:
    FileDialog = None

from config import ALLOWED_EXTENSIONS
from services import file_service

_FILE_TYPES = {
    ".docx": ("Документи Word (*.docx)", "Усі файли (*.*)"),
    ".txt": ("Текстові файли (*.txt)", "Усі файли (*.*)"),
    ".pdf": ("Файли PDF (*.pdf)", "Усі файли (*.*)"),
}


def export_file_to_dialog(file_id: str) -> dict:
    entry, _content = file_service.get_file_bytes(file_id)
    window = webview.active_window()
    if window is None:
        raise RuntimeError("Вікно програми недоступне")

    if entry["extension"] not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Непідтримуваний тип файлу: {entry['extension']}")

    file_types = _FILE_TYPES.get(entry["extension"], ("Усі файли (*.*)",))
    dialog_type = FileDialog.SAVE if FileDialog is not None else webview.SAVE_DIALOG
    destination = window.create_file_dialog(
        dialog_type,
        save_filename=entry["name"],
        file_types=file_types,
    )

    if not destination:
        return {"cancelled": True}

    dest_path = destination[0] if isinstance(destination, (tuple, list)) else destination
    shutil.copy2(file_service.FILES_DIR / entry["stored_name"], dest_path)

    return {
        "cancelled": False,
        "path": dest_path,
        "file": entry,
    }
