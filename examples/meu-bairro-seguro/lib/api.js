'use strict';

const fs = require('fs');
const db = require('./db');
const auth = require('./auth');
const streams = require('./streams');
const recordings = require('./recordings');
const presets = require('./presets');
const onvif = require('./onvif');
const config = require('../config');
const { visibleCameras, cameraAccess, requireOwner, publicCamera } = require('./access');
const { HttpError, readJson, sendJson, sendText, str, int } = require('./http');

const bool = (v, fallback = false) => (v === undefined ? fallback : v === true || v === 1 || v === '1');

function coord(value, field, limit) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > limit) throw new HttpError(400, `Coordenada inválida: ${field}.`);
  return n;
}

async function cameraInput(body, existing) {
  const brand = str(body.brand || 'generic', 'marca', { max: 40 });
  const preset = presets.PRESETS[brand];
  if (!preset) throw new HttpError(400, 'Marca desconhecida.');
  const username = str(body.username, 'usuário', { max: 100, required: false });
  const keepPassword = existing && !body.password && !body.clearPassword;
  const password = keepPassword ? existing.password : str(body.password, 'senha', { max: 200, required: false });
  let url;
  let onvifUrl = existing ? existing.onvif_url : '';
  if (preset.onvif) {
    const host = str(body.host, 'endereço', { max: 253, required: !existing || !existing.onvif_url });
    if (host) {
      if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) throw new HttpError(400, 'Endereço (IP ou domínio) inválido.');
      const port = int(body.port, 'porta', { min: 1, max: 65535, fallback: preset.port });
      onvifUrl = `http://${host}:${port}/onvif/device_service`;
    }
    const stream = int(body.stream, 'stream', { min: 0, max: 1, fallback: 0 });
    url = host || !existing ? await onvif.getStreamUri(onvifUrl, username, password, stream) : existing.url;
  } else if (preset.template) {
    const host = str(body.host, 'endereço', { max: 253, required: !existing });
    url = host
      ? presets.resolveTemplate(brand, {
          host,
          port: int(body.port, 'porta', { min: 1, max: 65535, fallback: preset.port }),
          channel: int(body.channel, 'canal', { min: 1, max: 256, fallback: 1 }),
          stream: int(body.stream, 'stream', { min: 0, max: 1, fallback: 0 }),
        })
      : existing.url;
  } else {
    const raw = str(body.url, 'URL', { max: 1000, required: !existing });
    url = raw ? presets.validateUrl(raw) : existing.url;
  }
  if (!preset.onvif) onvifUrl = '';
  return {
    name: str(body.name, 'nome', { max: 80 }),
    brand,
    url,
    username,
    password,
    transcode: bool(body.transcode) ? 1 : 0,
    audio: bool(body.audio) ? 1 : 0,
    record: bool(body.record, true) ? 1 : 0,
    retention_days: int(body.retentionDays, 'dias de gravação', { min: 1, max: 90, fallback: config.defaultRetentionDays }),
    enabled: bool(body.enabled, true) ? 1 : 0,
    location: str(body.location, 'local', { max: 200, required: false }),
    lat: coord(body.lat, 'latitude', 90),
    lng: coord(body.lng, 'longitude', 180),
    serial: str(body.serial, 'número de série', { max: 64, required: false }),
    onvif_url: onvifUrl,
  };
}

const CAMERA_COLUMNS = ['name', 'brand', 'url', 'username', 'password', 'transcode', 'audio', 'record',
  'retention_days', 'enabled', 'location', 'lat', 'lng', 'serial', 'onvif_url'];

function userByLogin(login) {
  const user = db.one('SELECT id, name, login FROM users WHERE login = ?', String(login || '').trim().toLowerCase());
  if (!user) throw new HttpError(404, 'Nenhuma pessoa com esse login. O administrador cadastra os acessos em "Pessoas".');
  return user;
}

function requireCanAdd(user) {
  if (!user.isAdmin && !user.canAddCameras) throw new HttpError(403, 'Seu acesso não permite cadastrar câmeras.');
}

const loadCamera = (id) => db.one('SELECT * FROM cameras WHERE id = ?', id);

// ------------------------------------------------------------------ cameras

async function listCameras(req, res, user) {
  sendJson(res, 200, visibleCameras(user).map((c) => publicCamera(c, streams.status(c.id))));
}

async function createCamera(req, res, user) {
  requireCanAdd(user);
  const c = await cameraInput(await readJson(req));
  const info = db.run(
    `INSERT INTO cameras (owner_id, ${CAMERA_COLUMNS.join(', ')}, created_at)
     VALUES (?, ${CAMERA_COLUMNS.map(() => '?').join(', ')}, ?)`,
    user.id, ...CAMERA_COLUMNS.map((k) => c[k]), Date.now(),
  );
  const cam = loadCamera(Number(info.lastInsertRowid));
  streams.start(cam);
  sendJson(res, 201, publicCamera({ ...cam, via: 'owner', can_playback: 1 }, streams.status(cam.id)));
}

async function updateCamera(req, res, user, id) {
  const existing = requireOwner(user, id);
  const c = await cameraInput(await readJson(req), existing);
  db.run(`UPDATE cameras SET ${CAMERA_COLUMNS.map((k) => `${k}=?`).join(', ')} WHERE id=?`, ...CAMERA_COLUMNS.map((k) => c[k]), id);
  const cam = loadCamera(id);
  streams.start(cam);
  sendJson(res, 200, publicCamera({ ...cam, via: existing.via, can_playback: 1 }, streams.status(id)));
}

async function deleteCamera(req, res, user, id) {
  requireOwner(user, id);
  streams.stop(id);
  db.run('DELETE FROM cameras WHERE id = ?', id);
  fs.rmSync(streams.camDir(id), { recursive: true, force: true });
  sendJson(res, 200, { ok: true });
}

async function testCamera(req, res, user) {
  const body = await readJson(req);
  let existing;
  if (body.id) existing = requireOwner(user, int(body.id, 'id', { min: 1 }));
  else requireCanAdd(user);
  let c;
  try {
    c = await cameraInput({ name: 'teste', ...body }, existing);
  } catch (err) {
    if (err instanceof HttpError && err.status !== 400) return sendJson(res, 200, { ok: false, error: err.message });
    throw err;
  }
  sendJson(res, 200, { ...(await streams.probe(c)), url: presets.maskUrl(c.url) });
}

// ------------------------------------------------------------------ ONVIF / QR helpers

async function discoverCameras(req, res, user) {
  requireCanAdd(user);
  sendJson(res, 200, await onvif.discover());
}

async function findBySerial(req, res, user) {
  requireCanAdd(user);
  const body = await readJson(req);
  const serial = str(body.serial, 'número de série', { max: 64 });
  const username = str(body.username, 'usuário', { max: 100, required: false }) || 'admin';
  const password = str(body.password, 'senha', { max: 200, required: false });
  sendJson(res, 200, await onvif.findBySerial(serial, username, password));
}

async function snapshot(req, res, user, id) {
  cameraAccess(user, id);
  try {
    const jpeg = await streams.snapshot(id);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    res.end(jpeg);
  } catch (err) {
    throw new HttpError(503, err.message);
  }
}

function timeRange(query) {
  const from = int(query.get('from'), 'início', { min: 0 });
  const to = int(query.get('to'), 'fim', { min: 0 });
  if (to <= from || to - from > 2 * 86400e3) throw new HttpError(400, 'Período inválido (máximo 48 horas).');
  return { from, to };
}

async function recordingRanges(req, res, user, id, query) {
  const { canPlayback } = cameraAccess(user, id);
  if (!canPlayback) throw new HttpError(403, 'Você só tem acesso ao vivo desta câmera.');
  const { from, to } = timeRange(query);
  sendJson(res, 200, recordings.ranges(recordings.listSegments(id, from, to)));
}

async function playback(req, res, user, id, query) {
  const { canPlayback } = cameraAccess(user, id);
  if (!canPlayback) throw new HttpError(403, 'Você só tem acesso ao vivo desta câmera.');
  const { from, to } = timeRange(query);
  const segs = recordings.listSegments(id, from, to);
  if (!segs.length) throw new HttpError(404, 'Sem gravação nesse período.');
  sendText(res, 200, recordings.playlist(segs, `/media/${id}/rec/`), 'application/vnd.apple.mpegurl');
}

// ------------------------------------------------------------------ direct shares

async function listShares(req, res, user, id) {
  requireOwner(user, id);
  sendJson(res, 200, db.all(
    `SELECT u.id, u.name, u.login, s.can_playback AS canPlayback FROM camera_shares s
     JOIN users u ON u.id = s.user_id WHERE s.camera_id = ? ORDER BY u.name`, id,
  ));
}

async function addShare(req, res, user, id) {
  requireOwner(user, id);
  const body = await readJson(req);
  const target = userByLogin(body.login);
  if (target.id === user.id) throw new HttpError(400, 'Você já é dono desta câmera.');
  db.run(
    `INSERT INTO camera_shares (camera_id, user_id, can_playback) VALUES (?,?,?)
     ON CONFLICT (camera_id, user_id) DO UPDATE SET can_playback = excluded.can_playback`,
    id, target.id, bool(body.canPlayback) ? 1 : 0,
  );
  sendJson(res, 201, { ok: true });
}

async function removeShare(req, res, user, id, userId) {
  requireOwner(user, id);
  db.run('DELETE FROM camera_shares WHERE camera_id = ? AND user_id = ?', id, userId);
  sendJson(res, 200, { ok: true });
}

// ------------------------------------------------------------------ groups

function loadGroup(user, groupId) {
  const g = db.one('SELECT * FROM share_groups WHERE id = ?', groupId);
  const member = g && db.one('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', groupId, user.id);
  if (!g || (g.owner_id !== user.id && !member && !user.isAdmin)) throw new HttpError(404, 'Grupo não encontrado.');
  return { group: g, isOwner: g.owner_id === user.id || user.isAdmin };
}

async function listGroups(req, res, user) {
  const groups = db.all(
    `SELECT DISTINCT g.* FROM share_groups g LEFT JOIN group_members m ON m.group_id = g.id
     WHERE g.owner_id = ? OR m.user_id = ? ORDER BY g.name`, user.id, user.id,
  );
  sendJson(res, 200, groups.map((g) => ({
    id: g.id,
    name: g.name,
    isOwner: g.owner_id === user.id,
    owner: db.one('SELECT id, name FROM users WHERE id = ?', g.owner_id),
    members: db.all(
      'SELECT u.id, u.name, u.login FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.name', g.id,
    ),
    cameras: db.all(
      `SELECT c.id, c.name, c.owner_id AS ownerId, u.name AS ownerName, gc.can_playback AS canPlayback
       FROM group_cameras gc JOIN cameras c ON c.id = gc.camera_id JOIN users u ON u.id = c.owner_id
       WHERE gc.group_id = ? ORDER BY c.name`, g.id,
    ),
  })));
}

async function createGroup(req, res, user) {
  const name = str((await readJson(req)).name, 'nome do grupo', { max: 80 });
  const info = db.run('INSERT INTO share_groups (owner_id, name, created_at) VALUES (?,?,?)', user.id, name, Date.now());
  sendJson(res, 201, { id: Number(info.lastInsertRowid), name });
}

async function deleteGroup(req, res, user, groupId) {
  if (!loadGroup(user, groupId).isOwner) throw new HttpError(403, 'Só o administrador do grupo pode excluí-lo.');
  db.run('DELETE FROM share_groups WHERE id = ?', groupId);
  sendJson(res, 200, { ok: true });
}

async function addMember(req, res, user, groupId) {
  if (!loadGroup(user, groupId).isOwner) throw new HttpError(403, 'Só o administrador do grupo adiciona pessoas.');
  const target = userByLogin((await readJson(req)).login);
  db.run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)', groupId, target.id);
  sendJson(res, 201, { ok: true });
}

async function removeMember(req, res, user, groupId, userId) {
  const { isOwner } = loadGroup(user, groupId);
  if (!isOwner && userId !== user.id) throw new HttpError(403, 'Sem permissão.');
  db.tx(() => {
    db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', groupId, userId);
    // Someone who leaves takes their cameras out of the group too.
    db.run(
      'DELETE FROM group_cameras WHERE group_id = ? AND camera_id IN (SELECT id FROM cameras WHERE owner_id = ?)',
      groupId, userId,
    );
  });
  sendJson(res, 200, { ok: true });
}

async function addGroupCamera(req, res, user, groupId) {
  loadGroup(user, groupId);
  const body = await readJson(req);
  const cameraId = int(body.cameraId, 'câmera', { min: 1 });
  const cam = loadCamera(cameraId);
  // Consent rule: only the camera's owner can put it into a group.
  if (!cam || cam.owner_id !== user.id) throw new HttpError(403, 'Você só pode compartilhar câmeras suas.');
  db.run(
    `INSERT INTO group_cameras (group_id, camera_id, can_playback) VALUES (?,?,?)
     ON CONFLICT (group_id, camera_id) DO UPDATE SET can_playback = excluded.can_playback`,
    groupId, cameraId, bool(body.canPlayback) ? 1 : 0,
  );
  sendJson(res, 201, { ok: true });
}

async function removeGroupCamera(req, res, user, groupId, cameraId) {
  const { isOwner } = loadGroup(user, groupId);
  const cam = loadCamera(cameraId);
  if (!isOwner && (!cam || cam.owner_id !== user.id)) throw new HttpError(403, 'Sem permissão.');
  db.run('DELETE FROM group_cameras WHERE group_id = ? AND camera_id = ?', groupId, cameraId);
  sendJson(res, 200, { ok: true });
}

// ------------------------------------------------------------------ temporary links

async function listLinks(req, res, user, id) {
  requireOwner(user, id);
  sendJson(res, 200, db.all(
    `SELECT id, kind, from_ts AS fromTs, to_ts AS toTs, pass_hash IS NOT NULL AS hasPassword,
       expires_at AS expiresAt, max_views AS maxViews, views, created_at AS createdAt
     FROM share_links WHERE camera_id = ? AND expires_at > ? ORDER BY created_at DESC`, id, Date.now(),
  ));
}

async function createLink(req, res, user, id) {
  requireOwner(user, id);
  const body = await readJson(req);
  const kind = body.kind === 'recording' ? 'recording' : 'live';
  let fromTs = null;
  let toTs = null;
  if (kind === 'recording') {
    fromTs = int(body.from, 'início', { min: 0 });
    toTs = int(body.to, 'fim', { min: 0 });
    if (toTs <= fromTs || toTs - fromTs > 6 * 3600e3) throw new HttpError(400, 'Trecho inválido (máximo 6 horas).');
  }
  const hours = int(body.hours, 'validade', { min: 1, max: 24 * 30, fallback: 24 });
  const password = str(body.password, 'senha', { max: 100, required: false });
  const maxViews = int(body.maxViews, 'limite de acessos', { min: 1, max: 10000, fallback: null });
  const token = auth.newToken();
  db.run(
    `INSERT INTO share_links (token_hash, camera_id, created_by, kind, from_ts, to_ts, pass_hash, expires_at,
       max_views, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    auth.sha256(token), id, user.id, kind, fromTs, toTs, password ? auth.hashPassword(password) : null,
    Date.now() + hours * 3600e3, maxViews, Date.now(),
  );
  sendJson(res, 201, { path: `/s/${token}` });
}

async function deleteLink(req, res, user, linkId) {
  const link = db.one('SELECT camera_id FROM share_links WHERE id = ?', linkId);
  if (!link) throw new HttpError(404, 'Link não encontrado.');
  requireOwner(user, link.camera_id);
  db.run('DELETE FROM share_links WHERE id = ?', linkId);
  sendJson(res, 200, { ok: true });
}

module.exports = {
  listCameras, createCamera, updateCamera, deleteCamera, testCamera, snapshot, recordingRanges, playback,
  discoverCameras, findBySerial,
  listShares, addShare, removeShare,
  listGroups, createGroup, deleteGroup, addMember, removeMember, addGroupCamera, removeGroupCamera,
  listLinks, createLink, deleteLink,
};
