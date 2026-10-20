'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const state = { me: null, cameras: [], groups: [], presets: [], view: 'mosaic', page: 0, players: [] };

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
  if (res.status === 401 && !url.startsWith('/api/auth')) showAuth();
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

const formData = (form) => {
  const out = {};
  for (const input of form.elements) {
    if (!input.name) continue;
    out[input.name] = input.type === 'checkbox' ? input.checked : input.value;
  }
  return out;
};
const fmtTime = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const statusLabel = { online: 'Online', connecting: 'Conectando…', offline: 'Offline', disabled: 'Desativada' };

// ------------------------------------------------------------------ auth

let authMode = 'login';
function showAuth() {
  stopPlayers();
  $('#app').hidden = true;
  $('#auth').hidden = false;
}

$$('[data-auth-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    authMode = b.dataset.authTab;
    $$('[data-auth-tab]').forEach((x) => x.classList.toggle('active', x === b));
    $('[data-register-only]').hidden = authMode !== 'register';
    $('#auth-form button[type=submit]').textContent = authMode === 'register' ? 'Criar conta' : 'Entrar';
  }),
);

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#auth-error').textContent = '';
  try {
    await api('POST', `/api/auth/${authMode}`, formData(e.target));
    await boot();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout').catch(() => {});
  showAuth();
});

// ------------------------------------------------------------------ navigation

function setView(view) {
  state.view = view;
  $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== view));
  stopPlayers();
  if (view === 'mosaic') renderMosaic();
  if (view === 'cameras') renderCameras();
  if (view === 'playback') renderPlaybackSelect();
  if (view === 'groups') renderGroups();
}
$$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

async function refresh() {
  [state.cameras, state.groups] = await Promise.all([api('GET', '/api/cameras'), api('GET', '/api/groups')]);
  const filter = $('#mosaic-filter');
  const current = filter.value;
  filter.replaceChildren(
    el('option', { value: '' }, 'Todas as câmeras'),
    el('option', { value: 'mine' }, 'Só as minhas'),
    ...state.groups.map((g) => el('option', { value: `g:${g.id}` }, `Grupo: ${g.name}`)),
  );
  filter.value = [...filter.options].some((o) => o.value === current) ? current : '';
}

// ------------------------------------------------------------------ mosaic

function stopPlayers() {
  state.players.forEach((stop) => stop());
  state.players = [];
}

function mosaicCameras() {
  const f = $('#mosaic-filter').value;
  const enabled = state.cameras.filter((c) => c.enabled);
  if (f === 'mine') return enabled.filter((c) => c.via === 'owner');
  if (f.startsWith('g:')) {
    const g = state.groups.find((x) => x.id === Number(f.slice(2)));
    const ids = new Set(g ? g.cameras.map((c) => c.id) : []);
    return enabled.filter((c) => ids.has(c.id));
  }
  return enabled;
}

function renderMosaic() {
  stopPlayers();
  const size = Number($('#mosaic-layout').value);
  const cams = mosaicCameras();
  const pages = Math.max(1, Math.ceil(cams.length / size));
  state.page = ((state.page % pages) + pages) % pages;
  const shown = cams.slice(state.page * size, state.page * size + size);
  const grid = $('#mosaic');
  grid.style.setProperty('--cols', Math.sqrt(size));
  grid.replaceChildren();
  $('#mosaic-page').replaceChildren(
    pages > 1 ? el('button', { type: 'button', onclick: () => ((state.page -= 1), renderMosaic()) }, '‹') : '',
    pages > 1 ? ` Página ${state.page + 1} de ${pages} ` : '',
    pages > 1 ? el('button', { type: 'button', onclick: () => ((state.page += 1), renderMosaic()) }, '›') : '',
  );
  if (!cams.length) {
    grid.append(el('div', { class: 'empty' }, 'Nenhuma câmera ainda. Vá em "Câmeras" e adicione a primeira.'));
    return;
  }
  for (const cam of shown) {
    const video = el('video', { muted: true, playsinline: true, autoplay: true });
    const tile = el('div', { class: 'tile', 'data-id': cam.id, ondblclick: () => tile.classList.toggle('expanded') },
      video,
      el('div', { class: 'tile-bar' },
        el('span', { class: `dot ${cam.status}` }),
        el('span', { class: 'grow' }, cam.name),
        el('a', { href: `/api/cameras/${cam.id}/snapshot.jpg`, download: `${cam.name}.jpg`, title: 'Foto agora' }, '📷'),
        el('button', { type: 'button', class: 'link', title: 'Tela cheia', onclick: () => video.requestFullscreen?.() }, '⛶'),
      ),
    );
    grid.append(tile);
    state.players.push(window.playHls(video, `/media/${cam.id}/live/index.m3u8`));
  }
}

['#mosaic-layout', '#mosaic-filter'].forEach((s) => $(s).addEventListener('change', () => ((state.page = 0), renderMosaic())));
let rotateTimer = null;
$('#mosaic-rotate').addEventListener('change', (e) => {
  clearInterval(rotateTimer);
  const secs = Number(e.target.value);
  if (secs) rotateTimer = setInterval(() => state.view === 'mosaic' && ((state.page += 1), renderMosaic()), secs * 1000);
});

// ------------------------------------------------------------------ cameras

function renderCameras() {
  const list = $('#camera-list');
  list.replaceChildren();
  if (!state.cameras.length) list.append(el('div', { class: 'empty' }, 'Nenhuma câmera cadastrada.'));
  for (const cam of state.cameras) {
    const mine = cam.via === 'owner' || cam.via === 'admin';
    const origin = cam.via === 'owner' ? '' : cam.via === 'admin' ? ` · de ${cam.ownerName}` :
      ` · compartilhada por ${cam.ownerName}${cam.via === 'group' ? ' (grupo)' : ''}${cam.canPlayback ? '' : ' · só ao vivo'}`;
    list.append(el('div', { class: 'item' },
      el('span', { class: `dot ${cam.status}` }),
      el('div', { class: 'grow' },
        el('strong', {}, cam.name),
        el('div', { class: 'muted small' }, `${statusLabel[cam.status] || ''}${origin}${cam.location ? ` · ${cam.location}` : ''}`),
        mine ? el('div', { class: 'muted small mono' }, cam.url) : '',
        mine && cam.error ? el('div', { class: 'error small' }, cam.error) : '',
      ),
      mine ? el('button', { type: 'button', onclick: () => openCameraDialog(cam) }, 'Editar') : '',
      mine ? el('button', { type: 'button', onclick: () => openShareDialog(cam) }, 'Compartilhar') : '',
      mine ? el('button', { type: 'button', class: 'danger', onclick: () => deleteCamera(cam) }, 'Excluir') : '',
    ));
  }
}

async function deleteCamera(cam) {
  if (!confirm(`Excluir "${cam.name}" e todas as gravações dela?`)) return;
  await api('DELETE', `/api/cameras/${cam.id}`);
  await refresh();
  renderCameras();
}

let editing = null;
function syncBrandFields() {
  const form = $('#camera-form');
  const preset = state.presets.find((p) => p.id === form.brand.value);
  $('[data-template-fields]').hidden = preset.manual;
  $('[data-url-field]').hidden = !preset.manual;
  form.port.placeholder = preset.port;
  form.host.required = !preset.manual && !editing;
  form.url.required = preset.manual && !editing;
}
$('#brand-select').addEventListener('change', syncBrandFields);

function openCameraDialog(cam = null) {
  editing = cam;
  const form = $('#camera-form');
  form.reset();
  $('#test-result').textContent = '';
  $('#camera-dialog-title').textContent = cam ? `Editar ${cam.name}` : 'Adicionar câmera';
  const hint = $('#current-url');
  hint.hidden = !cam;
  if (cam) {
    hint.textContent = `Endereço atual: ${cam.url}. Deixe IP/URL e senha em branco para manter.`;
    form.name.value = cam.name;
    form.brand.value = cam.brand;
    form.username.value = cam.username || '';
    form.location.value = cam.location || '';
    form.retentionDays.value = cam.retentionDays;
    for (const k of ['record', 'audio', 'transcode', 'enabled']) form[k].checked = cam[k];
  }
  syncBrandFields();
  $('#camera-dialog').showModal();
}
$('#add-camera').addEventListener('click', () => openCameraDialog());
$('#camera-cancel').addEventListener('click', () => $('#camera-dialog').close());

$('#test-camera').addEventListener('click', async () => {
  const out = $('#test-result');
  out.className = 'small muted';
  out.textContent = 'Testando conexão com a câmera…';
  try {
    const body = { ...formData($('#camera-form')), id: editing ? editing.id : undefined };
    const r = await api('POST', '/api/cameras/test', body);
    if (!r.ok) throw new Error(r.error || 'Sem resposta da câmera.');
    out.className = 'small ok';
    out.textContent = `Conectou! Vídeo ${r.video.codec.toUpperCase()} ${r.video.width}×${r.video.height}` +
      `${r.audio ? ', com áudio' : ''}.${r.needsTranscode ? ' Marque "Converter para H.264" para ver no navegador.' : ''}`;
    if (r.needsTranscode) $('#camera-form').transcode.checked = true;
  } catch (err) {
    out.className = 'small error';
    out.textContent = `Falhou: ${err.message}`;
  }
});

$('#camera-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = formData(e.target);
    if (editing) await api('PUT', `/api/cameras/${editing.id}`, body);
    else await api('POST', '/api/cameras', body);
    $('#camera-dialog').close();
    await refresh();
    renderCameras();
  } catch (err) {
    $('#test-result').className = 'small error';
    $('#test-result').textContent = err.message;
  }
});

// ------------------------------------------------------------------ sharing

let sharing = null;
async function openShareDialog(cam) {
  sharing = cam;
  $('#share-camera-name').textContent = cam.name;
  $('#link-result').replaceChildren();
  $('#share-form').reset();
  $('#link-form').reset();
  syncLinkKind();
  await renderShares();
  $('#share-dialog').showModal();
}
$('#share-close').addEventListener('click', () => $('#share-dialog').close());

async function renderShares() {
  const [shares, links] = await Promise.all([
    api('GET', `/api/cameras/${sharing.id}/shares`),
    api('GET', `/api/cameras/${sharing.id}/links`),
  ]);
  $('#share-list').replaceChildren(
    ...shares.map((s) => el('div', { class: 'item' },
      el('div', { class: 'grow' }, `${s.name} `, el('span', { class: 'muted small' }, `${s.email}${s.canPlayback ? ' · vê gravações' : ' · só ao vivo'}`)),
      el('button', { type: 'button', class: 'danger', onclick: async () => {
        await api('DELETE', `/api/cameras/${sharing.id}/shares/${s.id}`);
        renderShares();
      } }, 'Remover'),
    )),
  );
  $('#link-list').replaceChildren(
    ...links.map((l) => el('div', { class: 'item' },
      el('div', { class: 'grow small' },
        l.kind === 'live' ? 'Ao vivo' : `Gravação ${fmtTime(l.fromTs)} → ${fmtTime(l.toTs)}`,
        el('span', { class: 'muted' }, ` · expira ${fmtTime(l.expiresAt)} · ${l.views}${l.maxViews ? `/${l.maxViews}` : ''} acessos${l.hasPassword ? ' · com senha' : ''}`),
      ),
      el('button', { type: 'button', class: 'danger', onclick: async () => {
        await api('DELETE', `/api/links/${l.id}`);
        renderShares();
      } }, 'Revogar'),
    )),
  );
}

$('#share-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', `/api/cameras/${sharing.id}/shares`, formData(e.target));
    e.target.reset();
    renderShares();
  } catch (err) {
    alert(err.message);
  }
});

function syncLinkKind() {
  const rec = $('#link-form').kind.value === 'recording';
  $$('[data-rec-only]').forEach((x) => (x.hidden = !rec));
}
$('#link-form').kind.addEventListener('change', syncLinkKind);

$('#link-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = formData(e.target);
  const body = { kind: f.kind, hours: f.hours, password: f.password, maxViews: f.maxViews || undefined };
  if (f.kind === 'recording') Object.assign(body, { from: new Date(f.from).getTime(), to: new Date(f.to).getTime() });
  try {
    const r = await api('POST', `/api/cameras/${sharing.id}/links`, body);
    const url = `${location.origin}${r.path}`;
    $('#link-result').replaceChildren(
      el('span', { class: 'ok' }, 'Link criado (copie agora, ele não aparece de novo): '),
      el('input', { class: 'mono', value: url, readonly: true, onclick: (ev) => ev.target.select() }),
      el('button', { type: 'button', onclick: () => navigator.clipboard?.writeText(url) }, 'Copiar'),
    );
    renderShares();
  } catch (err) {
    $('#link-result').replaceChildren(el('span', { class: 'error' }, err.message));
  }
});

// ------------------------------------------------------------------ playback

function renderPlaybackSelect() {
  const sel = $('#pb-camera');
  const current = sel.value;
  sel.replaceChildren(...state.cameras.filter((c) => c.canPlayback).map((c) => el('option', { value: c.id }, c.name)));
  if (current) sel.value = current;
  if (!$('#pb-date').value) $('#pb-date').value = new Date().toLocaleDateString('sv-SE');
  loadTimeline();
}

function dayBounds() {
  const [y, m, d] = $('#pb-date').value.split('-').map(Number);
  const from = new Date(y, m - 1, d).getTime();
  return { from, to: new Date(y, m - 1, d + 1).getTime() };
}

async function loadTimeline() {
  const bar = $('#pb-timeline');
  bar.replaceChildren();
  const id = $('#pb-camera').value;
  if (!id || !$('#pb-date').value) return;
  const { from, to } = dayBounds();
  const ranges = await api('GET', `/api/cameras/${id}/recordings?from=${from}&to=${to}`).catch(() => []);
  for (const r of ranges) {
    const left = ((Math.max(r.start, from) - from) / (to - from)) * 100;
    const width = ((Math.min(r.end, to) - Math.max(r.start, from)) / (to - from)) * 100;
    bar.append(el('span', { class: 'range', style: `left:${left}%;width:${Math.max(width, 0.2)}%` }));
  }
  $('#pb-info').textContent = ranges.length ? 'Clique na faixa verde para assistir.' : 'Sem gravações nesse dia.';
}
['#pb-camera', '#pb-date'].forEach((s) => $(s).addEventListener('change', loadTimeline));
$('#pb-speed').addEventListener('change', (e) => ($('#pb-video').playbackRate = Number(e.target.value)));

$('#pb-timeline').addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const { from, to } = dayBounds();
  const start = Math.floor(from + ((e.clientX - rect.left) / rect.width) * (to - from));
  const end = Math.min(start + 2 * 3600e3, to);
  stopPlayers();
  const video = $('#pb-video');
  $('#pb-info').textContent = `Assistindo a partir de ${fmtTime(start)}.`;
  state.players.push(window.playHls(video, `/api/cameras/${$('#pb-camera').value}/playback.m3u8?from=${start}&to=${end}`, {
    live: false,
    onError: () => ($('#pb-info').textContent = 'Sem gravação a partir desse horário.'),
  }));
  video.playbackRate = Number($('#pb-speed').value);
});

// ------------------------------------------------------------------ groups

function renderGroups() {
  const list = $('#group-list');
  list.replaceChildren();
  if (!state.groups.length) list.append(el('div', { class: 'empty' }, 'Você ainda não participa de nenhum grupo.'));
  const myCams = state.cameras.filter((c) => c.via === 'owner');
  for (const g of state.groups) {
    const act = (fn) => async (e) => {
      e.preventDefault?.();
      try {
        await fn(e);
        await refresh();
        renderGroups();
      } catch (err) {
        alert(err.message);
      }
    };
    list.append(el('div', { class: 'card group' },
      el('div', { class: 'toolbar' },
        el('h3', { class: 'grow' }, g.name, el('span', { class: 'muted small' }, ` · admin: ${g.owner.name}`)),
        el('button', { type: 'button', onclick: () => {
          $('#mosaic-filter').value = `g:${g.id}`;
          setView('mosaic');
        } }, 'Ver mosaico'),
        g.isOwner
          ? el('button', { type: 'button', class: 'danger', onclick: act(() => confirm('Excluir o grupo?') && api('DELETE', `/api/groups/${g.id}`)) }, 'Excluir')
          : el('button', { type: 'button', class: 'danger', onclick: act(() => api('DELETE', `/api/groups/${g.id}/members/${state.me.id}`)) }, 'Sair do grupo'),
      ),
      el('h4', {}, 'Pessoas'),
      el('div', { class: 'chips' },
        el('span', { class: 'chip' }, `${g.owner.name} (admin)`),
        g.members.map((m) => el('span', { class: 'chip' }, m.name,
          g.isOwner ? el('button', { type: 'button', class: 'link', title: 'Remover', onclick: act(() => api('DELETE', `/api/groups/${g.id}/members/${m.id}`)) }, '×') : '')),
      ),
      g.isOwner ? el('form', { class: 'inline', onsubmit: act((e) => api('POST', `/api/groups/${g.id}/members`, formData(e.target))) },
        el('input', { name: 'email', type: 'email', placeholder: 'e-mail do vizinho', required: true }),
        el('button', { type: 'submit' }, 'Adicionar pessoa'),
      ) : '',
      el('h4', {}, 'Câmeras no grupo'),
      el('div', { class: 'list compact' },
        g.cameras.length ? '' : el('div', { class: 'muted small' }, 'Nenhuma câmera compartilhada ainda.'),
        g.cameras.map((c) => el('div', { class: 'item' },
          el('div', { class: 'grow' }, c.name, el('span', { class: 'muted small' }, ` · de ${c.ownerName}${c.canPlayback ? ' · gravações liberadas' : ' · só ao vivo'}`)),
          g.isOwner || c.ownerId === state.me.id
            ? el('button', { type: 'button', class: 'danger', onclick: act(() => api('DELETE', `/api/groups/${g.id}/cameras/${c.id}`)) }, 'Tirar')
            : '',
        )),
      ),
      myCams.length ? el('form', { class: 'inline', onsubmit: act((e) => api('POST', `/api/groups/${g.id}/cameras`, formData(e.target))) },
        el('select', { name: 'cameraId' }, myCams.map((c) => el('option', { value: c.id }, c.name))),
        el('label', {}, el('input', { type: 'checkbox', name: 'canPlayback' }), ' liberar gravações'),
        el('button', { type: 'submit' }, 'Compartilhar minha câmera'),
      ) : '',
    ));
  }
}

$('#group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/groups', formData(e.target));
    e.target.reset();
    await refresh();
    renderGroups();
  } catch (err) {
    alert(err.message);
  }
});

// ------------------------------------------------------------------ boot

async function boot() {
  try {
    state.me = await api('GET', '/api/me');
  } catch {
    return showAuth();
  }
  state.presets = await api('GET', '/api/presets');
  $('#brand-select').replaceChildren(...state.presets.map((p) => el('option', { value: p.id }, p.label)));
  $('#user-name').textContent = state.me.name + (state.me.isAdmin ? ' (admin)' : '');
  $('#auth').hidden = true;
  $('#app').hidden = false;
  await refresh();
  setView(state.view);
}

// Status dots refresh every 15 s without restarting the video players.
setInterval(async () => {
  if ($('#app').hidden) return;
  const cams = await api('GET', '/api/cameras').catch(() => null);
  if (!cams) return;
  state.cameras = cams;
  if (state.view === 'cameras') renderCameras();
  for (const tile of $$('#mosaic .tile')) {
    const cam = cams.find((c) => c.id === Number(tile.dataset.id));
    if (cam) $('.dot', tile).className = `dot ${cam.status}`;
  }
}, 15000);

boot();
