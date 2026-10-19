#!/usr/bin/env python3
"""Gera os arquivos únicos (imagens de img/ embutidas):

- index.html       -> barbearia-machado.html   (site completo)
- agendamento.html -> agendamento-machado.html (só agendamento)

Uso: python3 build.py
"""
import base64
import mimetypes
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGES = {"index.html": "barbearia-machado.html", "agendamento.html": "agendamento-machado.html"}
REF = re.compile(r"""(?P<q>["'(])(?P<path>img/[\w./-]+\.(?:jpe?g|png|webp|svg))""")
SOURCE_NOTE = re.compile(r"<!-- (?:Fonte do site|Página só de agendamento)\. Rode `python3 build\.py`[^>]*-->")


def inline(match: re.Match) -> str:
    path = ROOT / match.group("path")
    if not path.is_file():
        return match.group(0)
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"{match.group('q')}data:{mime};base64,{data}"


for src, out in PAGES.items():
    html = (ROOT / src).read_text(encoding="utf-8")
    html = SOURCE_NOTE.sub(f"<!-- Gerado por build.py — edite {src} e rode o build de novo. -->", html)
    target = ROOT / out
    target.write_text(REF.sub(inline, html), encoding="utf-8")
    print(f"{out}: {target.stat().st_size / 1024:.0f} KB")
