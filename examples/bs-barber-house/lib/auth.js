'use strict';

const crypto = require('crypto');

const DEFAULT_PASSWORD = 'bsbarber2026';
const PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
const usingDefaultPassword = !process.env.ADMIN_PASSWORD;

const SESSION_TTL = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const FAIL_WINDOW = 15 * 60 * 1000;
const COOKIE = 'bs_admin';

const sessions = new Map(); // token -> expiresAt
const fails = new Map(); // ip -> { count, first }

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

function login(password, ip) {
  const f = fails.get(ip);
  if (f && Date.now() - f.first > FAIL_WINDOW) fails.delete(ip);
  const current = fails.get(ip);
  if (current && current.count >= MAX_FAILS) {
    return { status: 429, error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' };
  }
  if (!crypto.timingSafeEqual(digest(password), digest(PASSWORD))) {
    fails.set(ip, { count: (current?.count || 0) + 1, first: current?.first || Date.now() });
    return { status: 401, error: 'Senha incorreta.' };
  }
  fails.delete(ip);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return { token };
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function tokenOf(req) {
  return parseCookies(req.headers.cookie)[COOKIE];
}

function isAuthed(req) {
  const token = tokenOf(req);
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function logout(req) {
  const token = tokenOf(req);
  if (token) sessions.delete(token);
}

function sessionCookie(req, token) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  const maxAge = token ? SESSION_TTL / 1000 : 0;
  return `${COOKIE}=${token || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

module.exports = { login, logout, isAuthed, sessionCookie, usingDefaultPassword, DEFAULT_PASSWORD };
