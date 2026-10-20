'use strict';

// People and their access. Only the administrator creates accounts (login + password) and
// decides which cameras each person sees; there is no open sign-up after the first admin.
const db = require('./db');
const auth = require('./auth');
const { HttpError, readJson, sendJson, str, int } = require('./http');

const bool = (v) => v === true || v === 1 || v === '1';

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  login: u.login,
  isAdmin: !!u.is_admin,
  canAddCameras: !!u.is_admin || !!u.can_add_cameras,
  createdAt: u.created_at,
  cameraCount: db.one('SELECT COUNT(*) AS n FROM camera_shares WHERE user_id = ?', u.id).n,
});

function loadUser(id) {
  const u = db.one('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw new HttpError(404, 'Pessoa não encontrada.');
  return u;
}

const adminCount = () => db.one('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').n;

async function list(req, res) {
  sendJson(res, 200, db.all('SELECT * FROM users ORDER BY name').map(publicUser));
}

async function create(req, res) {
  const body = await readJson(req);
  const login = auth.normalizeLogin(body.login);
  if (db.one('SELECT 1 FROM users WHERE login = ?', login)) throw new HttpError(409, 'Esse login já existe.');
  const info = db.run(
    'INSERT INTO users (name, login, pass_hash, is_admin, can_add_cameras, created_at) VALUES (?,?,?,?,?,?)',
    str(body.name, 'nome', { max: 80 }), login, auth.hashPassword(auth.checkNewPassword(body.password)),
    bool(body.isAdmin) ? 1 : 0, bool(body.canAddCameras) ? 1 : 0, Date.now(),
  );
  sendJson(res, 201, publicUser(loadUser(Number(info.lastInsertRowid))));
}

async function update(req, res, admin, id) {
  const u = loadUser(id);
  const body = await readJson(req);
  const isAdmin = bool(body.isAdmin) ? 1 : 0;
  if (u.is_admin && !isAdmin && adminCount() === 1) throw new HttpError(400, 'Precisa existir pelo menos um administrador.');
  db.run(
    'UPDATE users SET name = ?, is_admin = ?, can_add_cameras = ? WHERE id = ?',
    str(body.name, 'nome', { max: 80 }), isAdmin, bool(body.canAddCameras) ? 1 : 0, id,
  );
  if (body.password) {
    db.run('UPDATE users SET pass_hash = ? WHERE id = ?', auth.hashPassword(auth.checkNewPassword(body.password)), id);
    // A new password logs the person out everywhere.
    db.run('DELETE FROM sessions WHERE user_id = ?', id);
  }
  sendJson(res, 200, publicUser(loadUser(id)));
}

async function remove(req, res, admin, id) {
  if (id === admin.id) throw new HttpError(400, 'Você não pode excluir o próprio acesso.');
  const u = loadUser(id);
  const owned = db.one('SELECT COUNT(*) AS n FROM cameras WHERE owner_id = ?', id).n;
  if (owned) throw new HttpError(409, `${u.name} é dono de ${owned} câmera(s). Exclua ou transfira antes.`);
  db.run('DELETE FROM users WHERE id = ?', id);
  sendJson(res, 200, { ok: true });
}

// Which cameras this person can see, and whether they can see recordings.
async function getAccess(req, res, admin, id) {
  loadUser(id);
  sendJson(res, 200, db.all(
    `SELECT c.id, c.name, u.name AS ownerName, c.owner_id = :uid AS owned,
       s.user_id IS NOT NULL AS granted, COALESCE(s.can_playback, 0) AS canPlayback
     FROM cameras c JOIN users u ON u.id = c.owner_id
     LEFT JOIN camera_shares s ON s.camera_id = c.id AND s.user_id = :uid
     ORDER BY c.name`, { uid: id },
  ).map((r) => ({ ...r, owned: !!r.owned, granted: !!r.granted, canPlayback: !!r.canPlayback })));
}

async function setAccess(req, res, admin, id) {
  loadUser(id);
  const body = await readJson(req, 256 * 1024);
  if (!Array.isArray(body.cameras)) throw new HttpError(400, 'Lista de câmeras inválida.');
  const rows = body.cameras.map((c) => ({ cameraId: int(c.cameraId, 'câmera', { min: 1 }), canPlayback: bool(c.canPlayback) }));
  db.tx(() => {
    db.run('DELETE FROM camera_shares WHERE user_id = ?', id);
    for (const r of rows) {
      const cam = db.one('SELECT owner_id FROM cameras WHERE id = ?', r.cameraId);
      if (!cam || cam.owner_id === id) continue;
      db.run('INSERT INTO camera_shares (camera_id, user_id, can_playback) VALUES (?,?,?)', r.cameraId, id, r.canPlayback ? 1 : 0);
    }
  });
  sendJson(res, 200, { ok: true });
}

async function changeOwnPassword(req, res, user) {
  const body = await readJson(req);
  const row = loadUser(user.id);
  if (!auth.verifyPassword(String(body.current || ''), row.pass_hash)) throw new HttpError(400, 'Senha atual incorreta.');
  db.run('UPDATE users SET pass_hash = ? WHERE id = ?', auth.hashPassword(auth.checkNewPassword(body.next)), user.id);
  sendJson(res, 200, { ok: true });
}

module.exports = { list, create, update, remove, getAccess, setAccess, changeOwnPassword };
