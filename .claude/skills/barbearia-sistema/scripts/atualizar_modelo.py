#!/usr/bin/env python3
"""Manutenção: atualiza o modelo (template/) a partir do sistema de referência da Barbearia Machado.

Use quando o sistema da Machado (examples/barbearia-machado) ganhar melhorias que devem valer
para todas as barbearias. O script troca os dados da Machado por {{CAMPOS}} e para com erro se
algum trecho esperado mudou, para você ajustar a lista de trocas abaixo antes de seguir.

Uso: python3 atualizar_modelo.py [pasta-da-machado]
    (padrão: examples/barbearia-machado do repositório ruflo, ou ./examples/barbearia-machado)
Depois confira: python3 gerar_sistema.py ../exemplos/machado.json /tmp/x  e compare com a Machado.
"""
import re, sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
if len(sys.argv) > 1:
    SRC = Path(sys.argv[1]).resolve()
else:
    SRC = next((p for p in (SKILL.parent.parent.parent / 'examples' / 'barbearia-machado',
                            Path.cwd() / 'examples' / 'barbearia-machado')
                if (p / 'agendamento.html').is_file()), None)
    if SRC is None:
        sys.exit('informe a pasta do sistema da Machado: python3 atualizar_modelo.py <pasta>')
DST = SKILL / 'template'

def sub(text, pairs, label):
    for old, new, count in pairs:
        n = text.count(old)
        if count is not None and n != count:
            sys.exit(f'{label}: esperava {count}x {old!r}, achei {n}')
        if n == 0:
            sys.exit(f'{label}: não achei {old!r}')
        text = text.replace(old, new)
    return text

# ------------------------------------------------------------------ agendamento.html
html = (SRC / 'agendamento.html').read_text(encoding='utf-8')
fotos = re.search(r"  const BARBER_PHOTOS = \{\n(?:    [a-z0-9_]+: \"img/barbers/[a-z0-9_]+\.webp\",\n)+  \};", html)
assert fotos, 'BARBER_PHOTOS'
html = html.replace(fotos.group(0), '  const BARBER_PHOTOS = {{FOTOS_BARBEIROS}};')
html = sub(html, [
    # crédito do desenvolvedor: protege antes de trocar o nome da barbearia
    ('Vi%20o%20site%20da%20Barbearia%20Machado%20e%20quero', 'Vi%20o%20site%20da%20{{NOME_URL}}%20e%20quero', 1),
    ('/* Barbearia Machado — paleta da logo: preto, vermelho "Machado", cobre do machado e creme */',
     '/* {{NOME}} — paleta da logo: cor principal (variáveis --red), cor de destaque (--copper) e creme */', 1),
    ('<meta name="description" content="Barbearia Machado Prime — barbearia em Castro-PR, especialista em prótese capilar. Escolha seu barbeiro e agende online, sem cadastro.">',
     '<meta name="description" content="{{META_DESCRICAO}}">', 1),
    ('pela % que o Adão definiu', 'pela % que o dono definiu', 1),
    ('% definido pelo Adão', '% definido {{PELO_DONO}}', 1),
    ('Peça ao Adão uma senha nova', 'Peça {{AO_DONO}} uma senha nova', 1),
    ('para gerar agendamento-machado.html (arquivo único)', 'para gerar {{SLUG}}-agendamento.html (arquivo único)', 1),
    ('(código em supabase/functions/machado/index.ts)', '(código em supabase/functions/sistema/index.ts)', 1),
    ('a.download = `agenda-machado${who}', 'a.download = `agenda-{{SLUG}}${who}', 1),
    ('placeholder="Ex.: Prótese micro pele"', 'placeholder="Ex.: Degradê com barba"', 1),
    ("timezone: 'America/Sao_Paulo',", "timezone: '{{FUSO}}',", 1),
    ('    slotStep: 40,          // igual a c_step', '    slotStep: {{INTERVALO}},          // igual a c_step', 1),
    ('Barbearia Machado Prime', '{{NOME_COMPLETO}}', None),
    ('alt="Barbearia Machado — Especialista em prótese capilar"', 'alt="{{NOME}} — {{SLOGAN}}"', 1),
    ('Barbearia Machado', '{{NOME}}', None),
    ('<meta name="apple-mobile-web-app-title" content="Machado">', '<meta name="apple-mobile-web-app-title" content="{{NOME_CURTO}}">', 1),
    ('<small>Painel</small><b>Machado</b>', '<small>Painel</small><b>{{NOME_CURTO}}</b>', 1),
    ('🪓', '{{EMOJI}}', None),
    ('machado-', '{{SLUG}}-', None),
    # contatos e endereço
    ('https://www.google.com/maps/dir/?api=1&amp;destination=R.+Cel.+Oleg%C3%A1rio+de+Macedo,+134,+%C3%81gua+Suja,+Castro+-+PR,+84165-690',
     'https://www.google.com/maps/dir/?api=1&amp;destination={{MAPS_DESTINO}}', 1),
    ('<dd>R. Cel. Olegário de Macedo, 134 – Água Suja, Castro – PR</dd>', '<dd>{{ENDERECO_COMPLETO}}</dd>', 1),
    ("address: 'R. Cel. Olegário de Macedo, 134 – Água Suja',", "address: '{{ENDERECO_RUA_JS}}',", 1),
    ("city: 'Castro – PR, 84165-690',", "city: '{{ENDERECO_CIDADE_JS}}',", 1),
    ('5542999653210', '{{WHATS_NUMERO}}', None),
    ('(42) 99965-3210', '{{WHATS_EXIBICAO}}', None),
    ('barbearia_machado_27', '{{INSTAGRAM}}', None),
    # Supabase e mensalidade
    ("const SUPABASE_URL = 'https://uvdieiiydisobkzoupoj.supabase.co';", "const SUPABASE_URL = '{{SUPABASE_URL}}';", 1),
    ("const SUPABASE_ANON_KEY = 'sb_publishable_1EY6IdOz6mLqrmvEizcg3w_sC6gLfP_';", "const SUPABASE_ANON_KEY = '{{SUPABASE_CHAVE}}';", 1),
    ("const FUNCTION_NAME = 'quick-task';", "const FUNCTION_NAME = '{{SUPABASE_FUNCAO}}';", 1),
    ('    amount: 69.90,', '    amount: {{MENSALIDADE}},', 1),
    # fontes e cores da marca
    ('family=Inter:wght@400;500;600;700&family=Oswald:wght@500;600;700', 'family=Inter:wght@400;500;600;700&family={{FONTE_TITULO_URL}}:wght@500;600;700', 1),
    ("'Oswald'", "'{{FONTE_TITULO}}'", 1),
    ('#e8302a', '{{COR_PRIMARIA}}', None),
    ('#ff4b3e', '{{COR_PRIMARIA_CLARA}}', None),
    ('#ff6a5c', '{{COR_PRIMARIA_HOVER}}', None),
    ('rgba(232, 48, 42,', 'rgba({{COR_PRIMARIA_RGB}},', None),
    ('#d42a24', '{{COR_PRIMARIA_ESCURA}}', None),
    ('rgba(212, 42, 36,', 'rgba({{COR_PRIMARIA_ESCURA_RGB}},', None),
    ('#c0231d', '{{COR_PRIMARIA_MAIS_ESCURA}}', None),
    ('#c29760', '{{COR_DESTAQUE}}', None),
    ('#e2b98a', '{{COR_DESTAQUE_CLARA}}', None),
    ('rgba(194, 151, 96,', 'rgba({{COR_DESTAQUE_RGB}},', None),
    ('#8a5a25', '{{COR_DESTAQUE_ESCURA}}', None),
    ('#f3e9d2', '{{COR_CREME}}', None),
], 'agendamento.html')
for leftover in ['Machado', 'machado', 'Olegário', 'Água Suja', 'uvdieiiydisobkzoupoj', 'quick-task', 'prótese', 'Adão', 'Castro']:
    for m in re.finditer(leftover, html):
        line = html.count('\n', 0, m.start()) + 1
        print(f'  aviso: sobrou {leftover!r} na linha {line}: {html.splitlines()[line-1].strip()[:110]}')
(DST / 'agendamento.html').write_text(html, encoding='utf-8')

# ------------------------------------------------------------------ schema.sql
sql = (SRC / 'supabase/schema.sql').read_text(encoding='utf-8')
def block(text, start_pat, label, repl):
    m = re.search(start_pat, text, re.S)
    if not m:
        sys.exit(f'schema: não achei {label}')
    return text[:m.start()] + repl + text[m.end():]
sql = block(sql, r"insert into public\.barbers \(id, name, role, owner, bio, sort\) values\n.*?bio = excluded\.bio, sort = excluded\.sort;", 'barbeiros', '{{SQL_BARBEIROS}}')
sql = block(sql, r"insert into public\.services \(id, cat, name, price, duration, description, tag, sort\) values\n.*?tag = excluded\.tag, sort = excluded\.sort;", 'serviços', '{{SQL_SERVICOS}}')
sql = block(sql, r"insert into public\.business_hours \(weekday, open_time, close_time, break_start, break_end\) values\n.*?break_end = excluded\.break_end;", 'horários', '{{SQL_HORARIOS}}')
sql = block(sql, r"insert into public\.staff_access \(id, role, barber_id, pass_hash\) values\n.*?on conflict \(id\) do nothing;", 'equipe', '{{SQL_EQUIPE}}')
sql = block(sql, r"-- Senhas iniciais do painel \(cada pessoa precisa ter uma senha diferente\):\n--   [^\n]*\n", 'comentário senhas',
            '-- Senhas iniciais do painel (cada pessoa precisa ter uma senha diferente):\n--   {{SENHAS_COMENTARIO}}\n')
sql = block(sql, r"--   where id = 'nick';      -- ids: [^\n]*", 'comentário ids', "--   where id = '{{ID_EXEMPLO}}';      -- ids: {{IDS_EQUIPE}}")
sql = sql.replace("'America/Sao_Paulo'", "'{{FUSO}}'")
sql = sub(sql, [
    ('--   • Dono (senha do Adão): vê e gerencia tudo.', '--   • Dono ({{DONO_NOME}}): vê e gerencia tudo.', 1),
    ('ou pede ao Adão uma senha nova', 'ou pede {{AO_DONO}} uma senha nova', 1),
    ('pela função "machado" no primeiro uso', 'pela função do Supabase no primeiro uso', 1),
    ("perform cron.schedule('machado-avisos'", "perform cron.schedule('{{SLUG}}-avisos'", 1),
    ("'https://uvdieiiydisobkzoupoj.supabase.co/functions/v1/quick-task/notify'", "'{{SUPABASE_URL}}/functions/v1/{{SUPABASE_FUNCAO}}/notify'", 1),
    ('  c_step   constant int := 40;', '  c_step   constant int := {{INTERVALO}};', 1),
    ('-- Barbearia Machado — banco de dados do agendamento (Supabase)', '-- {{NOME}} — banco de dados do agendamento (Supabase)', 1),
], 'schema.sql')
for leftover in ['Machado', 'machado', 'Adão', 'adao', 'emanuel', 'uvdieiiydisobkzoupoj', 'quick-task']:
    for m in re.finditer(leftover, sql):
        line = sql.count('\n', 0, m.start()) + 1
        print(f'  aviso schema: sobrou {leftover!r} na linha {line}: {sql.splitlines()[line-1].strip()[:110]}')
(DST / 'supabase/schema.sql').write_text(sql, encoding='utf-8')

# ------------------------------------------------------------------ função, site/
fn = (SRC / 'supabase/functions/machado/index.ts').read_text(encoding='utf-8')
fn = sub(fn, [
    ("const TZ = 'America/Sao_Paulo';", "const TZ = '{{FUSO}}';", 1),
    ('// Publicada como "quick-task": o nome precisa ser o mesmo de FUNCTION_NAME (agendamento.html)', '// Publicada como "{{SUPABASE_FUNCAO}}": o nome precisa ser o mesmo de FUNCTION_NAME (agendamento.html)', 1),
], 'index.ts')
(DST / 'supabase/functions/sistema/index.ts').write_text(fn, encoding='utf-8')
sw = sub((SRC / 'site/sw.js').read_text(encoding='utf-8'), [
    ("/* Service worker da Barbearia Machado:", "/* Service worker da {{NOME}}:", 1),
    ("const CACHE = 'machado-v1';", "const CACHE = '{{SLUG}}-v1';", 1),
    ("data.title || 'Barbearia Machado'", "data.title || '{{NOME}}'", 1),
], 'sw.js')
(DST / 'site/sw.js').write_text(sw, encoding='utf-8')
(DST / 'site/_headers').write_text((SRC / 'site/_headers').read_text(encoding='utf-8'), encoding='utf-8')
man = sub((SRC / 'site/manifest.webmanifest').read_text(encoding='utf-8'), [
    ('"name": "Barbearia Machado"', '"name": "{{NOME}}"', 1),
    ('"short_name": "Machado"', '"short_name": "{{NOME_CURTO}}"', 1),
    ('"description": "Agende seu horário na Barbearia Machado Prime — Castro-PR."', '"description": "Agende seu horário na {{NOME_COMPLETO}} — {{CIDADE}}-{{UF}}."', 1),
], 'manifest')
(DST / 'site/manifest.webmanifest').write_text(man, encoding='utf-8')
print('modelo criado em', DST)
