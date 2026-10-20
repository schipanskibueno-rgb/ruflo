'use strict';

// Shared helpers and state for every screen.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const state = { me: null, cameras: [], groups: [], presets: [], view: 'map', page: 0, players: [] };

// Builds DOM nodes without innerHTML, so names typed by users can never inject markup.
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/auth') && !url.startsWith('/api/me/')) showAuth();
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function formData(form) {
  const out = {};
  for (const input of form.elements) {
    if (!input.name) continue;
    out[input.name] = input.type === 'checkbox' ? input.checked : input.value;
  }
  return out;
}

const fmtTime = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const statusLabel = { online: 'Online', connecting: 'Conectando…', offline: 'Offline', disabled: 'Desativada' };
const isMine = (cam) => cam.via === 'owner' || cam.via === 'admin';

function stopPlayers() {
  state.players.forEach((stop) => stop());
  state.players = [];
}

// Single-camera live viewer used by the map and the camera list.
function openViewer(cam) {
  stopPlayers();
  $('#viewer-title').textContent = cam.name;
  $('#viewer-dialog').showModal();
  state.players.push(window.playHls($('#viewer-video'), `/media/${cam.id}/live/index.m3u8`));
}
document.addEventListener('DOMContentLoaded', () => {
  $('#viewer-close').addEventListener('click', () => $('#viewer-dialog').close());
  $('#viewer-dialog').addEventListener('close', stopPlayers);
});

function applyThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#theme-toggle').textContent = dark ? '☀️ Claro' : '🌙 Escuro';
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('mbs-theme', next);
  } catch {
    /* not persisted */
  }
  applyThemeButton();
}
