from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

if TYPE_CHECKING:
    from docx.document import Document as DocumentObject

ROMAN_ONES = (
    (1000, "m"),
    (900, "cm"),
    (500, "d"),
    (400, "cd"),
    (100, "c"),
    (90, "xc"),
    (50, "l"),
    (40, "xl"),
    (10, "x"),
    (9, "ix"),
    (5, "v"),
    (4, "iv"),
    (1, "i"),
)


@dataclass
class LevelDef:
    ilvl: int
    num_fmt: str = "decimal"
    lvl_text: str = "%1."
    start: int = 1
    is_lgl: bool = False


@dataclass
class NumberingState:
    _levels: dict[int, dict[int, LevelDef]]
    _counters: dict[int, dict[int, int]] = field(default_factory=dict)

    def label_for(self, paragraph: Paragraph) -> tuple[str, bool]:
        num_id, ilvl = _paragraph_num_info(paragraph)
        levels = self._levels.get(num_id)
        if not levels:
            return "", False

        level = levels.get(ilvl) or levels.get(0)
        if level.num_fmt in ("bullet", "none"):
            marker = _bullet_marker(level.lvl_text)
            return marker, True

        counters = self._counters.setdefault(num_id, {})
        counters[ilvl] = counters.get(ilvl, level.start - 1) + 1
        for lvl in list(counters.keys()):
            if lvl > ilvl:
                del counters[lvl]

        label = _format_label(level.lvl_text, levels, counters, ilvl)
        return label, False


def build_numbering_state(doc: DocumentObject) -> NumberingState:
    return NumberingState(_levels=_parse_numbering_levels(doc))


def _paragraph_num_info(paragraph: Paragraph) -> tuple[int, int]:
    num_pr = paragraph._element.pPr.numPr
    num_id = int(num_pr.numId.val)
    ilvl = int(num_pr.ilvl.val) if num_pr.ilvl is not None else 0
    return num_id, ilvl


def _parse_numbering_levels(doc: DocumentObject) -> dict[int, dict[int, LevelDef]]:
    try:
        numbering_root = doc.part.numbering_part._element
    except Exception:
        return {}

    styles_root = doc.part.styles.element
    abstract_levels = _parse_abstract_levels(numbering_root, styles_root)
    num_levels: dict[int, dict[int, LevelDef]] = {}

    for num in numbering_root.findall(qn("w:num")):
        num_id = num.get(qn("w:numId"))
        if num_id is None:
            continue

        abstract_ref = num.find(qn("w:abstractNumId"))
        abstract_id = abstract_ref.get(qn("w:val")) if abstract_ref is not None else None
        levels: dict[int, LevelDef] = {}
        if abstract_id and abstract_id in abstract_levels:
            levels = {ilvl: _clone_level(defn) for ilvl, defn in abstract_levels[abstract_id].items()}

        for override in num.findall(qn("w:lvlOverride")):
            ilvl_raw = override.get(qn("w:ilvl"))
            if ilvl_raw is None:
                continue
            ilvl = int(ilvl_raw)

            lvl = override.find(qn("w:lvl"))
            if lvl is not None:
                levels[ilvl] = _parse_level(lvl, ilvl)
                continue

            start_override = override.find(qn("w:startOverride"))
            if start_override is not None and ilvl in levels:
                val = start_override.find(qn("w:startVal"))
                if val is not None:
                    levels[ilvl].start = int(val.get(qn("w:val"), "1"))

        if levels:
            num_levels[int(num_id)] = levels

    return num_levels


def _parse_abstract_levels(
    numbering_root,
    styles_root,
) -> dict[str, dict[int, LevelDef]]:
    abstract_levels: dict[str, dict[int, LevelDef]] = {}

    for abstract in numbering_root.findall(qn("w:abstractNum")):
        abstract_id = abstract.get(qn("w:abstractNumId"))
        if abstract_id is None:
            continue

        levels: dict[int, LevelDef] = {}
        for lvl in abstract.findall(qn("w:lvl")):
            ilvl_raw = lvl.get(qn("w:ilvl"))
            if ilvl_raw is None:
                continue
            levels[int(ilvl_raw)] = _parse_level(lvl, int(ilvl_raw))

        if not levels:
            style_link = abstract.find(qn("w:numStyleLink"))
            if style_link is not None:
                linked = _levels_from_style_link(
                    style_link.get(qn("w:val")),
                    styles_root,
                    numbering_root,
                    abstract_levels,
                )
                if linked:
                    levels = linked

        if levels:
            abstract_levels[abstract_id] = levels

    return abstract_levels


def _levels_from_style_link(
    style_id: str | None,
    styles_root,
    numbering_root,
    abstract_levels: dict[str, dict[int, LevelDef]],
) -> dict[int, LevelDef]:
    if not style_id:
        return {}

    for style in styles_root.findall(qn("w:style")):
        if style.get(qn("w:styleId")) != style_id:
            continue
        p_pr = style.find(qn("w:pPr"))
        if p_pr is None:
            return {}
        num_pr = p_pr.find(qn("w:numPr"))
        if num_pr is None:
            return {}
        num_id_el = num_pr.find(qn("w:numId"))
        if num_id_el is None:
            return {}
        linked_num_id = num_id_el.get(qn("w:val"))
        if linked_num_id is None:
            return {}

        for num in numbering_root.findall(qn("w:num")):
            if num.get(qn("w:numId")) != linked_num_id:
                continue
            abstract_ref = num.find(qn("w:abstractNumId"))
            abstract_id = abstract_ref.get(qn("w:val")) if abstract_ref is not None else None
            if abstract_id and abstract_id in abstract_levels:
                return {
                    ilvl: _clone_level(defn)
                    for ilvl, defn in abstract_levels[abstract_id].items()
                }
            break
    return {}


def _parse_level(lvl, ilvl: int) -> LevelDef:
    num_fmt_el = lvl.find(qn("w:numFmt"))
    lvl_text_el = lvl.find(qn("w:lvlText"))
    start_el = lvl.find(qn("w:start"))
    is_lgl = lvl.find(qn("w:isLgl")) is not None

    return LevelDef(
        ilvl=ilvl,
        num_fmt=num_fmt_el.get(qn("w:val"), "decimal") if num_fmt_el is not None else "decimal",
        lvl_text=lvl_text_el.get(qn("w:val"), "%1.") if lvl_text_el is not None else "%1.",
        start=int(start_el.get(qn("w:val"), "1")) if start_el is not None else 1,
        is_lgl=is_lgl,
    )


def _clone_level(defn: LevelDef) -> LevelDef:
    return LevelDef(
        ilvl=defn.ilvl,
        num_fmt=defn.num_fmt,
        lvl_text=defn.lvl_text,
        start=defn.start,
        is_lgl=defn.is_lgl,
    )


def _format_label(
    template: str,
    levels: dict[int, LevelDef],
    counters: dict[int, int],
    current_ilvl: int,
) -> str:
    result = template
    for index in range(1, 10):
        placeholder = f"%{index}"
        if placeholder not in result:
            continue

        lvl_index = index - 1
        level = levels.get(lvl_index)
        if level is None:
            continue

        if lvl_index in counters:
            value = counters[lvl_index]
        else:
            value = level.start

        formatted = _format_number(value, level.num_fmt, level.is_lgl)
        result = result.replace(placeholder, formatted)

    return result


def _format_number(value: int, num_fmt: str, is_lgl: bool) -> str:
    if num_fmt == "decimal":
        return str(value if not is_lgl else value)
    if num_fmt == "lowerLetter":
        return _to_letters(value, upper=False)
    if num_fmt == "upperLetter":
        return _to_letters(value, upper=True)
    if num_fmt == "lowerRoman":
        return _to_roman(value).lower()
    if num_fmt == "upperRoman":
        return _to_roman(value)
    if num_fmt == "bullet":
        return _bullet_marker(str(value))
    return str(value)


def _to_letters(value: int, upper: bool) -> str:
    if value <= 0:
        return "a" if not upper else "A"
    letters = []
    current = value
    while current > 0:
        current, rem = divmod(current - 1, 26)
        char = chr(ord("a" if not upper else "A") + rem)
        letters.append(char)
    return "".join(reversed(letters))


def _to_roman(value: int) -> str:
    if value <= 0:
        return "I"
    parts: list[str] = []
    remaining = value
    for amount, numeral in ROMAN_ONES:
        while remaining >= amount:
            parts.append(numeral)
            remaining -= amount
    return "".join(parts).upper()


def _bullet_marker(text: str) -> str:
    if not text:
        return "•"
    if text in {"o", "\uf0b7", "\uf0a7"}:
        return {"o": "◦", "\uf0b7": "•", "\uf0a7": "▪"}.get(text, "•")
    return text


def is_numbered_paragraph(paragraph: Paragraph, numbering: NumberingState) -> bool:
    if not _is_list_paragraph(paragraph):
        return False
    num_id, ilvl = _paragraph_num_info(paragraph)
    levels = numbering._levels.get(num_id)
    if not levels:
        return False
    level = levels.get(ilvl) or levels.get(0)
    return level.num_fmt not in ("bullet", "none")


def is_list_paragraph(paragraph: Paragraph) -> bool:
    return _is_list_paragraph(paragraph)


def _is_list_paragraph(paragraph: Paragraph) -> bool:
    p_pr = paragraph._element.pPr
    return p_pr is not None and p_pr.numPr is not None
