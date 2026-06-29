import webview
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
HTML_PATH = BASE_DIR / "resources" / "html" / "main.html"

webview.create_window(
    "Smart Word",
    HTML_PATH.resolve().as_uri()
)

webview.start()