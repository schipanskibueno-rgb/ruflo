'use strict';

// Builds the site for static hosting (Netlify): every page becomes ONE self-contained HTML
// file (CSS, JS and libraries inlined) plus a _redirects file that forwards /api, /media and
// /v to the real Meu Bairro Seguro server. Output: dist-netlify/ and a zip to drag into Netlify.
//
//   node tools/build-netlify.js https://camera.seudominio.com.br
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist-netlify');
const ZIP = path.join(ROOT, 'meu-bairro-seguro-netlify.zip');
const PLACEHOLDER = 'https://SEU-SERVIDOR.exemplo.com.br';

const VENDOR = {
  'hls.min.js': require.resolve('hls.js/dist/hls.min.js', { paths: [ROOT] }),
  'leaflet.js': require.resolve('leaflet/dist/leaflet.js', { paths: [ROOT] }),
  'leaflet.css': require.resolve('leaflet/dist/leaflet.css', { paths: [ROOT] }),
  'jsQR.js': require.resolve('jsqr/dist/jsQR.js', { paths: [ROOT] }),
};

function asset(href) {
  if (href.startsWith('/vendor/')) return fs.readFileSync(VENDOR[href.slice(8)], 'utf8');
  return fs.readFileSync(path.join(PUBLIC, href.replace(/^\//, '')), 'utf8');
}

// Inline code must not close its own tag early.
const safe = (code, tag) => code.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

function inlinePage(file) {
  let html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${safe(asset(href), 'style')}\n</style>`);
  const deferred = [];
  html = html.replace(/<script src="([^"]+)"( defer)?><\/script>\n?/g, (_, src, defer) => {
    const code = `<script>\n${safe(asset(src), 'script')}\n</script>`;
    if (defer) {
      deferred.push(code);
      return '';
    }
    return code + '\n';
  });
  // Deferred scripts ran after parsing, in order: put them at the end of <body>, same order.
  // Function replacement: a string would turn "$$" in the inlined code into "$".
  return html.replace('</body>', () => `${deferred.join('\n')}\n</body>`);
}

// Minimal zip writer (deflate), so the build needs no extra packages.
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name);
    const deflated = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, deflated);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function main() {
  const backend = (process.argv[2] || process.env.BACKEND_URL || PLACEHOLDER).replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/.test(backend)) {
    console.error(`Endereço do servidor inválido: ${backend} (use só https://dominio[:porta], sem caminho)`);
    process.exit(1);
  }
  const redirects = [
    '# Encaminha as chamadas para o servidor do Meu Bairro Seguro (é ele que conecta as câmeras).',
    '# Troque o endereço abaixo pelo do seu servidor, se precisar.',
    `/api/*    ${backend}/api/:splat    200`,
    `/media/*  ${backend}/media/:splat  200`,
    `/v/*      ${backend}/v/:splat      200`,
    '/s/*      /share.html             200',
    '',
  ].join('\n');
  const files = [
    ['index.html', Buffer.from(inlinePage('index.html'))],
    ['share.html', Buffer.from(inlinePage('share.html'))],
    ['_redirects', Buffer.from(redirects)],
  ];
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, data] of files) fs.writeFileSync(path.join(OUT, name), data);
  fs.writeFileSync(ZIP, zip(files));
  console.log(`Servidor: ${backend}${backend === PLACEHOLDER ? '  (ainda é o exemplo — troque no _redirects)' : ''}`);
  for (const [name, data] of files) console.log(`  dist-netlify/${name}  ${(data.length / 1024).toFixed(0)} KB`);
  console.log(`  ${path.basename(ZIP)} — arraste este arquivo em https://app.netlify.com/drop`);
}

main();
