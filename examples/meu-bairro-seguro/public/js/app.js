'use strict';

// Login / first setup, navigation between screens, and boot.

let setupMode = false;

async function showAuth() {
  stopPlayers();
  $('#app').hidden = true;
  $('#auth').hidden = false;
  const { needsSetup } = await fetch('/api/setup').then((r) => r.json()).catch(() => ({ needsSetup: false }));
  setupMode = needsSetup;
  $('[data-setup-only]').hidden = !setupMode;
  $('#auth-form').name.required = setupMode;
  $('#auth-submit').textContent = setupMode ? 'Criar administrador' : 'Entrar';
  $('#auth-intro').textContent = setupMode
    ? 'Primeiro acesso: crie o login do administrador. Depois, ele cria o acesso de cada pessoa.'
    : 'Entre com o login e a senha que o administrador criou para você.';
}

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#auth-error').textContent = '';
  try {
    await api('POST', setupMode ? '/api/auth/setup' : '/api/auth/login', formData(e.target));
    e.target.reset();
    await boot();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/auth/logout').catch(() => {});
  showAuth();
});

$('#theme-toggle').addEventListener('click', toggleTheme);

$('#my-password').addEventListener('click', () => {
  $('#password-form').reset();
  $('#password-msg').textContent = '';
  $('#password-dialog').showModal();
});
$('#password-cancel').addEventListener('click', () => $('#password-dialog').close());
$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/me/password', formData(e.target));
    $('#password-msg').className = 'small ok';
    $('#password-msg').textContent = 'Senha alterada.';
    e.target.reset();
  } catch (err) {
    $('#password-msg').className = 'small error';
    $('#password-msg').textContent = err.message;
  }
});

// ------------------------------------------------------------------ navigation

function setView(view) {
  if (view === 'people' && !state.me.isAdmin) view = 'map';
  state.view = view;
  $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== view));
  stopPlayers();
  if (mapState.map) mapState.map.closePopup();
  if (view === 'map') renderMap();
  if (view === 'mosaic') renderMosaic();
  if (view === 'cameras') renderCameras();
  if (view === 'playback') renderPlaybackSelect();
  if (view === 'groups') renderGroups();
  if (view === 'people') renderPeople();
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

// Re-renders whatever screen is open after cameras change.
async function refreshView() {
  await refresh();
  if (state.view === 'map') renderMap();
  if (state.view === 'cameras') renderCameras();
}

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
  $$('[data-admin-only]').forEach((x) => (x.hidden = !state.me.isAdmin));
  $$('[data-can-add]').forEach((x) => (x.hidden = !state.me.canAddCameras));
  applyThemeButton();
  $('#auth').hidden = true;
  $('#app').hidden = false;
  await refresh();
  setView(state.view);
}

// Status refresh every 15 s without restarting video players or closing map popups.
setInterval(async () => {
  if ($('#app').hidden) return;
  const cams = await api('GET', '/api/cameras').catch(() => null);
  if (!cams) return;
  state.cameras = cams;
  if (state.view === 'cameras') renderCameras();
  if (state.view === 'map') updateMapStatus();
  for (const tile of $$('#mosaic .tile')) {
    const cam = cams.find((c) => c.id === Number(tile.dataset.id));
    if (cam) $('.dot', tile).className = `dot ${cam.status}`;
  }
}, 15000);

applyThemeButton();
boot();
