import webview
from pathlib import Path

from api import DocFlowApi

BASE_DIR = Path(__file__).resolve().parent
HTML_PATH = BASE_DIR / "resources" / "html" / "main.html"

WINDOW_TITLE = "DocFlow"
WINDOW_WIDTH = 1200
WINDOW_HEIGHT = 800
WINDOW_MIN_SIZE = (800, 600)


def main() -> None:
    api = DocFlowApi()

    webview.create_window(
        WINDOW_TITLE,
        HTML_PATH.as_uri(),
        width=WINDOW_WIDTH,
        height=WINDOW_HEIGHT,
        min_size=WINDOW_MIN_SIZE,
        js_api=api,
    )
    webview.start()


if __name__ == "__main__":
    main()
