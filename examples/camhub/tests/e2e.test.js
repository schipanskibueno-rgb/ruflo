'use strict';

// End-to-end: a fake camera (ffmpeg test pattern served over RTMP) goes through the whole
// flow — register, add camera, live HLS, recording, direct share, group, temporary link.
// Needs ffmpeg/ffprobe on PATH.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'camhub-test-'));
process.env.CAMHUB_DATA_DIR = DATA;
process.env.CAMHUB_RECORD_SEGMENT_SECONDS = '2';

const db = require('../lib/db');
const streams = require('../lib/streams');
const { createServer } = require('../server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sources = [];

// Each ffmpeg RTMP listener serves exactly one client, so start one per consumer.
function fakeCamera(port) {
  const p = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '15', '-f', 'flv', '-listen', '1', `rtmp://127.0.0.1:${port}/live/cam`,
  ], { stdio: 'ignore' });
  sources.push(p);
  return `rtmp://127.0.0.1:${port}/live/cam`;
}

let base;
let server;

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
  return call;
}

test.before(async () => {
  db.open();
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  streams.stopAll();
  sources.forEach((p) => p.kill('SIGKILL'));
  server.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});

test('fluxo completo de cadastro, ao vivo, gravação e compartilhamento', { timeout: 90e3 }, async () => {
  const alice = client();
  const bob = client();
  const carol = client();
  assert.equal((await alice('POST', '/api/auth/register', { name: 'Alice', email: 'alice@x.com', password: 'senha-forte-1' })).status, 201);
  assert.equal((await bob('POST', '/api/auth/register', { name: 'Bob', email: 'bob@x.com', password: 'senha-forte-2' })).status, 201);
  assert.equal((await carol('POST', '/api/auth/register', { name: 'Carol', email: 'carol@x.com', password: 'senha-forte-3' })).status, 201);
  assert.equal((await alice('GET', '/api/me')).data.isAdmin, true, 'primeira conta é admin');
  assert.equal((await bob('GET', '/api/me')).data.isAdmin, false);

  // Connection test without saving.
  const probeUrl = fakeCamera(19401);
  await sleep(800);
  const probe = await alice('POST', '/api/cameras/test', { brand: 'rtmp', url: probeUrl });
  assert.equal(probe.data.ok, true, JSON.stringify(probe.data));
  assert.equal(probe.data.video.codec, 'h264');

  // Brand preset builds the RTSP path and keeps credentials out of the browser.
  const hik = await alice('POST', '/api/cameras', {
    name: 'Hikvision', brand: 'hikvision', host: '10.255.255.1', channel: 2, username: 'admin', password: 'segredo123', enabled: false,
  });
  assert.equal(hik.status, 201);
  assert.equal(hik.data.url, 'rtsp://10.255.255.1:554/Streaming/Channels/201');
  const listed = await alice('GET', '/api/cameras');
  assert.ok(!JSON.stringify(listed.data).includes('segredo123'), 'senha da câmera nunca vai para o navegador');

  // Bad scheme is refused.
  assert.equal((await alice('POST', '/api/cameras', { name: 'x', brand: 'generic', url: 'file:///etc/passwd' })).status, 400);

  const cam = await alice('POST', '/api/cameras', { name: 'Portão', brand: 'rtmp', url: fakeCamera(19402), retentionDays: 3 });
  assert.equal(cam.status, 201);
  const id = cam.data.id;

  let status;
  for (let i = 0; i < 40 && status !== 'online'; i++) {
    await sleep(500);
    status = (await alice('GET', '/api/cameras')).data.find((c) => c.id === id).status;
  }
  assert.equal(status, 'online');

  const live = await alice('GET', `/media/${id}/live/index.m3u8`);
  assert.equal(live.status, 200);
  assert.match(live.data, /#EXTM3U/);
  const seg = live.data.split('\n').find((l) => l.endsWith('.ts'));
  assert.equal((await alice('GET', `/media/${id}/live/${seg}`)).status, 200);
  assert.equal((await alice('GET', `/api/cameras/${id}/snapshot.jpg`)).status, 200);

  // Strangers see nothing.
  assert.equal((await bob('GET', `/media/${id}/live/index.m3u8`)).status, 404);
  assert.equal((await bob('GET', '/api/cameras')).data.length, 0);

  // Direct share, live only.
  assert.equal((await alice('POST', `/api/cameras/${id}/shares`, { email: 'bob@x.com', canPlayback: false })).status, 201);
  assert.equal((await bob('GET', `/media/${id}/live/index.m3u8`)).status, 200);
  assert.equal((await bob('PUT', `/api/cameras/${id}`, { name: 'hack', brand: 'rtmp' })).status, 403);

  // Group: Carol joins, Alice puts her camera in with recordings allowed.
  const group = await alice('POST', '/api/groups', { name: 'Rua das Palmeiras' });
  const gid = group.data.id;
  assert.equal((await alice('POST', `/api/groups/${gid}/members`, { email: 'carol@x.com' })).status, 201);
  assert.equal((await carol('POST', `/api/groups/${gid}/cameras`, { cameraId: id })).status, 403, 'só o dono põe a câmera no grupo');
  assert.equal((await alice('POST', `/api/groups/${gid}/cameras`, { cameraId: id, canPlayback: true })).status, 201);
  const carolCams = (await carol('GET', '/api/cameras')).data;
  assert.equal(carolCams.length, 1);
  assert.equal(carolCams[0].via, 'group');

  // Recording + playback (chunks are 2 s in this test).
  await sleep(6000);
  const now = Date.now();
  const ranges = await carol('GET', `/api/cameras/${id}/recordings?from=${now - 3600e3}&to=${now + 60e3}`);
  assert.equal(ranges.status, 200);
  assert.ok(ranges.data.length >= 1, 'há gravação');
  const pb = await carol('GET', `/api/cameras/${id}/playback.m3u8?from=${now - 3600e3}&to=${now + 60e3}`);
  assert.equal(pb.status, 200);
  assert.match(pb.data, /#EXTINF/);
  const recFile = pb.data.split('\n').find((l) => l.startsWith('/media/'));
  assert.equal((await carol('GET', recFile)).status, 200);
  assert.equal((await bob('GET', `/api/cameras/${id}/playback.m3u8?from=${now - 3600e3}&to=${now}`)).status, 403);

  // Temporary link with password and a single view.
  const link = await alice('POST', `/api/cameras/${id}/links`, { kind: 'live', hours: 1, password: 'abc123', maxViews: 1 });
  assert.equal(link.status, 201);
  const token = link.data.path.split('/')[2];
  const anon = client();
  assert.equal((await anon('POST', `/api/public/${token}/open`, {})).status, 401);
  assert.equal((await anon('POST', `/api/public/${token}/open`, { password: 'errada' })).status, 401);
  const opened = await anon('POST', `/api/public/${token}/open`, { password: 'abc123' });
  assert.equal(opened.status, 200);
  assert.equal((await anon('GET', opened.data.src)).status, 200);
  assert.equal((await anon('POST', `/api/public/${token}/open`, { password: 'abc123' })).status, 410);

  // Revoking the link cuts viewers that already opened it.
  const links = (await alice('GET', `/api/cameras/${id}/links`)).data;
  await alice('DELETE', `/api/links/${links[0].id}`);
  assert.equal((await anon('GET', opened.data.src)).status, 404);

  // Leaving the group removes access.
  const carolId = (await carol('GET', '/api/me')).data.id;
  await carol('DELETE', `/api/groups/${gid}/members/${carolId}`);
  assert.equal((await carol('GET', '/api/cameras')).data.length, 0);
});
