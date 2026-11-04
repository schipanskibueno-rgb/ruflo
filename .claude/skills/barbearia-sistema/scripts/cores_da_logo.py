#!/usr/bin/env python3
"""Sugere as cores da marca a partir da logo (as mais presentes, sem preto, branco e cinza).

Uso: python3 cores_da_logo.py caminho/da/logo.png
Mostre as sugestões ao cliente e confirme a "primaria" (botões, destaques) e o "destaque" (detalhes).
"""
import colorsys
import sys

from PIL import Image

if len(sys.argv) < 2:
    sys.exit(__doc__)
im = Image.open(sys.argv[1]).convert('RGBA')
im.thumbnail((300, 300))
raw = im.tobytes()
pixels = [tuple(raw[i:i + 3]) for i in range(0, len(raw), 4) if raw[i + 3] > 200]
amostra = Image.new('RGB', (len(pixels), 1))
amostra.putdata(pixels)
pal = amostra.quantize(colors=16, method=Image.Quantize.MEDIANCUT)
cores = sorted(pal.getcolors(), reverse=True)
paleta = pal.getpalette()
saida = []
for qtd, idx in cores:
    r, g, b = paleta[idx * 3: idx * 3 + 3]
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    if l < 0.12 or l > 0.92 or s < 0.3:  # preto, branco ou cinza
        continue
    saida.append((qtd, f'#{r:02x}{g:02x}{b:02x}', round(s, 2), round(l, 2), h))
total = sum(q for q, *_ in saida) or 1
print('Cores da logo (mais presentes primeiro):')
for qtd, hx, s, l, _ in saida[:6]:
    print(f'  {hx}  {100 * qtd / total:4.0f}%  saturação {s}  luz {l}')
if saida:
    prim = saida[0]
    # destaque: a cor seguinte com tom diferente da principal (20°+ no círculo de cores)
    dist = lambda a, b: min(abs(a - b), 1 - abs(a - b))  # noqa: E731
    dest = next((c for c in saida[1:] if dist(c[4], prim[4]) > 20 / 360), prim)
    print(f'Sugestão: "primaria": "{prim[1]}", "destaque": "{dest[1]}"')
