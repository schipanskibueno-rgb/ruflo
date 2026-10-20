'use strict';

// Who may see which camera. A user sees a camera when they:
//   - own it, or are a platform admin (the monitoring central);
//   - received a direct share from the owner;
//   - belong to a group (or own the group) where the camera's owner put that camera.
// Credentials never leave the server: rows go through publicCamera() before reaching JSON.
const db = require('./db');
const { HttpError } = require('./http');
const { maskUrl } = require('./presets');

const VISIBLE_SQL = `
  SELECT c.*, 1 AS can_playback, 'owner' AS via FROM cameras c WHERE c.owner_id = :uid
  UNION ALL
  SELECT c.*, s.can_playback, 'share' AS via FROM cameras c
    JOIN camera_shares s ON s.camera_id = c.id WHERE s.user_id = :uid
  UNION ALL
  SELECT c.*, gc.can_playback, 'group' AS via FROM cameras c
    JOIN group_cameras gc ON gc.camera_id = c.id
    JOIN share_groups g ON g.id = gc.group_id
    LEFT JOIN group_members m ON m.group_id = g.id AND m.user_id = :uid
    WHERE g.owner_id = :uid OR m.user_id IS NOT NULL
`;

function merge(rows) {
  const byId = new Map();
  for (const r of rows) {
    const prev = byId.get(r.id);
    if (!prev) byId.set(r.id, { ...r, can_playback: r.can_playback ? 1 : 0 });
    else {
      prev.can_playback = prev.can_playback || r.can_playback ? 1 : 0;
      if (r.via === 'owner') prev.via = 'owner';
    }
  }
  return [...byId.values()];
}

function visibleCameras(user) {
  if (user.isAdmin) {
    return db.all('SELECT c.*, 1 AS can_playback, ? AS via FROM cameras c ORDER BY c.name', 'admin').map((c) =>
      c.owner_id === user.id ? { ...c, via: 'owner' } : c,
    );
  }
  return merge(db.all(VISIBLE_SQL, { uid: user.id })).sort((a, b) => a.name.localeCompare(b.name));
}

function cameraAccess(user, cameraId) {
  const cam = visibleCameras(user).find((c) => c.id === cameraId);
  if (!cam) throw new HttpError(404, 'Câmera não encontrada.');
  return {
    cam,
    isOwner: cam.owner_id === user.id || user.isAdmin,
    canPlayback: !!cam.can_playback,
  };
}

function requireOwner(user, cameraId) {
  const access = cameraAccess(user, cameraId);
  if (!access.isOwner) throw new HttpError(403, 'Só o dono da câmera pode fazer isso.');
  return access.cam;
}

function publicCamera(cam, status) {
  const owner = db.one('SELECT name FROM users WHERE id = ?', cam.owner_id);
  return {
    id: cam.id,
    name: cam.name,
    brand: cam.brand,
    url: maskUrl(cam.url),
    hasCredentials: !!(cam.username || cam.password),
    username: cam.via === 'owner' || cam.via === 'admin' ? cam.username : undefined,
    transcode: !!cam.transcode,
    audio: !!cam.audio,
    record: !!cam.record,
    retentionDays: cam.retention_days,
    enabled: !!cam.enabled,
    location: cam.location,
    lat: cam.lat,
    lng: cam.lng,
    serial: cam.via === 'owner' || cam.via === 'admin' ? cam.serial : undefined,
    ownerName: owner ? owner.name : '',
    via: cam.via,
    canPlayback: !!cam.can_playback,
    status: status ? status.status : undefined,
    error: status && (cam.via === 'owner' || cam.via === 'admin') ? status.error : undefined,
  };
}

module.exports = { visibleCameras, cameraAccess, requireOwner, publicCamera };
