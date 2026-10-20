'use strict';

const fs = require('fs');
const path = require('path');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function sendText(res, status, body, type, headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readJson(req, limit = 32 * 1024) {
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
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Streams a file that lives inside `root`. `rel` must already be validated by the caller.
function sendFile(res, root, rel, cache = 'no-store') {
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new HttpError(404, 'Não encontrado.');
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    throw new HttpError(404, 'Não encontrado.');
  }
  if (!stat.isFile()) throw new HttpError(404, 'Não encontrado.');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
  });
  fs.createReadStream(full).pipe(res);
}

function str(value, field, { max = 200, required = true } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s && required) throw new HttpError(400, `Campo obrigatório: ${field}.`);
  if (s.length > max) throw new HttpError(400, `Campo muito longo: ${field}.`);
  return s;
}

function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Valor inválido: ${field}.`);
  return n;
}

module.exports = { HttpError, MIME, sendJson, sendText, readJson, parseCookies, sendFile, str, int };
