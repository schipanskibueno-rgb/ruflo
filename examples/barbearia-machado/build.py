#!/usr/bin/env python3
"""Gera os arquivos únicos (imagens de img/ embutidas):

- index.html       -> barbearia-machado.html   (site completo)
- agendamento.html -> agendamento-machado.html (só agendamento)
- agendamento.html -> site/index.html          (app publicado na Netlify, com manifest e sw.js)
- site/            -> barbearia-machado-site.zip (para arrastar na Netlify)

Uso: python3 build.py
"""
import base64
import mimetypes
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGES = {
    "barbearia-machado.html": "index.html",
    "agendamento-machado.html": "agendamento.html",
    "site/index.html": "agendamento.html",
}
REF = re.compile(r"""(?P<q>["'(])(?P<path>img/[\w./-]+\.(?:jpe?g|png|webp|svg))""")
# Arquivo único (sem a pasta site/): manifesto montado na própria página, com a logo embutida,
# para o app instalado mostrar a logo em vez de uma letra.
INLINE_MANIFEST = """<link rel="manifest" href="manifest.webmanifest">
  <script>
    (() => {
      const base = location.href.split('#')[0];
      const manifest = {
        name: 'Barbearia Machado', short_name: 'Machado', lang: 'pt-BR', display: 'standalone',
        start_url: base, scope: base.replace(/[^/]*$/, ''), background_color: '#0b0a09', theme_color: '#0b0a09',
        icons: [
          { src: "img/app-icon-192.png", sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: "img/app-icon-512.png", sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      };
      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
      document.querySelector('link[rel="manifest"]').href = URL.createObjectURL(blob);
    })();
  </script>"""
SINGLE_FILE = {"agendamento-machado.html"}
SOURCE_NOTE = re.compile(r"<!-- (?:Fonte do site|Página só de agendamento[^.]*)\. Rode `python3 build\.py`[^>]*-->")


def inline(match: re.Match) -> str:
    path = ROOT / match.group("path")
    if not path.is_file():
        return match.group(0)
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"{match.group('q')}data:{mime};base64,{data}"


for out, src in PAGES.items():
    html = (ROOT / src).read_text(encoding="utf-8")
    html = SOURCE_NOTE.sub(f"<!-- Gerado por build.py — edite {src} e rode o build de novo. -->", html)
    if out in SINGLE_FILE:
        html = html.replace('<link rel="manifest" href="manifest.webmanifest">', INLINE_MANIFEST, 1)
        html = html.replace('href="icons/apple-touch-icon.png"', 'href="img/app-icon-180.png"', 1)
    target = ROOT / out
    target.write_text(REF.sub(inline, html), encoding="utf-8")
    print(f"{out}: {target.stat().st_size / 1024:.0f} KB")

# Pasta pronta para arrastar na Netlify (Sites → arrastar e soltar).
with zipfile.ZipFile(ROOT / "barbearia-machado-site.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted((ROOT / "site").rglob("*")):
        if f.is_file():
            z.write(f, f.relative_to(ROOT / "site"))
print(f"barbearia-machado-site.zip: {(ROOT / 'barbearia-machado-site.zip').stat().st_size / 1024:.0f} KB")
