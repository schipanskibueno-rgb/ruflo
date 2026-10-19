#!/usr/bin/env python3
"""Gera barbearia-machado.html: o index.html com as imagens de img/ embutidas (arquivo único).

Uso: python3 build.py
"""
import base64
import mimetypes
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "index.html"
OUT = ROOT / "barbearia-machado.html"
REF = re.compile(r"""(?P<q>["'(])(?P<path>img/[\w./-]+\.(?:jpe?g|png|webp|svg))""")


def inline(match: re.Match) -> str:
    path = ROOT / match.group("path")
    if not path.is_file():
        return match.group(0)
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"{match.group('q')}data:{mime};base64,{data}"


html = SRC.read_text(encoding="utf-8")
html = html.replace(
    "<!-- Fonte do site. Rode `python3 build.py` para gerar barbearia-machado.html (arquivo único, com as imagens embutidas). -->",
    "<!-- Gerado por build.py — edite index.html e rode o build de novo. -->",
)
OUT.write_text(REF.sub(inline, html), encoding="utf-8")
print(f"{OUT.name}: {OUT.stat().st_size / 1024:.0f} KB")
