import re

RED_COLOR_NAMES = frozenset({"crimson", "firebrick", "red", "darkred"})
RED_HEX_VALUES = frozenset({
    "ff0000", "c00000", "cc0000", "ee0000", "800000",
    "a50000", "b30000", "d40000", "e60000", "ff3333",
})

_COLOR_IN_STYLE_RE = re.compile(
    r"(?:^|;)\s*color\s*:\s*([^;]+)",
    re.IGNORECASE,
)
_RGB_RE = re.compile(
    r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)",
    re.IGNORECASE,
)


def color_value_is_red(value: str) -> bool:
    normalized = value.strip().lower()
    if not normalized:
        return False
    if normalized in RED_COLOR_NAMES:
        return True

    if normalized.startswith("#"):
        hex_value = normalized[1:]
        if len(hex_value) == 3:
            hex_value = "".join(ch * 2 for ch in hex_value)
        if len(hex_value) == 6 and hex_value in RED_HEX_VALUES:
            return True
        if len(hex_value) == 6:
            red = int(hex_value[0:2], 16)
            green = int(hex_value[2:4], 16)
            blue = int(hex_value[4:6], 16)
            return red >= 180 and green <= 80 and blue <= 80

    rgb_match = _RGB_RE.match(normalized)
    if rgb_match:
        red, green, blue = map(int, rgb_match.groups())
        return red >= 180 and green <= 80 and blue <= 80

    return False


def style_has_red(style: str) -> bool:
    if not style:
        return False
    match = _COLOR_IN_STYLE_RE.search(style)
    if not match:
        return False
    return color_value_is_red(match.group(1))


def remove_red_color_from_style(style: str) -> str:
    if not style:
        return ""

    parts: list[str] = []
    for chunk in style.split(";"):
        piece = chunk.strip()
        if not piece:
            continue
        if piece.lower().startswith("color:"):
            value = piece.split(":", 1)[1].strip()
            if color_value_is_red(value):
                continue
        parts.append(piece)
    return "; ".join(parts)
