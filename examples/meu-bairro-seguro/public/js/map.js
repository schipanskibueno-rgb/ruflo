'use strict';

// Main map (home screen) and the small location picker inside the camera form.
// Tiles: OpenStreetMap. Each camera with a location is a camera-shaped pin.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const BRAZIL = [-15.8, -47.9];
const mapState = { map: null, layer: null, markers: new Map(), fitted: false, popupStop: null };

const CAMERA_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" ' +
  'd="M4 7h10a2 2 0 0 1 2 2v1.5l4-2.5v8l-4-2.5V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></svg>';

function camIcon(status) {
  return L.divIcon({
    className: '',
    html: `<div class="cam-pin ${status || 'offline'}">${CAMERA_SVG}</div>`,
    iconSize: [36, 44],
    iconAnchor: [18, 42],
    popupAnchor: [0, -40],
  });
}

function ensureMap() {
  if (mapState.map) return mapState.map;
  const map = L.map('map', { zoomControl: true }).setView(BRAZIL, 4);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(map);
  mapState.layer = L.layerGroup().addTo(map);
  map.on('popupclose', () => {
    if (mapState.popupStop) mapState.popupStop();
    mapState.popupStop = null;
  });
  mapState.map = map;
  return map;
}

function popupContent(cam) {
  const video = el('video', { muted: true, playsinline: true, autoplay: true });
  const box = el('div', { class: 'cam-popup' },
    el('div', { class: 'cam-popup-head' },
      el('span', { class: `dot ${cam.status}` }),
      el('strong', { class: 'grow' }, cam.name),
      el('span', { class: 'muted small' }, statusLabel[cam.status] || ''),
    ),
    cam.location ? el('div', { class: 'muted small' }, cam.location) : '',
    el('div', { class: 'cam-popup-video' }, video),
    el('div', { class: 'cam-popup-actions' },
      el('button', { type: 'button', onclick: () => (mapState.map.closePopup(), openViewer(cam)) }, '⤢ Ampliar'),
      cam.canPlayback ? el('button', { type: 'button', onclick: () => openPlaybackFor(cam) }, '⏪ Gravações') : '',
      isMine(cam) ? el('button', { type: 'button', onclick: () => (mapState.map.closePopup(), openCameraDialog(cam)) }, '✎ Editar') : '',
    ),
  );
  return { box, video };
}

function openCameraPopup(cam, marker) {
  const { box, video } = popupContent(cam);
  // Opening the new popup closes the previous one (and its player) first.
  L.popup({ minWidth: 300, maxWidth: 420, offset: [0, -36] }).setLatLng(marker.getLatLng()).setContent(box).openOn(mapState.map);
  mapState.popupStop = window.playHls(video, `/media/${cam.id}/live/index.m3u8`);
}

function renderMap() {
  const map = ensureMap();
  setTimeout(() => map.invalidateSize(), 0);
  mapState.layer.clearLayers();
  mapState.markers.clear();
  const placed = state.cameras.filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number');
  for (const cam of placed) {
    const marker = L.marker([cam.lat, cam.lng], { icon: camIcon(cam.enabled ? cam.status : 'disabled'), title: cam.name });
    marker.on('click', () => openCameraPopup(cam, marker));
    marker.addTo(mapState.layer);
    mapState.markers.set(cam.id, marker);
  }
  if (!mapState.fitted && placed.length) {
    // Keep the pins clear of the camera list panel on wide screens.
    const side = window.innerWidth > 720 ? $('#map-side').offsetWidth + 24 : 0;
    map.fitBounds(L.latLngBounds(placed.map((c) => [c.lat, c.lng])).pad(0.3), { maxZoom: 17, paddingBottomRight: [side, 0] });
    mapState.fitted = true;
  }
  renderMapList(placed.length);
}

function renderMapList(placedCount) {
  $('#map-count').textContent = `${placedCount} no mapa · ${state.cameras.length} no total`;
  const list = $('#map-list');
  list.replaceChildren();
  if (!state.cameras.length) {
    list.append(el('div', { class: 'muted small' }, state.me.canAddCameras
      ? 'Nenhuma câmera ainda. Clique em "+ Adicionar".'
      : 'Nenhuma câmera liberada para você ainda. Fale com o administrador.'));
  }
  for (const cam of state.cameras) {
    const marker = mapState.markers.get(cam.id);
    list.append(el('div', { class: 'item clickable', onclick: () => {
      if (marker) {
        mapState.map.flyTo(marker.getLatLng(), Math.max(mapState.map.getZoom(), 17));
        openCameraPopup(cam, marker);
      } else {
        openViewer(cam);
      }
    } },
      el('span', { class: `dot ${cam.status}` }),
      el('div', { class: 'grow' }, el('div', {}, cam.name),
        el('div', { class: 'muted small' }, marker ? (cam.location || 'No mapa') : 'Sem local no mapa')),
      !marker && isMine(cam)
        ? el('button', { type: 'button', class: 'small-btn', onclick: (e) => (e.stopPropagation(), openCameraDialog(cam)) }, '📍 Marcar')
        : '',
    ));
  }
}

// Refreshes only the pin colours, without closing an open popup.
function updateMapStatus() {
  for (const cam of state.cameras) {
    const marker = mapState.markers.get(cam.id);
    const pin = marker && marker.getElement() && marker.getElement().querySelector('.cam-pin');
    if (pin) pin.className = `cam-pin ${cam.enabled ? cam.status : 'disabled'}`;
  }
}

// ------------------------------------------------------------------ location picker

const picker = { map: null, marker: null };

function setPickerPoint(lat, lng, pan = true) {
  const form = $('#camera-form');
  form.lat.value = lat === null ? '' : lat.toFixed(6);
  form.lng.value = lng === null ? '' : lng.toFixed(6);
  if (lat === null) {
    if (picker.marker) picker.marker.remove();
    picker.marker = null;
    $('#pick-hint').textContent = 'Clique no mapa para marcar o local da câmera.';
    return;
  }
  if (!picker.marker) picker.marker = L.marker([lat, lng], { icon: camIcon('online'), draggable: true }).addTo(picker.map);
  else picker.marker.setLatLng([lat, lng]);
  picker.marker.off('dragend').on('dragend', () => {
    const p = picker.marker.getLatLng();
    setPickerPoint(p.lat, p.lng, false);
  });
  if (pan) picker.map.setView([lat, lng], Math.max(picker.map.getZoom(), 17));
  $('#pick-hint').textContent = `Marcado em ${lat.toFixed(5)}, ${lng.toFixed(5)} — arraste o ícone para ajustar.`;
}

function initPicker(cam) {
  if (!picker.map) {
    picker.map = L.map('pick-map').setView(BRAZIL, 4);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(picker.map);
    picker.map.on('click', (e) => setPickerPoint(e.latlng.lat, e.latlng.lng, false));
  }
  setTimeout(() => picker.map.invalidateSize(), 50);
  if (cam && typeof cam.lat === 'number') {
    setPickerPoint(cam.lat, cam.lng);
  } else {
    setPickerPoint(null, null);
    // Start the picker where the other cameras are, so the user doesn't zoom from all of Brazil.
    const placed = state.cameras.filter((c) => typeof c.lat === 'number');
    if (placed.length) picker.map.fitBounds(L.latLngBounds(placed.map((c) => [c.lat, c.lng])).pad(0.5), { maxZoom: 16 });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#use-my-location').addEventListener('click', () => {
    if (!navigator.geolocation) return alert('Este navegador não informa a localização.');
    $('#pick-hint').textContent = 'Buscando sua localização…';
    navigator.geolocation.getCurrentPosition(
      (pos) => setPickerPoint(pos.coords.latitude, pos.coords.longitude),
      () => ($('#pick-hint').textContent = 'Não foi possível pegar a localização (permita o acesso ou use HTTPS). Clique no mapa.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  $('#clear-location').addEventListener('click', () => setPickerPoint(null, null));
  $('#map-add').addEventListener('click', () => openCameraDialog());
});
