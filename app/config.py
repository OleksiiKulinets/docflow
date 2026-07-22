from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FILES_DIR = DATA_DIR / "files"
MANIFEST_PATH = DATA_DIR / "manifest.json"
RESOURCES_DIR = BASE_DIR / "resources"
HTML_PATH = RESOURCES_DIR / "html" / "main.html"

ALLOWED_EXTENSIONS = frozenset({".txt", ".docx", ".pdf"})

WINDOW_TITLE = "DocFlow"
WINDOW_WIDTH = 1200
WINDOW_HEIGHT = 800
WINDOW_MIN_SIZE = (800, 600)
WINDOW_MAXIMIZED = True
