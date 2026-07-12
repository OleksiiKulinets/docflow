from pathlib import Path

from config import FILES_DIR


class FileStore:
    def __init__(self, files_dir: Path = FILES_DIR) -> None:
        self._files_dir = files_dir

    @property
    def files_dir(self) -> Path:
        return self._files_dir

    def path_for(self, stored_name: str) -> Path:
        return self._files_dir / stored_name

    def write_bytes(self, stored_name: str, content: bytes) -> Path:
        path = self.path_for(stored_name)
        path.write_bytes(content)
        return path

    def read_bytes(self, stored_name: str) -> bytes:
        path = self.path_for(stored_name)
        if not path.exists():
            raise FileNotFoundError("Файл не знайдено на диску")
        return path.read_bytes()

    def delete(self, stored_name: str) -> None:
        path = self.path_for(stored_name)
        edit_path = path.parent / f"{path.name}.edit.json"
        if path.exists():
            path.unlink()
        if edit_path.exists():
            edit_path.unlink()
