#!/usr/bin/env python3
"""Gera o sistema de agendamento de uma barbearia a partir do modelo da skill.

Uso:
    python3 gerar_sistema.py config.json [pasta-de-saída]

A pasta de saída padrão é a pasta do config.json, se ela se chamar barbearia-<slug>
(ex.: barbearia-navalha/config.json); senão, barbearia-<slug>/ na pasta atual.
Funciona em qualquer projeto: o modelo é lido da pasta da skill, não do repositório.
Depois rode `python3 build.py` dentro dela para gerar o arquivo único e o .zip da Netlify.
Requer Pillow (PIL) para preparar a logo, os ícones e as fotos.
"""
import colorsys
import json
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import quote, quote_plus

SKILL = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL / 'template'
DIAS = {'dom': 0, 'seg': 1, 'ter': 2, 'qua': 3, 'qui': 4, 'sex': 5, 'sab': 6}
PROIBIDO = re.compile(r"[<>\"\\`{}]|\$\{")


def falha(msg):
    sys.exit(f'Erro na configuração: {msg}')


# ------------------------------------------------------------------ cores
def hex_rgb(h):
    h = h.strip().lstrip('#')
    if not re.fullmatch(r'[0-9a-fA-F]{6}', h):
        falha(f'cor inválida: #{h} (use o formato #RRGGBB)')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb_hex(rgb):
    return '#' + ''.join(f'{max(0, min(255, round(c))):02x}' for c in rgb)


def ajusta(h, luz=0.0, sat=0.0):
    """Clareia/escurece mantendo o tom (luz e sat em -1..1, somados ao HLS)."""
    r, g, b = (c / 255 for c in hex_rgb(h))
    hh, ll, ss = colorsys.rgb_to_hls(r, g, b)
    ll = max(0.0, min(1.0, ll + luz))
    ss = max(0.0, min(1.0, ss + sat))
    return rgb_hex(tuple(c * 255 for c in colorsys.hls_to_rgb(hh, ll, ss)))


def rgb_txt(h):
    return ', '.join(str(c) for c in hex_rgb(h))


def paleta(cores):
    p = cores['primaria']
    d = cores['destaque']
    out = {
        'COR_PRIMARIA': p,
        'COR_PRIMARIA_CLARA': cores.get('primaria_clara') or ajusta(p, 0.07, 0.1),
        'COR_PRIMARIA_HOVER': cores.get('primaria_hover') or ajusta(p, 0.13, 0.1),
        'COR_PRIMARIA_ESCURA': cores.get('primaria_escura') or ajusta(p, -0.05),
        'COR_PRIMARIA_MAIS_ESCURA': cores.get('primaria_mais_escura') or ajusta(p, -0.10),
        'COR_DESTAQUE': d,
        'COR_DESTAQUE_CLARA': cores.get('destaque_clara') or ajusta(d, 0.13),
        'COR_DESTAQUE_ESCURA': cores.get('destaque_escura') or ajusta(d, -0.24),
        'COR_CREME': cores.get('creme') or '#f3e9d2',
    }
    out['COR_PRIMARIA_RGB'] = rgb_txt(out['COR_PRIMARIA'])
    out['COR_PRIMARIA_ESCURA_RGB'] = rgb_txt(out['COR_PRIMARIA_ESCURA'])
    out['COR_DESTAQUE_RGB'] = rgb_txt(out['COR_DESTAQUE'])
    return out


# ------------------------------------------------------------------ textos
def texto(cfg, chave, obrig=True, padrao=''):
    v = cfg.get(chave, padrao)
    if v is None:
        v = padrao
    v = str(v).strip().replace("'", '’').replace('&', 'e')
    if obrig and not v:
        falha(f'"{chave}" é obrigatório')
    if PROIBIDO.search(v):
        falha(f'"{chave}" tem caracteres não permitidos (< > " \\ ` {{ }}): {v}')
    return v


def sql_txt(v):
    return "'" + str(v).replace("'", "''") + "'"


def whatsapp(raw):
    d = re.sub(r'\D', '', str(raw))
    if d.startswith('55') and len(d) in (12, 13):
        d = d[2:]
    if len(d) not in (10, 11):
        falha(f'WhatsApp inválido: {raw} (use DDD + número, ex.: (42) 99965-3210)')
    vis = f'({d[:2]}) {d[2:7]}-{d[7:]}' if len(d) == 11 else f'({d[:2]}) {d[2:6]}-{d[6:]}'
    return '55' + d, vis


def id_ok(v, oque):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,30}', v or ''):
        falha(f'{oque} "{v}" inválido: use letras minúsculas, números e hífen (ex.: corte-barba)')
    return v


# ------------------------------------------------------------------ imagens
def preparar_imagens(cfg, base, out):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        falha('instale o Pillow (pip install pillow) para preparar as imagens')
    img = out / 'img'
    icons = out / 'site' / 'icons'
    (img / 'barbers').mkdir(parents=True, exist_ok=True)
    icons.mkdir(parents=True, exist_ok=True)

    logo_path = (base / cfg['logo']).resolve()
    if not logo_path.is_file():
        falha(f'logo não encontrada: {logo_path}')
    logo = Image.open(logo_path).convert('RGBA')
    # Fundo da logo: o configurado, ou a cor do canto (se a logo não for transparente).
    fundo = cfg.get('cores', {}).get('fundo_logo')
    if fundo:
        bg = hex_rgb(fundo)
    else:
        px = logo.getpixel((2, 2))
        bg = px[:3] if px[3] > 200 else (11, 10, 9)
    bbox = logo.getbbox() or (0, 0, *logo.size)
    logo = logo.crop(bbox)

    def no_fundo(size, pad):
        canvas = Image.new('RGB', (size, size), bg)
        inner = int(size * (1 - 2 * pad))
        w, h = logo.size
        k = inner / max(w, h)
        res = logo.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
        canvas.paste(res, ((size - res.width) // 2, (size - res.height) // 2), res)
        return canvas

    flat = Image.new('RGB', logo.size, bg)
    flat.paste(logo, (0, 0), logo)
    k = min(1.0, 480 / flat.width)
    flat.resize((round(flat.width * k), round(flat.height * k)), Image.LANCZOS).save(img / 'logo.jpg', quality=84, optimize=True)
    no_fundo(160, 0.04).save(img / 'emblema.jpg', quality=86, optimize=True)
    no_fundo(64, 0.04).save(img / 'favicon.png', optimize=True)
    # Selo redondo (tema claro).
    big = no_fundo(380 * 4, 0.10)
    mask = Image.new('L', big.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big.width - 1, big.height - 1), fill=255)
    badge = Image.new('RGBA', big.size, (0, 0, 0, 0))
    badge.paste(big, (0, 0), mask)
    badge.resize((380, 380), Image.LANCZOS).save(img / 'logo-badge.webp', 'WEBP', quality=82, method=6)
    # Ícones do app: arquivos da pasta site/ e versões leves embutidas no arquivo único.
    no_fundo(192, 0.02).save(icons / 'icon-192.png', optimize=True)
    no_fundo(512, 0.02).save(icons / 'icon-512.png', optimize=True)
    no_fundo(512, 0.12).save(icons / 'icon-maskable-512.png', optimize=True)
    no_fundo(180, 0.04).save(icons / 'apple-touch-icon.png', optimize=True)
    for size, name in [(512, 'app-icon-512.png'), (192, 'app-icon-192.png'), (180, 'app-icon-180.png')]:
        no_fundo(size, 0.02 if size != 180 else 0.04).quantize(colors=128, method=Image.Quantize.MEDIANCUT).save(img / name, optimize=True)

    fotos = {}
    for b in cfg['barbeiros']:
        if not b.get('foto'):
            continue
        p = (base / b['foto']).resolve()
        if not p.is_file():
            falha(f'foto de {b["nome"]} não encontrada: {p}')
        im = Image.open(p).convert('RGB')
        w, h = im.size
        if b.get('recorte'):  # [x1, y1, x2, y2] em frações (0 a 1) da foto
            x1, y1, x2, y2 = b['recorte']
            box = (round(x1 * w), round(y1 * h), round(x2 * w), round(y2 * h))
        else:  # quadrado central, puxado para cima (onde costuma estar o rosto)
            s = min(w, h)
            top = max(0, min(h - s, round(h * 0.42 - s / 2)))
            box = ((w - s) // 2, top, (w - s) // 2 + s, top + s)
        im.crop(box).resize((320, 320), Image.LANCZOS).save(img / 'barbers' / f'{b["id"]}.webp', 'WEBP', quality=82, method=6)
        fotos[b['id']] = f'img/barbers/{b["id"]}.webp'
    return fotos


# ------------------------------------------------------------------ geração
def gerar(cfg_path, out=None):
    cfg_path = Path(cfg_path).resolve()
    cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
    base = cfg_path.parent

    slug = id_ok(cfg.get('slug', ''), 'slug')
    nome = texto(cfg, 'nome')
    nome_completo = texto(cfg, 'nome_completo', False) or nome
    nome_curto = texto(cfg, 'nome_curto', False) or nome.replace('Barbearia ', '')
    slogan = texto(cfg, 'slogan', False)
    emoji = texto(cfg, 'emoji', False) or '✂️'
    fonte = texto(cfg, 'fonte_titulo', False) or 'Oswald'
    dono = cfg.get('dono') or {}
    dono_nome = texto(dono, 'nome')
    fem = bool(dono.get('feminino'))
    end = cfg.get('endereco') or {}
    rua, bairro = texto(end, 'rua'), texto(end, 'bairro', False)
    cidade, uf, cep = texto(end, 'cidade'), texto(end, 'uf').upper(), texto(end, 'cep', False)
    wa_num, wa_vis = whatsapp(cfg.get('whatsapp', ''))
    insta = texto(cfg, 'instagram', False).lstrip('@')
    sb = cfg.get('supabase') or {}
    sb_url = texto(sb, 'url', False).rstrip('/')
    sb_key = texto(sb, 'chave_publica', False)
    sb_fn = texto(sb, 'funcao', False) or 'sistema'
    mensal = float(cfg.get('mensalidade', 69.90))
    intervalo = cfg.get('intervalo', 30)
    if not isinstance(intervalo, int) or not 10 <= intervalo <= 120:
        falha(f'intervalo inválido: {intervalo} (minutos entre os horários, ex.: 30 ou 40)')
    fuso = texto(cfg, 'fuso', False) or 'America/Sao_Paulo'
    if not re.fullmatch(r'America/[A-Za-z_]+', fuso):
        falha(f'fuso inválido: {fuso} (ex.: America/Sao_Paulo, America/Cuiaba, America/Manaus)')
    cores = cfg.get('cores') or {}
    for c in ('primaria', 'destaque'):
        if not cores.get(c):
            falha(f'cores.{c} é obrigatória')

    barbeiros = cfg.get('barbeiros') or []
    if not barbeiros:
        falha('cadastre pelo menos um barbeiro')
    donos = [b for b in barbeiros if b.get('dono')]
    if len(donos) != 1:
        falha('marque exatamente um barbeiro como "dono": true (ele vê e gerencia tudo)')
    ids, senhas = set(), set()
    for b in barbeiros:
        id_ok(b.get('id'), 'id do barbeiro')
        if b['id'] in ids:
            falha(f'id repetido: {b["id"]}')
        ids.add(b['id'])
        for k in ('nome', 'cargo', 'bio'):
            b[k] = texto(b, k, k != 'bio')
        senha = str(b.get('senha') or f'{b["id"]}{str(cfg.get("ano_senha", 26))}')
        if len(senha) < 5 or senha in senhas:
            falha(f'senha de {b["nome"]} precisa ter 5+ caracteres e ser diferente das outras')
        if len(senha) < 6:
            print(f'aviso: a senha inicial de {b["nome"]} tem menos de 6 caracteres; peça para trocar em 👤 Conta.')
        senhas.add(senha)
        b['senha'] = senha

    servicos = cfg.get('servicos') or []
    if not servicos:
        falha('cadastre pelo menos um serviço')
    sids = set()
    for s in servicos:
        id_ok(s.get('id'), 'id do serviço')
        if s['id'] in sids:
            falha(f'serviço repetido: {s["id"]}')
        sids.add(s['id'])
        for k in ('categoria', 'nome'):
            s[k] = texto(s, k)
        s['descricao'] = texto(s, 'descricao', False)
        s['tag'] = texto(s, 'tag', False)
        if not 5 <= int(s['duracao']) <= 600:
            falha(f'duração de {s["nome"]} deve ser entre 5 e 600 minutos')
        if float(s.get('preco', 0)) < 0:
            falha(f'preço de {s["nome"]} inválido')

    horarios = cfg.get('horarios') or {}
    linhas_h = []
    for dia, wd in DIAS.items():
        h = horarios.get(dia)
        if not h:
            continue
        # ["abre", "fecha"] ou ["abre", "início do almoço", "volta do almoço", "fecha"]
        if (not isinstance(h, list) or len(h) not in (2, 4)
                or not all(isinstance(x, str) and re.fullmatch(r'\d{2}:\d{2}', x) for x in h)
                or any(h[i + 1] <= h[i] for i in range(len(h) - 1))):
            falha(f'horário de {dia} inválido: {h} (use ["09:00", "20:00"] ou, com almoço, ["09:00", "12:00", "13:00", "20:00"])')
        a, f = h[0], h[-1]
        pausa = (h[1], h[2]) if len(h) == 4 else None
        linhas_h.append((wd, a, f, pausa))
    if not linhas_h:
        falha('informe o horário de funcionamento de pelo menos um dia')
    linhas_h.sort(key=lambda x: (x[0] == 0, x[0]))

    if out:
        out = Path(out).resolve()
    elif base.name == f'barbearia-{slug}':
        out = base
    else:
        out = Path.cwd() / f'barbearia-{slug}'
    if out != base and out.exists() and any(out.iterdir()) and not (out / 'agendamento.html').exists():
        falha(f'a pasta {out} já existe e não parece um sistema gerado; escolha outra')
    out.mkdir(parents=True, exist_ok=True)

    if cfg.get('logo'):
        fotos = preparar_imagens(cfg, base, out)
    else:  # sem logo na configuração: usa as imagens que já estão na pasta de saída
        print('aviso: sem "logo" na configuração; usando as imagens que já estão em img/.')
        fotos = {b['id']: f'img/barbers/{b["id"]}.webp' for b in barbeiros if (out / 'img' / 'barbers' / f'{b["id"]}.webp').is_file()}

    end_rua_js = f'{rua} – {bairro}' if bairro else rua
    end_cid_js = f'{cidade} – {uf}' + (f', {cep}' if cep else '')
    maps = quote_plus(', '.join(x for x in [rua, bairro, f'{cidade} - {uf}', cep] if x), safe=',')
    desc = f'{nome_completo} — barbearia em {cidade}-{uf}'
    desc += f', {slogan[0].lower() + slogan[1:]}.' if slogan else '.'
    desc += ' Escolha seu barbeiro e agende online, sem cadastro.'
    fotos_js = '{}' if not fotos else '{\n' + ''.join(f'    {k}: "{v}",\n' for k, v in fotos.items()) + '  }'

    campos = {
        'SLUG': slug, 'NOME': nome, 'NOME_COMPLETO': nome_completo, 'NOME_CURTO': nome_curto,
        'NOME_URL': quote(nome), 'SLOGAN': slogan or 'Agende seu horário', 'META_DESCRICAO': desc, 'EMOJI': emoji,
        'PELO_DONO': f'{"pela" if fem else "pelo"} {dono_nome}', 'AO_DONO': f'{"à" if fem else "ao"} {dono_nome}',
        'DONO_NOME': dono_nome,
        'MAPS_DESTINO': maps, 'ENDERECO_COMPLETO': f'{end_rua_js}, {cidade} – {uf}',
        'ENDERECO_RUA_JS': end_rua_js, 'ENDERECO_CIDADE_JS': end_cid_js, 'CIDADE': cidade, 'UF': uf,
        'WHATS_NUMERO': wa_num, 'WHATS_EXIBICAO': wa_vis, 'INSTAGRAM': insta,
        'SUPABASE_URL': sb_url, 'SUPABASE_CHAVE': sb_key, 'SUPABASE_FUNCAO': sb_fn,
        'MENSALIDADE': f'{mensal:.2f}',
        'INTERVALO': str(intervalo),
        'FUSO': fuso,
        'FONTE_TITULO': fonte, 'FONTE_TITULO_URL': fonte.replace(' ', '+'),
        'FOTOS_BARBEIROS': fotos_js,
        **paleta(cores),
    }

    # SQL do cadastro inicial.
    def vals(rows):
        return ',\n'.join(rows)
    sql_barb = ('insert into public.barbers (id, name, role, owner, bio, sort) values\n'
                + vals(f'  ({sql_txt(b["id"])}, {sql_txt(b["nome"])}, {sql_txt(b["cargo"])}, {"true" if b.get("dono") else "false"}, {sql_txt(b["bio"])}, {i})'
                       for i, b in enumerate(barbeiros, 1))
                + '\non conflict (id) do update set name = excluded.name, role = excluded.role, owner = excluded.owner,\n'
                  '  bio = excluded.bio, sort = excluded.sort, active = true;\n'
                  '-- Quem saiu da lista deixa de aparecer para os clientes (o histórico fica).\n'
                  f'update public.barbers set active = false where id not in ({", ".join(sql_txt(b["id"]) for b in barbeiros)});')
    sql_serv = ('insert into public.services (id, cat, name, price, duration, description, tag, sort) values\n'
                + vals(f'  ({sql_txt(s["id"])}, {sql_txt(s["categoria"])}, {sql_txt(s["nome"])}, {float(s.get("preco", 0)):g}, {int(s["duracao"])}, '
                       f'{sql_txt(s["descricao"])}, {sql_txt(s["tag"]) if s["tag"] else "null"}, {i})'
                       for i, s in enumerate(servicos, 1))
                + '\non conflict (id) do update set cat = excluded.cat, name = excluded.name, price = excluded.price,\n'
                  '  duration = excluded.duration, description = excluded.description, tag = excluded.tag, sort = excluded.sort,\n'
                  '  active = true;\n'
                  f'-- Serviços que saíram da lista: deixam de aparecer para os clientes.\n'
                  f'update public.services set active = false where id not in ({", ".join(sql_txt(s["id"]) for s in servicos)});')
    sql_hor = ('-- Dia que não está na lista = fechado.\n'
               f'delete from public.business_hours where weekday not in ({", ".join(str(w) for w, *_ in linhas_h)});\n'
               'insert into public.business_hours (weekday, open_time, close_time, break_start, break_end) values\n'
               + vals(f"  ({w}, '{a}', '{f}', " + (f"'{pz[0]}', '{pz[1]}')" if pz else 'null, null)') for w, a, f, pz in linhas_h)
               + '\non conflict (weekday) do update set open_time = excluded.open_time, close_time = excluded.close_time,\n'
               + '  break_start = excluded.break_start, break_end = excluded.break_end;')
    sql_eq = ('insert into public.staff_access (id, role, barber_id, pass_hash) values\n'
              + vals(f"  ({sql_txt(b['id'])}, '{'admin' if b.get('dono') else 'barber'}', {sql_txt(b['id'])}, extensions.crypt({sql_txt(b['senha'])}, extensions.gen_salt('bf')))"
                     for b in barbeiros)
              + '\non conflict (id) do nothing;')
    primeiro = lambda n: n.split()[0]  # noqa: E731
    senhas_txt = ' · '.join(f'{primeiro(b["nome"])}{" (dono)" if b.get("dono") else ""}: {b["senha"]}' for b in barbeiros)
    outro = next((b['id'] for b in barbeiros if not b.get('dono')), barbeiros[0]['id'])
    campos_sql = {**campos, 'SQL_BARBEIROS': sql_barb, 'SQL_SERVICOS': sql_serv, 'SQL_HORARIOS': sql_hor, 'SQL_EQUIPE': sql_eq,
                  'SENHAS_COMENTARIO': senhas_txt, 'ID_EXEMPLO': outro, 'IDS_EQUIPE': ', '.join(b['id'] for b in barbeiros)}

    def preenche(src, dst, valores):
        txt = (TEMPLATE / src).read_text(encoding='utf-8')
        txt = re.sub(r'\{\{([A-Z_]+)\}\}', lambda m: str(valores[m.group(1)]) if m.group(1) in valores else m.group(0), txt)
        sobra = re.findall(r'\{\{[A-Z_]+\}\}', txt)
        if sobra:
            sys.exit(f'modelo {src}: campos sem valor {sorted(set(sobra))}')
        (out / dst).parent.mkdir(parents=True, exist_ok=True)
        (out / dst).write_text(txt, encoding='utf-8')

    preenche('agendamento.html', 'agendamento.html', campos)
    preenche('build.py', 'build.py', campos)
    preenche('gitignore.txt', '.gitignore', campos)
    preenche('site/manifest.webmanifest', 'site/manifest.webmanifest', campos)
    preenche('site/sw.js', 'site/sw.js', campos)
    preenche('site/_headers', 'site/_headers', campos)
    preenche('supabase/schema.sql', 'supabase/schema.sql', campos_sql)
    preenche('supabase/functions/sistema/index.ts', 'supabase/functions/sistema/index.ts', campos)
    shutil.copy(cfg_path, out / 'config.json') if cfg_path.parent != out else None

    print(f'Sistema da {nome} gerado em {out}')
    print('Próximo passo: python3 build.py (dentro da pasta) para gerar o arquivo único e o .zip da Netlify.')
    if not sb_url or not sb_key:
        print('aviso: faltam supabase.url e supabase.chave_publica; o agendamento só funciona depois de preencher e gerar de novo.')
    return out


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    gerar(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
