'use strict';

// One ffmpeg process per active camera. It pulls the camera stream (RTSP/RTMP/HTTP) and,
// through the tee muxer, writes:
//   media/<id>/live/index.m3u8 + seg_*.ts   rolling low-latency HLS for the live view
//   media/<id>/rec/YYYYMMDD-HHMMSS.ts       60 s recording chunks (UTC names) + CSV index
// Video is copied as-is (no CPU cost) unless the camera is marked "transcode", which is
// needed for H.265 cameras because most browsers only play H.264 over HLS.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const config = require('../config');
const { buildSourceUrl } = require('./presets');

const INPUT_PROTOCOLS = 'tcp,udp,rtp,rtsp,rtsps,rtmp,rtmps,http,https,tls,crypto,httpproxy';
const workers = new Map(); // cameraId -> worker
let stopping = false;

const camDir = (id) => path.join(config.mediaDir, String(id));
const liveDir = (id) => path.join(camDir(id), 'live');
const recDir = (id) => path.join(camDir(id), 'rec');

function inputArgs(url) {
  const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', '+genpts'];
  args.push('-protocol_whitelist', INPUT_PROTOCOLS);
  if (scheme.startsWith('rtsp')) args.push('-rtsp_transport', 'tcp', '-timeout', '15000000');
  else args.push('-rw_timeout', '15000000');
  args.push('-i', url);
  return args;
}

// Tee muxer option values may not contain these characters; our own paths never should.
function teePath(p) {
  if (/[|[\]:]/.test(p.replace(/^[A-Za-z]:/, ''))) throw new Error(`Caminho não suportado pelo ffmpeg tee: ${p}`);
  return p;
}

function buildArgs(cam) {
  const live = liveDir(cam.id);
  const rec = recDir(cam.id);
  const args = inputArgs(buildSourceUrl(cam));
  args.push('-map', '0:v:0');
  if (cam.audio) args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '64k', '-ar', '44100');
  else args.push('-an');
  if (cam.transcode) {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p');
    args.push('-force_key_frames', 'expr:gte(t,n_forced*1)');
  } else {
    args.push('-c:v', 'copy');
  }
  const outputs = [
    `[f=hls:hls_time=${config.liveSegmentSeconds}:hls_list_size=6:` +
      `hls_flags=delete_segments+independent_segments+omit_endlist:` +
      `hls_segment_filename=${teePath(path.join(live, 'seg_%05d.ts'))}]${teePath(path.join(live, 'index.m3u8'))}`,
  ];
  if (cam.record) {
    const list = path.join(rec, `list-${Date.now()}.csv`);
    outputs.push(
      `[f=segment:segment_time=${config.recordSegmentSeconds}:segment_format=mpegts:strftime=1:` +
        `reset_timestamps=1:segment_list=${teePath(list)}:segment_list_type=csv]` +
        teePath(path.join(rec, '%Y%m%d-%H%M%S.ts')),
    );
  }
  args.push('-f', 'tee', outputs.join('|'));
  return args;
}

function cleanLive(id) {
  fs.rmSync(liveDir(id), { recursive: true, force: true });
  fs.mkdirSync(liveDir(id), { recursive: true });
  fs.mkdirSync(recDir(id), { recursive: true });
}

function launch(worker) {
  const { cam } = worker;
  cleanLive(cam.id);
  worker.status = 'connecting';
  const child = spawn(config.ffmpeg, buildArgs(cam), {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, TZ: 'UTC' }, // recording file names are UTC
  });
  worker.child = child;
  worker.startedAt = Date.now();
  child.stderr.on('data', (chunk) => {
    worker.lastError = (worker.lastError + chunk.toString()).slice(-600);
  });
  child.on('error', (err) => {
    worker.lastError = `Falha ao iniciar ffmpeg: ${err.message}`;
  });
  child.on('exit', () => {
    worker.child = null;
    if (stopping || worker.stopped) return;
    worker.status = 'offline';
    // Back off when the camera keeps dropping: 5 s, 10 s, ... up to 60 s.
    const ranLong = Date.now() - worker.startedAt > 60e3;
    worker.backoff = ranLong ? 5e3 : Math.min((worker.backoff || 2500) * 2, 60e3);
    worker.timer = setTimeout(() => launch(worker), worker.backoff);
  });
}

function start(cam) {
  stop(cam.id);
  if (!cam.enabled) return;
  const worker = { cam, child: null, status: 'connecting', lastError: '', backoff: 0, stopped: false };
  workers.set(cam.id, worker);
  launch(worker);
}

function stop(id) {
  const worker = workers.get(id);
  if (!worker) return;
  worker.stopped = true;
  clearTimeout(worker.timer);
  if (worker.child) worker.child.kill('SIGTERM');
  workers.delete(id);
}

function status(id) {
  const worker = workers.get(id);
  if (!worker) return { status: 'disabled', error: '' };
  let online = false;
  try {
    online = Date.now() - fs.statSync(path.join(liveDir(id), 'index.m3u8')).mtimeMs < 15e3;
  } catch {
    /* no playlist yet */
  }
  const state = online ? 'online' : worker.child ? 'connecting' : 'offline';
  return { status: state, error: online ? '' : worker.lastError.trim().split('\n').pop() || '' };
}

function stopAll() {
  stopping = true;
  for (const id of [...workers.keys()]) stop(id);
}

// Grabs one JPEG frame from the newest live segment.
function snapshot(id) {
  return new Promise((resolve, reject) => {
    let files;
    try {
      files = fs.readdirSync(liveDir(id)).filter((f) => f.endsWith('.ts')).sort();
    } catch {
      files = [];
    }
    if (!files.length) return reject(new Error('Câmera sem imagem no momento.'));
    const seg = path.join(liveDir(id), files[files.length - 1]);
    execFile(
      config.ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-i', seg, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024, timeout: 10e3 },
      (err, stdout) => (err || !stdout.length ? reject(new Error('Não foi possível capturar a imagem.')) : resolve(stdout)),
    );
  });
}

// Checks that the camera answers and reports codecs, without starting a stream.
function probe(cam) {
  return new Promise((resolve) => {
    const url = buildSourceUrl(cam);
    const args = ['-v', 'error', '-protocol_whitelist', INPUT_PROTOCOLS];
    if (url.toLowerCase().startsWith('rtsp')) args.push('-rtsp_transport', 'tcp', '-timeout', '10000000');
    args.push('-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'json', url);
    execFile(config.ffprobe, args, { timeout: 20e3 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message).trim().split('\n').pop();
        return resolve({ ok: false, error: msg.replace(/\/\/[^/@\s]*@/g, '//') });
      }
      let streams = [];
      try {
        streams = JSON.parse(stdout).streams || [];
      } catch {
        /* keep empty */
      }
      const video = streams.find((s) => s.codec_type === 'video');
      if (!video) return resolve({ ok: false, error: 'Conectou, mas não encontrou vídeo.' });
      resolve({
        ok: true,
        video: { codec: video.codec_name, width: video.width, height: video.height },
        audio: streams.some((s) => s.codec_type === 'audio'),
        needsTranscode: video.codec_name !== 'h264',
      });
    });
  });
}

module.exports = { start, stop, stopAll, status, snapshot, probe, camDir, liveDir, recDir, buildArgs };
