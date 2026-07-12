import json
from pathlib import Path

from config import FILES_DIR, MANIFEST_PATH


class ManifestRepository:
    def __init__(
        self,
        manifest_path: Path = MANIFEST_PATH,
        files_dir: Path = FILES_DIR,
    ) -> None:
        self._manifest_path = manifest_path
        self._files_dir = files_dir

    def ensure_storage(self) -> None:
        self._files_dir.mkdir(parents=True, exist_ok=True)
        if not self._manifest_path.exists():
            self._manifest_path.write_text('{"files": []}', encoding="utf-8")

    def load(self) -> dict:
        self.ensure_storage()
        return json.loads(self._manifest_path.read_text(encoding="utf-8"))

    def save(self, data: dict) -> None:
        self._manifest_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def list_files(self, query: str = "") -> list[dict]:
        files = self.load()["files"]
        q = query.strip().lower()
        if not q:
            return files
        return [entry for entry in files if q in entry["name"].lower()]

    def find(self, file_id: str) -> dict | None:
        return next(
            (entry for entry in self.load()["files"] if entry["id"] == file_id),
            None,
        )

    def insert(self, entry: dict) -> None:
        manifest = self.load()
        manifest["files"].insert(0, entry)
        self.save(manifest)

    def update(self, entry: dict) -> None:
        manifest = self.load()
        manifest["files"] = [
            entry if item["id"] == entry["id"] else item
            for item in manifest["files"]
        ]
        self.save(manifest)

    def remove(self, file_id: str) -> dict | None:
        manifest = self.load()
        entry = self.find(file_id)
        if entry is None:
            return None
        manifest["files"] = [item for item in manifest["files"] if item["id"] != file_id]
        self.save(manifest)
        return entry
