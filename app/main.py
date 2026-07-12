import webview

from api import DocFlowApi
from config import HTML_PATH, WINDOW_HEIGHT, WINDOW_MIN_SIZE, WINDOW_TITLE, WINDOW_WIDTH


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
