'use strict';

const crypto = require('crypto');
const db = require('./db');
const config = require('../config');
const { HttpError, parseCookies } = require('./http');

const COOKIE = 'camhub_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function createSession(userId) {
  const token = newToken();
  const expires = Date.now() + config.sessionDays * 86400e3;
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, expires);
  return token;
}

function sessionCookie(token, maxAgeSeconds = config.sessionDays * 86400) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = db.one(
    `SELECT u.id, u.name, u.email, u.is_admin, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, name: row.name, email: row.email, isAdmin: !!row.is_admin };
}

function requireUser(req) {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Faça login para continuar.');
  return user;
}

function destroySession(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

// Simple in-memory brute-force guard for login: 10 failures per IP per 15 minutes.
const failures = new Map();
function checkRate(ip) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (entry && entry.until > now && entry.count >= 10) {
    throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  }
}
function recordFailure(ip) {
  const now = Date.now();
  const entry = failures.get(ip);
  if (!entry || entry.until < now) failures.set(ip, { count: 1, until: now + 15 * 60e3 });
  else entry.count += 1;
}

module.exports = {
  hashPassword,
  verifyPassword,
  sha256,
  newToken,
  createSession,
  sessionCookie,
  currentUser,
  requireUser,
  destroySession,
  checkRate,
  recordFailure,
};
