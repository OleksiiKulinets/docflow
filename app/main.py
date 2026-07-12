import webview

from api import DocFlowApi
from config import HTML_PATH, WINDOW_HEIGHT, WINDOW_MIN_SIZE, WINDOW_TITLE, WINDOW_WIDTH


def main() -> None:
    api = DocFlowApi()

    window = webview.create_window(
        WINDOW_TITLE,
        HTML_PATH.as_uri(),
        width=WINDOW_WIDTH,
        height=WINDOW_HEIGHT,
        min_size=WINDOW_MIN_SIZE,
        js_api=api,
    )
    api.attach_window(window)

    def on_closing():
        if api._close_confirmed:
            return True
        # Never call evaluate_js synchronously here — it deadlocks WebView2
        # while the FormClosing handler is still running.
        api.defer_close_prompt()
        return False

    window.events.closing += on_closing
    webview.start()


if __name__ == "__main__":
    main()
