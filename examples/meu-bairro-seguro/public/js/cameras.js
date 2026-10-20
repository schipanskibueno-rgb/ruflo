'use strict';

// Camera list, add/edit form (QR code, sticker code, network search) and sharing.

// ------------------------------------------------------------------ list

function renderCameras() {
  const list = $('#camera-list');
  list.replaceChildren();
  if (!state.cameras.length) {
    list.append(el('div', { class: 'empty' }, state.me.canAddCameras
      ? 'Nenhuma câmera cadastrada. Clique em "+ Adicionar câmera".'
      : 'Nenhuma câmera liberada para você ainda. Fale com o administrador.'));
  }
  for (const cam of state.cameras) {
    const mine = isMine(cam);
    const origin = cam.via === 'owner' ? '' : cam.via === 'admin' ? ` · de ${cam.ownerName}` :
      ` · compartilhada por ${cam.ownerName}${cam.via === 'group' ? ' (grupo)' : ''}${cam.canPlayback ? '' : ' · só ao vivo'}`;
    const placed = typeof cam.lat === 'number';
    list.append(el('div', { class: 'item' },
      el('span', { class: `dot ${cam.status}` }),
      el('div', { class: 'grow' },
        el('strong', {}, cam.name),
        el('div', { class: 'muted small' },
          `${statusLabel[cam.status] || ''}${origin}${cam.location ? ` · ${cam.location}` : ''}${placed ? ' · 📍 no mapa' : ' · sem local no mapa'}`),
        mine ? el('div', { class: 'muted small mono' }, cam.url) : '',
        mine && cam.error ? el('div', { class: 'error small' }, cam.error) : '',
      ),
      el('button', { type: 'button', onclick: () => openViewer(cam) }, 'Ver'),
      mine ? el('button', { type: 'button', onclick: () => openCameraDialog(cam) }, 'Editar') : '',
      mine ? el('button', { type: 'button', onclick: () => openShareDialog(cam) }, 'Compartilhar') : '',
      mine ? el('button', { type: 'button', class: 'danger', onclick: () => deleteCamera(cam) }, 'Excluir') : '',
    ));
  }
}

async function deleteCamera(cam) {
  if (!confirm(`Excluir "${cam.name}" e todas as gravações dela?`)) return;
  await api('DELETE', `/api/cameras/${cam.id}`);
  await refreshView();
}

// ------------------------------------------------------------------ form

let editing = null;
function syncBrandFields() {
  const form = $('#camera-form');
  const preset = state.presets.find((p) => p.id === form.brand.value) || state.presets[0];
  $('[data-template-fields]').hidden = preset.manual;
  $('[data-channel]').hidden = preset.onvif;
  $('[data-url-field]').hidden = !preset.manual;
  form.port.placeholder = preset.port;
  const keep = editing && editing.brand === preset.id;
  form.host.required = !preset.manual && !keep;
  form.url.required = preset.manual && !keep;
}
$('#brand-select').addEventListener('change', syncBrandFields);

function quickMsg(text, kind = 'muted') {
  $('#quick-msg').className = `small ${kind}`;
  $('#quick-msg').textContent = text;
}

function openCameraDialog(cam = null) {
  if (!cam && !state.me.canAddCameras) return;
  editing = cam;
  const form = $('#camera-form');
  form.reset();
  stopQr();
  ['#qr-panel', '#code-panel', '#discover-panel'].forEach((s) => ($(s).hidden = true));
  $('#quick-add').hidden = !!cam;
  quickMsg(cam ? '' : 'Mais fácil: leia o QR da etiqueta da câmera ou procure na rede. Ou preencha à mão abaixo.');
  $('#test-result').textContent = '';
  $('#camera-dialog-title').textContent = cam ? `Editar ${cam.name}` : 'Adicionar câmera';
  const hint = $('#current-url');
  hint.hidden = !cam;
  if (cam) {
    hint.textContent = `Endereço atual: ${cam.url}. Deixe IP/URL e senha em branco para manter.`;
    form.name.value = cam.name;
    form.brand.value = cam.brand;
    form.username.value = cam.username || '';
    form.serial.value = cam.serial || '';
    form.location.value = cam.location || '';
    form.retentionDays.value = cam.retentionDays;
    for (const k of ['record', 'audio', 'transcode', 'enabled']) form[k].checked = cam[k];
  } else {
    form.brand.value = 'onvif';
  }
  syncBrandFields();
  $('#camera-dialog').showModal();
  initPicker(cam);
}
$('#add-camera').addEventListener('click', () => openCameraDialog());
$('#camera-cancel').addEventListener('click', () => $('#camera-dialog').close());
$('#camera-dialog').addEventListener('close', stopQr);

async function testCamera() {
  const out = $('#test-result');
  out.className = 'small muted';
  out.textContent = 'Testando conexão com a câmera…';
  try {
    const body = { ...formData($('#camera-form')), id: editing ? editing.id : undefined };
    const r = await api('POST', '/api/cameras/test', body);
    if (!r.ok) throw new Error(r.error || 'Sem resposta da câmera.');
    out.className = 'small ok';
    out.textContent = `Conectou! Vídeo ${r.video.codec.toUpperCase()} ${r.video.width}×${r.video.height}` +
      `${r.audio ? ', com áudio' : ''}.${r.needsTranscode ? ' Marquei "Converter para H.264" para ver no navegador.' : ''}`;
    if (r.needsTranscode) $('#camera-form').transcode.checked = true;
    return true;
  } catch (err) {
    out.className = 'small error';
    out.textContent = `Falhou: ${err.message}`;
    return false;
  }
}
$('#test-camera').addEventListener('click', testCamera);

$('#camera-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#test-result');
  out.className = 'small muted';
  out.textContent = 'Salvando…';
  try {
    const body = formData(e.target);
    if (editing) await api('PUT', `/api/cameras/${editing.id}`, body);
    else await api('POST', '/api/cameras', body);
    $('#camera-dialog').close();
    mapState.fitted = false;
    await refreshView();
  } catch (err) {
    out.className = 'small error';
    out.textContent = err.message;
  }
});

// ------------------------------------------------------------------ QR code / sticker code

const qr = { stream: null, timer: null, canvas: document.createElement('canvas') };

function stopQr() {
  clearInterval(qr.timer);
  qr.timer = null;
  if (qr.stream) qr.stream.getTracks().forEach((t) => t.stop());
  qr.stream = null;
  $('#qr-panel').hidden = true;
}

$('#qr-start').addEventListener('click', async () => {
  $('#code-panel').hidden = true;
  $('#discover-panel').hidden = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    quickMsg('Este navegador não libera a câmera aqui (precisa de HTTPS). Use "Digitar código".', 'error');
    return;
  }
  try {
    qr.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    quickMsg('Não consegui abrir a câmera do aparelho. Permita o acesso ou use "Digitar código".', 'error');
    return;
  }
  const video = $('#qr-video');
  video.srcObject = qr.stream;
  await video.play().catch(() => {});
  $('#qr-panel').hidden = false;
  quickMsg('Procurando QR…');
  qr.timer = setInterval(() => {
    if (!video.videoWidth) return;
    const w = Math.min(video.videoWidth, 800);
    const h = Math.round((video.videoHeight / video.videoWidth) * w);
    qr.canvas.width = w;
    qr.canvas.height = h;
    const ctx = qr.canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const found = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
    if (found && found.data) {
      stopQr();
      useCode(found.data);
    }
  }, 250);
});
$('#qr-stop').addEventListener('click', () => (stopQr(), quickMsg('')));

$('#code-start').addEventListener('click', () => {
  stopQr();
  $('#discover-panel').hidden = true;
  $('#code-panel').hidden = false;
  $('#code-input').focus();
});
$('#code-use').addEventListener('click', () => useCode($('#code-input').value));
$('#code-input').addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), useCode(e.target.value)));

function hasBrand(id) {
  return state.presets.some((p) => p.id === id);
}

// Fills the form from a QR / sticker code, then looks for that camera on the network.
async function useCode(text) {
  const form = $('#camera-form');
  const code = window.parseCameraCode(text);
  if (code.kind === 'empty') return quickMsg('Digite o código da etiqueta.', 'error');
  if (code.kind === 'cloud') {
    return quickMsg('Essa câmera é de uma marca que só funciona pela nuvem do fabricante e não libera o vídeo para outros sistemas.', 'error');
  }
  if (code.kind === 'url') {
    form.brand.value = hasBrand(code.brand) ? code.brand : 'generic';
    syncBrandFields();
    form.url.value = code.url;
    if (code.username) form.username.value = code.username;
    if (code.password) form.password.value = code.password;
    if (!form.name.value) form.name.value = 'Câmera';
    quickMsg('Endereço da câmera lido do QR. Testando…', 'ok');
    return testCamera();
  }
  if (code.kind !== 'serial') return quickMsg(`Não reconheci esse código: "${code.raw.slice(0, 60)}".`, 'error');

  form.serial.value = code.serial;
  if (!form.username.value) form.username.value = 'admin';
  if (code.code && !form.password.value) form.password.value = code.code;
  if (!form.name.value) form.name.value = code.model ? `Câmera ${code.model}` : `Câmera ${code.serial.slice(-4)}`;
  quickMsg(`Nº de série ${code.serial}${code.code ? ' e código de verificação lidos' : ' lido'}. Procurando essa câmera na rede…`);
  try {
    const r = await api('POST', '/api/onvif/find', { serial: code.serial, username: form.username.value, password: form.password.value });
    if (r.match) {
      selectFound(r.match);
      quickMsg(`Câmera encontrada: ${r.match.manufacturer || ''} ${r.match.model || ''} em ${r.match.host}. Testando…`.replace(/\s+/g, ' '), 'ok');
      return testCamera();
    }
    const brand = code.brand && hasBrand(code.brand) ? code.brand : 'onvif';
    form.brand.value = brand;
    syncBrandFields();
    quickMsg(
      r.scanned
        ? `Achei ${r.scanned} câmera(s) na rede, mas nenhuma com esse nº de série e essa senha. Confira a senha ou informe o IP abaixo.`
        : 'Não achei câmeras na rede do servidor. Se a câmera está em outro lugar, informe o IP ou endereço DDNS abaixo.',
      'error',
    );
    form.host.focus();
  } catch (err) {
    quickMsg(err.message, 'error');
  }
}

// ------------------------------------------------------------------ network search (ONVIF)

function selectFound(device) {
  const form = $('#camera-form');
  const url = new URL(device.xaddr);
  form.brand.value = 'onvif';
  syncBrandFields();
  form.host.value = url.hostname;
  form.port.value = url.port || (url.protocol === 'https:' ? 443 : 80);
  if (!form.name.value) form.name.value = device.name || device.model || `Câmera ${url.hostname}`;
  if (!form.username.value) form.username.value = 'admin';
}

$('#discover-start').addEventListener('click', async () => {
  stopQr();
  $('#code-panel').hidden = true;
  $('#discover-panel').hidden = false;
  $('#discover-msg').textContent = 'Procurando câmeras na rede do servidor (3 segundos)…';
  $('#discover-list').replaceChildren();
  try {
    const devices = await api('GET', '/api/onvif/discover');
    $('#discover-msg').textContent = devices.length
      ? 'Clique na câmera, informe a senha dela e salve:'
      : 'Nenhuma câmera respondeu. Ela precisa estar na mesma rede do servidor e com ONVIF ligado.';
    $('#discover-list').replaceChildren(...devices.map((d) => el('div', { class: 'item clickable', onclick: () => {
      selectFound(d);
      quickMsg(`Selecionada: ${d.host}. Agora digite a senha da câmera e clique em "Testar conexão".`, 'ok');
      $('#camera-form').password.focus();
    } }, '📹 ', el('strong', {}, d.name || d.hardware || 'Câmera'), el('span', { class: 'muted small' }, ` ${d.hardware} · ${d.host}`))));
  } catch (err) {
    $('#discover-msg').textContent = err.message;
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
      el('div', { class: 'grow' }, `${s.name} `, el('span', { class: 'muted small' }, `${s.login}${s.canPlayback ? ' · vê gravações' : ' · só ao vivo'}`)),
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

