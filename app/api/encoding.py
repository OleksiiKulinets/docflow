import base64

HTML_FIELDS = frozenset({"preview_html", "edit_html"})
HTML_BASE64_THRESHOLD = 32 * 1024


def encode_html_fields(data: dict) -> dict:
    encoded = dict(data)
    html_encoding = {}
    for field in HTML_FIELDS:
        value = encoded.get(field)
        if isinstance(value, str) and value:
            if len(value.encode("utf-8")) >= HTML_BASE64_THRESHOLD:
                encoded[field] = base64.b64encode(value.encode("utf-8")).decode("ascii")
                html_encoding[field] = "base64"
    if html_encoding:
        encoded["html_encoding"] = html_encoding
    return encoded
