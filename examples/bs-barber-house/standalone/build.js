'use strict';

// Gera a versão HTML (arquivo único, sem servidor) a partir dos arquivos de public/.
// Uso: node standalone/build.js  →  standalone/bs-barber-house.html

const fs = require('fs');
const path = require('path');
const config = require('../config');

const PUB = path.join(__dirname, '..', 'public');
const OUT = path.join(__dirname, 'bs-barber-house.html');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

/** Substitui um trecho e falha se ele não existir (evita build silenciosamente quebrado). */
function swap(text, from, to, file) {
  if (!text.includes(from)) throw new Error(`build: trecho não encontrado em ${file}: ${from.slice(0, 60)}`);
  return text.split(from).join(to);
}

// Links absolutos do servidor viram rotas por âncora (#/...).
const fixLinks = (s) => s
  .replace(/href="\/agendar/g, 'href="#/agendar')
  .replace(/href="\/admin"/g, 'href="#/admin"')
  .replace(/href="\/"/g, 'href="#/"');

function bodyOf(file) {
  const html = read(file);
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  return fixLinks(body.replace(/<script[\s\S]*?<\/script>\s*/g, ''));
}

let admin = bodyOf('admin.html');
admin = swap(admin,
  'Defina a variável <code>ADMIN_PASSWORD</code> no servidor para trocar.',
  'Para trocar, edite <code>ADMIN_PASSWORD</code> no início do código deste arquivo.', 'admin.html');
admin = swap(admin, '<div class="alert" id="defaultPwAlert" hidden>',
  `<div class="alert">ℹ️ <strong>Versão HTML:</strong> os dados ficam salvos neste navegador. Agendamentos feitos pelos clientes
        chegam para você pelo WhatsApp — cadastre-os aqui em <strong>+ Novo agendamento</strong> para acompanhar ganhos e agenda.</div>
      <div class="alert" id="defaultPwAlert" hidden>`, 'admin.html');

const js = {
  'common.js': read('js/common.js'),
  'local-api.js': fs.readFileSync(path.join(__dirname, 'local-api.js'), 'utf8')
    .replace('__CONFIG__', JSON.stringify(config, null, 2)),
  'site.js': fixLinks(read('js/site.js')),
  'agendar.js': swap(read('js/agendar.js'), 'new URLSearchParams(location.search)',
    "new URLSearchParams(location.hash.split('?')[1] || '')", 'agendar.js'),
  'admin-core.js': [
    ["switchTab((location.hash || '#painel').slice(1));", "switchTab('painel');"],
    ["    history.replaceState(null, '', `#${tab}`);\n", ''],
    ['ou agendar em ${location.origin}/agendar`', '.${BS.bookingLine()}`'],
  ].reduce((s, [a, b]) => swap(s, a, b, 'admin-core.js'), read('js/admin-core.js')),
  'admin-dashboard.js': read('js/admin-dashboard.js'),
  'admin-agenda.js': read('js/admin-agenda.js'),
  'admin-extra.js': swap(read('js/admin-extra.js'), 'Agende em ${location.origin}/agendar`',
    'É só responder esta mensagem.${BS.bookingLine()}`', 'admin-extra.js'),
};

// Mostra uma "página" por vez conforme a âncora: #/ (site), #/agendar, #/admin.
const router = `
(() => {
  const views = { site: 'BS Barber House | Barbearia em Castro-PR', agendar: 'Agendar horário | BS Barber House', admin: 'Painel do barbeiro | BS Barber House' };
  const h = location.hash;
  const view = h.startsWith('#/agendar') ? 'agendar' : h.startsWith('#/admin') ? 'admin' : 'site';
  for (const name of Object.keys(views)) document.getElementById('view-' + name).hidden = name !== view;
  document.title = views[view];
  // Trocar de página recarrega, para cada tela começar do zero.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a || a.target === '_blank') return;
    e.preventDefault();
    location.hash = a.getAttribute('href');
    location.reload();
  });
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/')) location.reload(); });
})();`;

const css = ['css/style.css', 'css/agendar.css', 'css/admin.css'].map(read).join('\n');
const favicon = `data:image/svg+xml,${encodeURIComponent(read('img/favicon.svg').trim())}`;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BS Barber House | Barbearia em Castro-PR</title>
  <meta name="description" content="BS Barber House — barbearia em Castro-PR. Corte, barba, sobrancelha e tratamentos. Agende seu horário online, sem cadastro.">
  <meta name="theme-color" content="#0d0d0e">
  <link rel="icon" href="${favicon}" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Oswald:wght@500;600;700&display=swap" rel="stylesheet">
  <!-- Gerado por standalone/build.js — edite os arquivos em public/ e rode o build de novo. -->
  <style>
${css}
  </style>
</head>
<body>
<div id="view-site" class="view">
${bodyOf('index.html')}
</div>
<div id="view-agendar" class="view" hidden>
${bodyOf('agendar.html')}
</div>
<div id="view-admin" class="view" hidden>
${admin}
</div>
<script>${router}</script>
${Object.entries(js).map(([name, code]) => `<script>/* ${name} */\n${code}</script>`).join('\n')}
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log(`Gerado ${path.relative(process.cwd(), OUT)} (${(html.length / 1024).toFixed(0)} KB)`);
