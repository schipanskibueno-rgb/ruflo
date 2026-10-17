'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const store = require('./lib/store');
const sch = require('./lib/schedule');
const auth = require('./lib/auth');
const domain = require('./lib/domain');

const { HttpError } = domain;
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const PAGES = { '/': 'index.html', '/agendar': 'agendar.html', '/admin': 'admin.html' };

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  'frame-src https://www.google.com https://maps.google.com',
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// ------------------------------------------------------------------ helpers

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function readJson(req, limit = 20 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    return Promise.reject(new HttpError(415, 'Envie os dados em JSON.'));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Dados muito grandes.'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
        resolve(data);
      } catch {
        reject(new HttpError(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

// Limite simples por IP para evitar spam de agendamentos.
const bookingHits = new Map();
function checkBookingRate(ip) {
  const now = Date.now();
  const hits = (bookingHits.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (hits.length >= 6) throw new HttpError(429, 'Muitos agendamentos seguidos. Fale conosco pelo WhatsApp.');
  hits.push(now);
  bookingHits.set(ip, hits);
}

function publicConfig() {
  const { name, phone, phoneDisplay, address, city, timezone, hours, slotStep, bookingWindowDays, services } = config;
  return { name, phone, phoneDisplay, address, city, timezone, hours, slotStep, bookingWindowDays, services, today: sch.nowLocal().date };
}

const publicBooking = (b) => ({
  code: b.code, serviceId: b.serviceId, serviceName: b.serviceName, price: b.price,
  duration: b.duration, date: b.date, time: b.time, name: b.name, phone: b.phone, status: b.status,
});

const galleryItem = (p) => ({ id: p.id, url: `/uploads/${p.file}`, caption: p.caption });

// ---------------------------------------------------------------------- API

async function handleApi(req, res, url) {
  const { pathname: p, searchParams: q } = url;
  const m = req.method;

  if (m === 'GET' && p === '/api/config') return sendJson(res, 200, publicConfig());

  if (m === 'GET' && p === '/api/availability') {
    const date = domain.requireDate(q.get('date'));
    const service = domain.requireService(q.get('service'));
    const admin = auth.isAuthed(req);
    const slots = sch.freeSlots(store.db, date, service.duration, {
      excludeId: admin ? q.get('exclude') || undefined : undefined,
    });
    return sendJson(res, 200, { date, open: sch.isOpenDay(date), slots });
  }

  if (m === 'POST' && p === '/api/bookings') {
    const body = await readJson(req);
    checkBookingRate(clientIp(req));
    const booking = domain.createBooking(body);
    return sendJson(res, 201, publicBooking(booking));
  }

  if (m === 'GET' && p === '/api/gallery') return sendJson(res, 200, store.db.gallery.map(galleryItem));

  if (m === 'POST' && p === '/api/admin/login') {
    const body = await readJson(req);
    const result = auth.login(body.password, clientIp(req));
    if (result.error) return sendJson(res, result.status, { error: result.error });
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(req, result.token) });
  }

  if (m === 'POST' && p === '/api/admin/logout') {
    auth.logout(req);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(req, null) });
  }

  if (m === 'GET' && p === '/api/admin/me') {
    return sendJson(res, 200, { authed: auth.isAuthed(req), defaultPassword: auth.usingDefaultPassword });
  }

  if (p.startsWith('/api/admin/')) {
    if (!auth.isAuthed(req)) throw new HttpError(401, 'Faça login para continuar.');
    return handleAdmin(req, res, p, q);
  }

  throw new HttpError(404, 'Rota não encontrada.');
}

async function handleAdmin(req, res, p, q) {
  const m = req.method;
  const idMatch = (prefix) => (p.startsWith(prefix) ? decodeURIComponent(p.slice(prefix.length)) : null);

  if (m === 'GET' && p === '/api/admin/bookings') {
    const from = q.get('from') ? domain.requireDate(q.get('from')) : undefined;
    const to = q.get('to') ? domain.requireDate(q.get('to')) : undefined;
    return sendJson(res, 200, domain.listBookings({ from, to }));
  }
  if (m === 'POST' && p === '/api/admin/bookings') {
    return sendJson(res, 201, domain.createBooking(await readJson(req), { admin: true }));
  }
  const bookingId = idMatch('/api/admin/bookings/');
  if (m === 'PATCH' && bookingId) {
    return sendJson(res, 200, domain.updateBooking(bookingId, await readJson(req)));
  }

  if (m === 'GET' && p === '/api/admin/blocks') {
    const from = sch.nowLocal().date;
    const blocks = store.db.blocks.filter((b) => b.date >= from)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    return sendJson(res, 200, blocks);
  }
  if (m === 'POST' && p === '/api/admin/blocks') {
    return sendJson(res, 201, domain.createBlock(await readJson(req)));
  }
  const blockId = idMatch('/api/admin/blocks/');
  if (m === 'DELETE' && blockId) {
    domain.deleteBlock(blockId);
    return sendJson(res, 200, { ok: true });
  }

  if (m === 'POST' && p === '/api/admin/gallery') {
    const photo = domain.addPhoto(await readJson(req, 6 * 1024 * 1024));
    return sendJson(res, 201, galleryItem(photo));
  }
  const photoId = idMatch('/api/admin/gallery/');
  if (m === 'DELETE' && photoId) {
    domain.deletePhoto(photoId);
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Rota não encontrada.');
}

// ------------------------------------------------------------------- static

function serveFile(res, file, cache) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': MIME['.html'] });
      return res.end('<h1>Página não encontrada</h1><p><a href="/">Voltar ao início</a></p>');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': cache,
    });
    fs.createReadStream(file).pipe(res);
  });
}

function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Endereço inválido.');
  }
  if (decoded.startsWith('/uploads/')) {
    const file = path.join(store.UPLOAD_DIR, path.basename(decoded));
    return serveFile(res, file, 'public, max-age=86400');
  }
  const rel = PAGES[decoded.replace(/\/+$/, '') || '/'] || decoded;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Acesso negado.');
  const cache = file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600';
  return serveFile(res, file, cache);
}

// ------------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido.');
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    if (res.headersSent) return res.end();
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    return sendJson(res, 500, { error: 'Erro interno. Tente novamente em instantes.' });
  }
});

server.listen(PORT, () => {
  console.log(`${config.name} rodando em http://localhost:${PORT}`);
  console.log(`Painel do barbeiro: http://localhost:${PORT}/admin`);
  if (auth.usingDefaultPassword) {
    console.warn(`ATENÇÃO: usando a senha padrão "${auth.DEFAULT_PASSWORD}". Defina ADMIN_PASSWORD antes de publicar.`);
  }
});
