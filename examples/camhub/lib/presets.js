'use strict';

// Brand templates for the stream URL. Most DVR/NVR/IP cameras expose RTSP even when the
// vendor pushes its own cloud app; these are the common paths per manufacturer.
// Placeholders: {host} {port} {channel} {stream} (0 = main, 1 = sub) {user} {pass}.
const { HttpError } = require('./http');
const config = require('../config');

const PRESETS = {
  generic: { label: 'Outra / URL manual', port: 554, template: null },
  hikvision: {
    label: 'Hikvision / HiLook',
    port: 554,
    template: 'rtsp://{host}:{port}/Streaming/Channels/{channel}0{stream1}',
  },
  intelbras: {
    label: 'Intelbras (DVR/NVR/IP, linha Dahua)',
    port: 554,
    template: 'rtsp://{host}:{port}/cam/realmonitor?channel={channel}&subtype={stream}',
  },
  dahua: {
    label: 'Dahua / Imou',
    port: 554,
    template: 'rtsp://{host}:{port}/cam/realmonitor?channel={channel}&subtype={stream}',
  },
  xmeye: {
    label: 'XMEye / iCSee / Giga / JFL (Xiongmai)',
    port: 554,
    template: 'rtsp://{host}:{port}/user={user}&password={pass}&channel={channel}&stream={stream}.sdp',
  },
  tapo: { label: 'TP-Link Tapo / VIGI', port: 554, template: 'rtsp://{host}:{port}/stream{stream1}' },
  reolink: {
    label: 'Reolink',
    port: 554,
    template: 'rtsp://{host}:{port}/h264Preview_0{channel}_{streamName}',
  },
  uniview: { label: 'Uniview', port: 554, template: 'rtsp://{host}:{port}/unicast/c{channel}/s{stream}/live' },
  yoosee: { label: 'Yoosee', port: 554, template: 'rtsp://{host}:{port}/onvif{stream1}' },
  axis: { label: 'Axis', port: 554, template: 'rtsp://{host}:{port}/axis-media/media.amp' },
  rtmp: { label: 'RTMP (servidor de streaming)', port: 1935, template: null },
  http: { label: 'HTTP (MJPEG ou HLS .m3u8)', port: 80, template: null },
};

function listPresets() {
  return Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, port: p.port, manual: !p.template }));
}

// Turns brand + host/port/channel into a URL template. {user}/{pass} stay as placeholders and
// are filled in only on the server when ffmpeg is started.
function resolveTemplate(brand, { host, port, channel = 1, stream = 0 }) {
  const preset = PRESETS[brand];
  if (!preset) throw new HttpError(400, 'Marca desconhecida.');
  if (!preset.template) throw new HttpError(400, 'Informe a URL da câmera.');
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host || '')) throw new HttpError(400, 'Endereço (IP ou domínio) inválido.');
  const vars = {
    host,
    port: String(port || preset.port),
    channel: String(channel),
    stream: String(stream),
    stream1: String(Number(stream) + 1),
    streamName: Number(stream) ? 'sub' : 'main',
  };
  return preset.template.replace(/\{(host|port|channel|stream1|streamName|stream)\}/g, (_, k) => vars[k]);
}

function validateUrl(raw) {
  const probe = String(raw).replace(/\{user\}|\{pass\}/g, 'x');
  let url;
  try {
    url = new URL(probe);
  } catch {
    throw new HttpError(400, 'URL da câmera inválida.');
  }
  if (!config.allowedSchemes.includes(url.protocol)) {
    throw new HttpError(400, 'Use uma URL rtsp://, rtmp://, http:// ou https://.');
  }
  return raw;
}

// Full URL with credentials. Never send the result of this to the browser.
function buildSourceUrl(cam) {
  const user = encodeURIComponent(cam.username || '');
  const pass = encodeURIComponent(cam.password || '');
  if (/\{user\}|\{pass\}/.test(cam.url)) return cam.url.replace(/\{user\}/g, user).replace(/\{pass\}/g, pass);
  if (!cam.username) return cam.url;
  const url = new URL(cam.url);
  if (url.username) return cam.url;
  url.username = user;
  url.password = pass;
  return url.toString();
}

// What the browser sees: no user info, no password in query string.
function maskUrl(raw) {
  return String(raw)
    .replace(/\/\/[^/@]*@/, '//')
    .replace(/(password|pass|pwd)=[^&]*/gi, '$1=***');
}

module.exports = { PRESETS, listPresets, resolveTemplate, validateUrl, buildSourceUrl, maskUrl };
