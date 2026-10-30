"""Memory pictures as PNG files, and the text measurements their layouts use, both with the app's own font.

The album's detail view, the create sheet's preview and the file "Tải ảnh" / "Chia sẻ" hands over are one PNG,
rendered here from the stored SVG (memories.py, pet_room.py) with the Nunito files the app ships (data/fonts, copied
from @expo-google-fonts/nunito) and no system fonts: the letters, weights, alignment and line breaks are the same on
every phone and in the exported file, and Vietnamese marks never fall back to a font without them.

Rendering never changes what a stored picture shows. It squares the card's corners (a saved photo has no
transparent corners) and shrinks, or as a last resort shortens, a line that runs past the card's edges, which only
pictures stored before lines were measured can have.
"""
from __future__ import annotations

import html
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

import resvg_py
from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).resolve().parent / "data" / "fonts"
# The weights memory pictures use, by usWeightClass; any other weight is drawn with the nearest one.
FONT_FILES = {400: "Nunito_400Regular.ttf", 600: "Nunito_600SemiBold.ttf", 700: "Nunito_700Bold.ttf",
              800: "Nunito_800ExtraBold.ttf"}
FAMILY = "Nunito"
ELLIPSIS = "…"


class RenderError(Exception):
    """A picture could not be rendered (its font files are missing or the SVG is unreadable)."""


def _nearest(weight: int) -> int:
    return min(FONT_FILES, key=lambda w: abs(w - weight))


@lru_cache(maxsize=None)
def _advances(weight: int) -> tuple[dict[int, int], int]:
    """Code point -> advance width, and units per em, of the Nunito file for `weight`."""
    try:
        font = TTFont(FONT_DIR / FONT_FILES[_nearest(weight)], lazy=True)
    except OSError as exc:
        raise RenderError(f"font missing: {exc}") from exc
    metrics = font["hmtx"].metrics
    return {cp: metrics[name][0] for cp, name in font.getBestCmap().items()}, font["head"].unitsPerEm


def clean(text: str) -> str:
    """Text as a picture draws it: precomposed (NFC, so a cut never parts a Vietnamese letter from its marks), on one
    line, without characters Nunito cannot draw (an emoji, say), which would otherwise show as empty boxes."""
    advances, _ = _advances(800)
    text = unicodedata.normalize("NFC", text or "")
    return " ".join("".join(ch if ord(ch) in advances or unicodedata.combining(ch) else " " for ch in text).split())


def width(text: str, size: float, weight: int = 800) -> float:
    advances, upm = _advances(weight)
    return sum(advances.get(ord(ch), 0) for ch in text) * size / upm


def _clusters(text: str) -> list[str]:
    """Letters with the marks that follow them: the places a line may be cut."""
    out: list[str] = []
    for ch in text:
        if out and unicodedata.combining(ch):
            out[-1] += ch
        else:
            out.append(ch)
    return out


def ellipsize(text: str, size: float, max_width: float, weight: int = 800) -> str:
    """`text`, cut and ended in … if it is wider than `max_width`."""
    if width(text, size, weight) <= max_width:
        return text
    parts = _clusters(text)
    while parts and width("".join(parts).rstrip(" ,.;:-") + ELLIPSIS, size, weight) > max_width:
        parts.pop()
    return "".join(parts).rstrip(" ,.;:-") + ELLIPSIS


def wrap(text: str, size: float, max_width: float, weight: int = 800) -> list[str]:
    """Lines no wider than `max_width`, broken at spaces; a word too long for a line is broken between letters."""
    lines, line = [], ""
    for word in text.split():
        candidate = f"{line} {word}" if line else word
        if width(candidate, size, weight) <= max_width:
            line = candidate
            continue
        if line:
            lines.append(line)
        while width(word, size, weight) > max_width:
            parts, cut = _clusters(word), ""
            for part in parts:
                if cut and width(cut + part, size, weight) > max_width:
                    break
                cut += part
            lines.append(cut)
            word = word[len(cut):]
        line = word
    if line:
        lines.append(line)
    return lines


def fit(text: str, max_width: float, sizes: list[tuple[int, int]], weight: int = 800) -> tuple[int, list[str]]:
    """The first (font size, most lines) in `sizes` the text fits at, and its lines; the last one, ended in …, if
    none fits."""
    for size, most in sizes:
        lines = wrap(text, size, max_width, weight)
        if len(lines) <= most:
            return size, lines
    size, most = sizes[-1]
    lines = wrap(text, size, max_width, weight)
    rest = " ".join(lines[most - 1:])
    return size, lines[:most - 1] + [ellipsize(rest, size, max_width, weight)]


# ---------------------------------------------------------------------------- stored pictures
_TEXT = re.compile(r'<text\b([^>]*)>([^<]*)</text>')
_ATTR = re.compile(r'([\w-]+)="([^"]*)"')
_ROOT_WIDTH = re.compile(r'<svg\b[^>]*?\bwidth="([\d.]+)"')
# The card's background (the whole picture); a room photo's rounded scene frame is not it.
_BACKDROP_CORNERS = re.compile(r'(<rect width="(?:100%|1080)" height="(?:100%|1350)")\s+rx="[\d.]+"')


def fit_text(svg: str) -> str:
    """Lines of a stored picture that run past its edges, made smaller (to 80 %) and then shortened to fit. Pictures
    drawn since lines are measured are unchanged."""
    root = _ROOT_WIDTH.search(svg)
    card = float(root.group(1)) if root else 1080.0
    margin = card * .05

    def one(match: re.Match) -> str:
        attrs, content = match.group(1), match.group(2)
        a = dict(_ATTR.findall(attrs))
        try:
            size = float(a.get("font-size", "16"))
            weight = int(a.get("font-weight", "400").replace("bold", "700").replace("normal", "400"))
            x = card * float(a["x"][:-1]) / 100 if a.get("x", "").endswith("%") else float(a.get("x", "0"))
        except ValueError:
            return match.group(0)
        anchor = a.get("text-anchor", "start")
        if anchor == "middle":
            room = 2 * (min(x, card - x) - margin)
        elif anchor == "end":
            room = x - margin
        else:  # a caption keeps the same margin on the right as on the left
            room = card - x - max(x, margin)
        text = html.unescape(content)
        wide = width(text, size, weight)
        if room <= 0 or wide <= room:
            return match.group(0)
        smaller = max(size * .8, size * room / wide)
        if wide * smaller / size > room:
            content = html.escape(ellipsize(text, smaller, room, weight), quote=False)
        attrs = re.sub(r'font-size="[^"]*"', f'font-size="{smaller:.1f}"', attrs)
        return f"<text{attrs}>{content}</text>"

    return _TEXT.sub(one, svg)


def png(svg: str) -> bytes:
    """A stored picture as an opaque PNG at its own size (1080 x 1350 for a memory card)."""
    return _png(svg)


@lru_cache(maxsize=12)
def _png(svg: str) -> bytes:
    fonts = [FONT_DIR / name for name in FONT_FILES.values()]
    missing = [p.name for p in fonts if not p.is_file()]
    if missing:  # without them every line of text would be left out of the picture
        raise RenderError(f"font files missing: {', '.join(missing)}")
    square = _BACKDROP_CORNERS.sub(r"\1", svg, count=1) if 'width="1080"' in svg[:200] else svg
    try:
        # Old pictures name "sans-serif" or a list ending in it: that is Nunito too.
        return resvg_py.svg_to_bytes(svg_string=fit_text(square), background="#FFFFFF", skip_system_fonts=True,
                                     font_files=[str(p) for p in fonts], font_family=FAMILY,
                                     sans_serif_family=FAMILY)
    except ValueError as exc:
        raise RenderError(str(exc)) from exc
