'use strict';

// Groups and (admin) people with their camera access.

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
        el('input', { name: 'login', placeholder: 'login do vizinho', required: true, autocapitalize: 'none' }),
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


// ------------------------------------------------------------------ people (admin)

let editingUser = null;
let accessUser = null;

async function renderPeople() {
  const list = $('#user-list');
  const people = await api('GET', '/api/users').catch((err) => (alert(err.message), []));
  list.replaceChildren(...people.map((u) => el('div', { class: 'item' },
    el('span', { class: 'avatar' }, u.name.slice(0, 1).toUpperCase()),
    el('div', { class: 'grow' },
      el('strong', {}, u.name), el('span', { class: 'muted small' }, ` · login: ${u.login}`),
      el('div', { class: 'muted small' },
        [u.isAdmin ? 'Administrador' : 'Usuário', u.canAddCameras && !u.isAdmin ? 'cadastra câmeras' : '',
          u.isAdmin ? 'vê todas as câmeras' : `${u.cameraCount} câmera(s) liberada(s)`].filter(Boolean).join(' · ')),
    ),
    u.isAdmin ? '' : el('button', { type: 'button', class: 'primary', onclick: () => openAccess(u) }, '📹 Câmeras liberadas'),
    el('button', { type: 'button', onclick: () => openUserEdit(u) }, 'Editar'),
    u.id === state.me.id ? '' : el('button', { type: 'button', class: 'danger', onclick: async () => {
      if (!confirm(`Excluir o acesso de ${u.name}?`)) return;
      try {
        await api('DELETE', `/api/users/${u.id}`);
        renderPeople();
      } catch (err) {
        alert(err.message);
      }
    } }, 'Excluir'),
  )));
}

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#user-form-error').textContent = '';
  try {
    const created = await api('POST', '/api/users', formData(e.target));
    e.target.reset();
    await renderPeople();
    if (!created.isAdmin) openAccess(created);
  } catch (err) {
    $('#user-form-error').textContent = err.message;
  }
});

function openUserEdit(u) {
  editingUser = u;
  const form = $('#user-edit-form');
  form.reset();
  $('#user-edit-error').textContent = '';
  $('#user-edit-login').textContent = u.login;
  form.name.value = u.name;
  form.isAdmin.checked = u.isAdmin;
  form.canAddCameras.checked = u.canAddCameras;
  $('#user-dialog').showModal();
}
$('#user-edit-cancel').addEventListener('click', () => $('#user-dialog').close());
$('#user-edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('PUT', `/api/users/${editingUser.id}`, formData(e.target));
    $('#user-dialog').close();
    renderPeople();
  } catch (err) {
    $('#user-edit-error').textContent = err.message;
  }
});

async function openAccess(u) {
  accessUser = u;
  $('#access-name').textContent = u.name;
  const rows = await api('GET', `/api/users/${u.id}/access`);
  $('#access-list').replaceChildren(
    rows.length ? '' : el('div', { class: 'muted small' }, 'Nenhuma câmera cadastrada no sistema ainda.'),
    ...rows.map((r) => el('div', { class: 'item', 'data-camera': r.id },
      el('label', { class: 'grow' },
        el('input', { type: 'checkbox', name: 'view', checked: r.granted || r.owned, disabled: r.owned }),
        ` ${r.name}`, el('span', { class: 'muted small' }, r.owned ? ' · é dela' : ` · de ${r.ownerName}`)),
      el('label', {}, el('input', { type: 'checkbox', name: 'playback', checked: r.canPlayback || r.owned, disabled: r.owned }), ' gravações'),
    )),
  );
  $('#access-dialog').showModal();
}
$('#access-cancel').addEventListener('click', () => $('#access-dialog').close());
$('#access-all').addEventListener('click', () => $$('#access-list input[name=view]:not([disabled])').forEach((c) => (c.checked = true)));
$('#access-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cameras = $$('#access-list [data-camera]')
    .filter((row) => {
      const view = $('input[name=view]', row);
      return view.checked && !view.disabled;
    })
    .map((row) => ({ cameraId: Number(row.dataset.camera), canPlayback: $('input[name=playback]', row).checked }));
  try {
    await api('PUT', `/api/users/${accessUser.id}/access`, { cameras });
    $('#access-dialog').close();
    renderPeople();
  } catch (err) {
    alert(err.message);
  }
});
