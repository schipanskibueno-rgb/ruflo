'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const db = require('./lib/db');
const auth = require('./lib/auth');
const api = require('./lib/api');
const streams = require('./lib/streams');
const recordings = require('./lib/recordings');
const { cameraAccess } = require('./lib/access');
const { HttpError, readJson, sendJson, sendText, sendFile, str } = require('./lib/http');

const PUBLIC_DIR = path.join(__dirname, 'public');
const HLS_DIR = path.dirname(require.resolve('hls.js/dist/hls.min.js'));
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// ------------------------------------------------------------------ auth

async function register(req, res) {
  const body = await readJson(req);
  const name = str(body.name, 'nome', { max: 80 });
  const email = str(body.email, 'e-mail', { max: 200 }).toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
  if (password.length < 8) throw new HttpError(400, 'A senha precisa ter pelo menos 8 caracteres.');
  if (db.one('SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'Esse e-mail já tem conta.');
  // The first account is the platform administrator (the monitoring central).
  const isAdmin = db.one('SELECT COUNT(*) AS n FROM users').n === 0 ? 1 : 0;
  const info = db.run(
    'INSERT INTO users (name, email, pass_hash, is_admin, created_at) VALUES (?,?,?,?,?)',
    name, email, auth.hashPassword(password), isAdmin, Date.now(),
  );
  const token = auth.createSession(Number(info.lastInsertRowid));
  sendJson(res, 201, { ok: true }, { 'Set-Cookie': auth.sessionCookie(token) });
}

async function login(req, res) {
  const ip = clientIp(req);
  auth.checkRate(ip);
  const body = await readJson(req);
  const user = db.one('SELECT * FROM users WHERE email = ?', String(body.email || '').trim().toLowerCase());
  if (!user || !auth.verifyPassword(String(body.password || ''), user.pass_hash)) {
    auth.recordFailure(ip);
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(auth.createSession(user.id)) });
}

async function logout(req, res) {
  auth.destroySession(req);
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie('', 0) });
}

// ------------------------------------------------------------------ media (logged in)

function serveLive(res, cameraId, file) {
  if (file !== 'index.m3u8' && !/^seg_\d{5,}\.ts$/.test(file)) throw new HttpError(404, 'Não encontrado.');
  sendFile(res, streams.liveDir(cameraId), file);
}

function serveRecording(res, cameraId, file) {
  if (!recordings.isSegmentName(file)) throw new HttpError(404, 'Não encontrado.');
  sendFile(res, streams.recDir(cameraId), file, 'private, max-age=3600');
}

// ------------------------------------------------------------------ public share links

// Opening a link (with its password, if any) counts one view and returns a viewer key.
// The key, not the link token, authorizes the media requests that follow.
const viewers = new Map(); // key -> { linkId, cameraId, kind, from, to, expires }

function findLink(token) {
  const link = db.one(
    `SELECT l.*, c.name AS camera_name FROM share_links l JOIN cameras c ON c.id = l.camera_id
     WHERE l.token_hash = ?`, auth.sha256(token),
  );
  if (!link || link.expires_at < Date.now()) throw new HttpError(404, 'Link expirado ou inexistente.');
  return link;
}

async function openLink(req, res, token) {
  auth.checkRate(clientIp(req));
  const link = findLink(token);
  const body = await readJson(req);
  if (link.pass_hash && !auth.verifyPassword(String(body.password || ''), link.pass_hash)) {
    if (body.password) auth.recordFailure(clientIp(req));
    throw new HttpError(401, body.password ? 'Senha incorreta.' : 'Este link pede senha.');
  }
  if (link.max_views && link.views >= link.max_views) throw new HttpError(410, 'Este link atingiu o limite de acessos.');
  db.run('UPDATE share_links SET views = views + 1 WHERE id = ?', link.id);
  const key = crypto.randomBytes(24).toString('base64url');
  const expires = Math.min(link.expires_at, Date.now() + 12 * 3600e3);
  viewers.set(key, { linkId: link.id, cameraId: link.camera_id, kind: link.kind, from: link.from_ts, to: link.to_ts, expires });
  sendJson(res, 200, {
    cameraName: link.camera_name,
    kind: link.kind,
    from: link.from_ts,
    to: link.to_ts,
    expiresAt: link.expires_at,
    src: link.kind === 'live' ? `/v/${key}/live/index.m3u8` : `/v/${key}/playback.m3u8`,
  });
}

function viewer(key) {
  const v = viewers.get(key);
  // A deleted link stops working for viewers that already opened it.
  if (!v || v.expires < Date.now() || !db.one('SELECT 1 FROM share_links WHERE id = ?', v.linkId)) {
    viewers.delete(key);
    throw new HttpError(404, 'Link expirado.');
  }
  return v;
}

function serveViewer(res, key, rest) {
  const v = viewer(key);
  if (v.kind === 'live') {
    const m = /^live\/([^/]+)$/.exec(rest);
    if (!m) throw new HttpError(404, 'Não encontrado.');
    return serveLive(res, v.cameraId, m[1]);
  }
  if (rest === 'playback.m3u8') {
    const segs = recordings.listSegments(v.cameraId, v.from, v.to);
    if (!segs.length) throw new HttpError(404, 'Sem gravação nesse período.');
    return sendText(res, 200, recordings.playlist(segs, `/v/${key}/rec/`), 'application/vnd.apple.mpegurl');
  }
  const m = /^rec\/([^/]+)$/.exec(rest);
  if (!m) throw new HttpError(404, 'Não encontrado.');
  // Only chunks that overlap the shared window.
  const allowed = recordings.listSegments(v.cameraId, v.from, v.to).some((s) => s.file === m[1]);
  if (!allowed) throw new HttpError(404, 'Não encontrado.');
  return serveRecording(res, v.cameraId, m[1]);
}

// ------------------------------------------------------------------ router

const ID = '(\\d+)';
const routes = [
  ['POST', '/api/auth/register', (req, res) => register(req, res)],
  ['POST', '/api/auth/login', (req, res) => login(req, res)],
  ['POST', '/api/auth/logout', (req, res) => logout(req, res)],
  ['GET', '/api/me', (req, res, u) => sendJson(res, 200, u), true],
  ['GET', '/api/presets', (req, res) => sendJson(res, 200, require('./lib/presets').listPresets()), true],
  ['GET', '/api/cameras', api.listCameras, true],
  ['POST', '/api/cameras', api.createCamera, true],
  ['POST', '/api/cameras/test', api.testCamera, true],
  ['PUT', `/api/cameras/${ID}`, api.updateCamera, true],
  ['DELETE', `/api/cameras/${ID}`, api.deleteCamera, true],
  ['GET', `/api/cameras/${ID}/snapshot.jpg`, api.snapshot, true],
  ['GET', `/api/cameras/${ID}/recordings`, api.recordingRanges, true],
  ['GET', `/api/cameras/${ID}/playback.m3u8`, api.playback, true],
  ['GET', `/api/cameras/${ID}/shares`, api.listShares, true],
  ['POST', `/api/cameras/${ID}/shares`, api.addShare, true],
  ['DELETE', `/api/cameras/${ID}/shares/${ID}`, api.removeShare, true],
  ['GET', `/api/cameras/${ID}/links`, api.listLinks, true],
  ['POST', `/api/cameras/${ID}/links`, api.createLink, true],
  ['DELETE', `/api/links/${ID}`, api.deleteLink, true],
  ['GET', '/api/groups', api.listGroups, true],
  ['POST', '/api/groups', api.createGroup, true],
  ['DELETE', `/api/groups/${ID}`, api.deleteGroup, true],
  ['POST', `/api/groups/${ID}/members`, api.addMember, true],
  ['DELETE', `/api/groups/${ID}/members/${ID}`, api.removeMember, true],
  ['POST', `/api/groups/${ID}/cameras`, api.addGroupCamera, true],
  ['DELETE', `/api/groups/${ID}/cameras/${ID}`, api.removeGroupCamera, true],
  ['GET', `/media/${ID}/live/([^/]+)`, (req, res, u, id, file) => (cameraAccess(u, id), serveLive(res, id, file)), true],
  ['GET', `/media/${ID}/rec/([^/]+)`, (req, res, u, id, file) => {
    if (!cameraAccess(u, id).canPlayback) throw new HttpError(403, 'Sem acesso às gravações.');
    serveRecording(res, id, file);
  }, true],
  ['POST', '/api/public/([A-Za-z0-9_-]{20,})/open', (req, res, token) => openLink(req, res, token)],
  ['GET', '/v/([A-Za-z0-9_-]{20,})/(.+)', (req, res, key, rest) => serveViewer(res, key, rest)],
].map(([method, pattern, handler, needsUser]) => ({ method, re: new RegExp(`^${pattern}$`), handler, needsUser }));

function serveStatic(req, res, pathname) {
  const page = pathname === '/' ? 'index.html' : pathname.startsWith('/s/') ? 'share.html' : null;
  const headers = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (page) return sendFile(res, PUBLIC_DIR, page);
  if (/^\/(css|js)\/[\w.-]+$/.test(pathname)) return sendFile(res, PUBLIC_DIR, pathname.slice(1), 'public, max-age=300');
  if (pathname === '/vendor/hls.min.js') return sendFile(res, HLS_DIR, 'hls.min.js', 'public, max-age=86400');
  throw new HttpError(404, 'Página não encontrada.');
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Endereço inválido.');
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = m.slice(1).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
    if (!r.needsUser) return r.handler(req, res, ...params);
    const user = auth.requireUser(req);
    // Logged-in handlers get (req, res, user, ...params, query).
    return r.handler(req, res, user, ...params, url.searchParams);
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
  throw new HttpError(404, 'Rota não encontrada.');
}

function createServer() {
  return http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((err) => {
        const status = err instanceof HttpError ? err.status : 500;
        if (status === 500) console.error(err);
        if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Erro interno.' : err.message });
        else res.end();
      });
  });
}

function startAll() {
  for (const cam of db.all('SELECT * FROM cameras WHERE enabled = 1')) streams.start(cam);
}

function pruneAll() {
  for (const cam of db.all('SELECT id, retention_days FROM cameras')) recordings.prune(cam.id, cam.retention_days);
  db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  for (const [key, v] of viewers) if (v.expires < Date.now()) viewers.delete(key);
}

if (require.main === module) {
  db.open();
  startAll();
  pruneAll();
  setInterval(pruneAll, 10 * 60e3).unref();
  const server = createServer().listen(config.port, () => {
    console.log(`CamHub rodando em http://localhost:${config.port}`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      streams.stopAll();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

module.exports = { createServer, startAll, pruneAll };
