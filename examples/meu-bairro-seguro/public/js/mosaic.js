'use strict';

// Live mosaic and recordings timeline.

// ------------------------------------------------------------------ mosaic

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

// ------------------------------------------------------------------ playback

function renderPlaybackSelect() {
  const sel = $('#pb-camera');
  const current = state.pbCamera || sel.value;
  state.pbCamera = null;
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

function openPlaybackFor(cam) {
  if (mapState.map) mapState.map.closePopup();
  state.pbCamera = String(cam.id);
  setView('playback');
}
