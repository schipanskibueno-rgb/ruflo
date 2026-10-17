/* Painel: login, abas, cartões de agendamento, ações e janelas (modais). */
const Admin = (() => {
  const { esc, brl, api, fmtDateLong, endTime } = BS;
  const $ = (id) => document.getElementById(id);
  const STATUS_LABEL = { agendado: 'Agendado', concluido: 'Concluído', cancelado: 'Cancelado', faltou: 'Faltou' };
  const state = { cfg: null, tab: 'painel', loaders: {}, byId: new Map() };

  const today = () => BS.isoDate(new Date());
  const nowHHMM = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // ------------------------------------------------------------------ API
  async function call(path, opts) {
    try {
      return await api(path, opts);
    } catch (err) {
      if (err.status === 401) showLogin();
      throw err;
    }
  }

  async function bookings(from, to) {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const list = await call(`/api/admin/bookings?${q}`);
    for (const b of list) state.byId.set(b.id, b);
    return list;
  }

  // -------------------------------------------------------- login / abas
  function showLogin() {
    $('appView').hidden = true;
    $('loginView').hidden = false;
    $('password').value = '';
    setTimeout(() => $('password').focus(), 50);
  }

  async function showApp() {
    $('loginView').hidden = true;
    $('appView').hidden = false;
    const me = await api('/api/admin/me');
    $('defaultPwAlert').hidden = !me.defaultPassword;
    switchTab((location.hash || '#painel').slice(1));
  }

  function switchTab(tab) {
    if (!state.loaders[tab]) tab = 'painel';
    state.tab = tab;
    for (const b of $('tabs').children) b.classList.toggle('active', b.dataset.tab === tab);
    for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${tab}`;
    history.replaceState(null, '', `#${tab}`);
    refresh();
  }

  function refresh() {
    const loader = state.loaders[state.tab];
    if (loader) loader().catch((err) => BS.toast(err.message, 'error'));
  }

  // ---------------------------------------------------------- cartões
  function waMessage(b, kind) {
    const when = `${fmtDateLong(b.date)} às ${b.time}`;
    const first = b.name.split(' ')[0];
    if (kind === 'cancel') return `Olá, ${first}! Aqui é da BS Barber House. Infelizmente precisamos cancelar seu horário de ${when} (${b.serviceName}). Quer remarcar? É só responder esta mensagem ou agendar em ${location.origin}/agendar`;
    if (kind === 'resched') return `Olá, ${first}! Aqui é da BS Barber House. Seu horário (${b.serviceName}) foi remarcado para *${when}*. Qualquer coisa, é só chamar!`;
    return `Olá, ${first}! Aqui é da BS Barber House. Passando para confirmar seu horário: *${when}* — ${b.serviceName}. Te esperamos!`;
  }

  function actionsFor(b) {
    const a = (act, label, cls = '') => `<button class="act ${cls}" data-act="${act}">${label}</button>`;
    const wa = `<a class="act wa" href="${esc(BS.waLink(b.phone, waMessage(b)))}" target="_blank" rel="noopener">WhatsApp</a>`;
    if (b.status === 'agendado') {
      return a('concluir', '✓ Concluir', 'ok') + a('remarcar', '↻ Remarcar') + a('faltou', 'Faltou', 'warn') + a('cancelar', '✕ Cancelar', 'danger') + wa + a('detalhes', '⋯');
    }
    if (b.status === 'concluido') return a('reabrir', '↶ Desfazer') + wa + a('detalhes', '⋯');
    return a('reabrir', '↶ Reativar') + a('remarcar', '↻ Remarcar') + wa + a('detalhes', '⋯');
  }

  function card(b, { showDate = false } = {}) {
    return `<div class="bk st-${b.status}" data-id="${esc(b.id)}">
      <div class="bk-time"><strong>${esc(b.time)}</strong><span>até ${esc(endTime(b.time, b.duration))}</span>
        ${showDate ? `<span>${esc(BS.fmtDateShort(b.date))}</span>` : ''}</div>
      <div class="bk-info">
        <strong>${esc(b.name)}</strong> <span class="status ${b.status}">${STATUS_LABEL[b.status]}</span>
        <div class="line"><span>${esc(b.serviceName)}</span><span>${brl(b.price)}</span><span>${esc(BS.fmtPhone(b.phone))}</span><span>#${esc(b.code)}</span></div>
        ${b.notes ? `<div class="note">“${esc(b.notes)}”</div>` : ''}
      </div>
      <div class="bk-actions">${actionsFor(b)}</div>
    </div>`;
  }

  async function patch(b, body, msg) {
    const updated = await call(`/api/admin/bookings/${encodeURIComponent(b.id)}`, { method: 'PATCH', body });
    state.byId.set(updated.id, updated);
    if (msg) BS.toast(msg);
    refresh();
    return updated;
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const b = state.byId.get(btn.closest('[data-id]')?.dataset.id);
    if (!b) return;
    btn.disabled = true;
    try {
      switch (btn.dataset.act) {
        case 'concluir': await patch(b, { status: 'concluido' }, `Concluído! ${brl(b.price)} entrou nos ganhos.`); break;
        case 'faltou': await patch(b, { status: 'faltou' }, 'Marcado como falta.'); break;
        case 'reabrir': await patch(b, { status: 'agendado' }, 'Agendamento reaberto.'); break;
        case 'cancelar': confirmCancel(b); break;
        case 'remarcar': openReschedule(b); break;
        case 'detalhes': openDetails(b); break;
        default: break;
      }
    } catch (err) {
      BS.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------- modal
  const modal = $('modal');
  function openModal(html) {
    $('modalBody').innerHTML = html;
    if (!modal.open) modal.showModal();
  }
  const closeModal = () => modal.close();
  $('modalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  function summaryLine(b) {
    return `<p><strong>${esc(b.name)}</strong> — ${esc(b.serviceName)}<br><span class="muted">${esc(fmtDateLong(b.date))} às ${esc(b.time)}</span></p>`;
  }

  function confirmCancel(b) {
    openModal(`<h2>Cancelar agendamento?</h2>${summaryLine(b)}
      <div class="modal-actions">
        <button class="btn btn-ghost" id="mNo">Voltar</button>
        <button class="btn btn-danger" id="mYes">Cancelar</button>
        <a class="btn btn-wa" id="mYesWa" target="_blank" rel="noopener" href="${esc(BS.waLink(b.phone, waMessage(b, 'cancel')))}">Cancelar e avisar no WhatsApp</a>
      </div>`);
    $('mNo').onclick = closeModal;
    const doCancel = async () => {
      try {
        await patch(b, { status: 'cancelado' }, 'Agendamento cancelado.');
        closeModal();
      } catch (err) { BS.toast(err.message, 'error'); }
    };
    $('mYes').onclick = doCancel;
    $('mYesWa').addEventListener('click', doCancel);
  }

  /** Seletor de horários livres + campo manual. Chama onChange(time). */
  async function slotPicker(box, { serviceId, date, exclude, onChange }) {
    box.innerHTML = '<p class="muted small">Carregando horários…</p>';
    const q = new URLSearchParams({ date, service: serviceId });
    if (exclude) q.set('exclude', exclude);
    try {
      const { slots, open } = await call(`/api/availability?${q}`);
      if (!open) box.innerHTML = '<p class="muted small">A barbearia não abre neste dia.</p>';
      else if (!slots.length) box.innerHTML = '<p class="muted small">Nenhum horário livre na grade. Use o campo “outro horário”.</p>';
      else box.innerHTML = slots.map((t) => `<button type="button" data-t="${t}">${t}</button>`).join('');
    } catch (err) {
      box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
    box.onclick = (e) => {
      const t = e.target.closest('button[data-t]');
      if (!t) return;
      for (const x of box.children) x.classList.toggle('selected', x === t);
      onChange(t.dataset.t);
    };
  }

  function openReschedule(b) {
    let time = null;
    const minDate = today();
    openModal(`<h2>Remarcar</h2>${summaryLine(b)}
      <div class="field"><label for="rDate">Nova data</label><input type="date" class="input" id="rDate" min="${minDate}" value="${b.date >= minDate ? b.date : minDate}"></div>
      <label class="small muted">Horários livres</label>
      <div class="slot-pick" id="rSlots"></div>
      <div class="field"><label for="rTime">Ou outro horário</label><input type="time" class="input" id="rTime"></div>
      <p class="form-error" id="rErr"></p>
      <div class="modal-actions"><button class="btn btn-ghost" id="rCancel">Voltar</button><button class="btn btn-gold" id="rSave">Salvar novo horário</button></div>`);
    const load = () => slotPicker($('rSlots'), {
      serviceId: b.serviceId, date: $('rDate').value, exclude: b.id,
      onChange: (t) => { time = t; $('rTime').value = t; },
    });
    $('rDate').onchange = () => { time = null; $('rTime').value = ''; load(); };
    $('rTime').oninput = () => { time = $('rTime').value; for (const x of $('rSlots').children) x.classList?.remove('selected'); };
    $('rCancel').onclick = closeModal;
    $('rSave').onclick = async () => {
      if (!time) { $('rErr').textContent = 'Escolha um horário.'; return; }
      try {
        const updated = await patch(b, { date: $('rDate').value, time }, 'Horário remarcado!');
        openModal(`<h2>✓ Remarcado</h2>${summaryLine(updated)}
          <p class="muted small">Quer avisar o cliente?</p>
          <div class="modal-actions"><button class="btn btn-ghost" id="mOk">Fechar</button>
          <a class="btn btn-wa" target="_blank" rel="noopener" href="${esc(BS.waLink(updated.phone, waMessage(updated, 'resched')))}">Avisar no WhatsApp</a></div>`);
        $('mOk').onclick = closeModal;
      } catch (err) { $('rErr').textContent = err.message; }
    };
    load();
  }

  function openDetails(b) {
    const hist = (b.history || []).map((h) => `<li>${esc(new Date(h.at).toLocaleString('pt-BR'))} — ${esc(h.action)}${h.to ? `: ${esc(h.from)} → ${esc(h.to)}` : ''}</li>`).join('');
    openModal(`<h2>Detalhes</h2>${summaryLine(b)}
      <p class="small muted">Código #${esc(b.code)} · ${esc(BS.fmtPhone(b.phone))} · origem: ${esc(b.source || 'site')} · criado em ${esc(new Date(b.createdAt).toLocaleString('pt-BR'))}</p>
      <div class="row-2">
        <div class="field"><label for="dPrice">Valor cobrado (R$)</label><input type="number" min="0" step="0.01" class="input" id="dPrice" value="${b.price}"></div>
        <div class="field"><label>Status</label><div><span class="status ${b.status}">${STATUS_LABEL[b.status]}</span></div></div>
      </div>
      <div class="field"><label for="dNotes">Observações</label><textarea class="input" id="dNotes" maxlength="200">${esc(b.notes)}</textarea></div>
      ${hist ? `<label class="small muted">Histórico</label><ul class="history">${hist}</ul>` : ''}
      <p class="form-error" id="dErr"></p>
      <div class="modal-actions"><button class="btn btn-ghost" id="dClose">Fechar</button><button class="btn btn-gold" id="dSave">Salvar</button></div>`);
    $('dClose').onclick = closeModal;
    $('dSave').onclick = async () => {
      try {
        await patch(b, { price: $('dPrice').value, notes: $('dNotes').value }, 'Alterações salvas.');
        closeModal();
      } catch (err) { $('dErr').textContent = err.message; }
    };
  }

  function openNewBooking() {
    let time = null;
    const opts = state.cfg.services.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} — ${brl(s.price)}</option>`).join('');
    openModal(`<h2>Novo agendamento</h2>
      <p class="muted small">Para clientes que marcaram por telefone ou chegaram sem horário.</p>
      <div class="field"><label for="nService">Serviço</label><select class="input" id="nService">${opts}</select></div>
      <div class="field"><label for="nDate">Data</label><input type="date" class="input" id="nDate" value="${today()}"></div>
      <label class="small muted">Horários livres</label>
      <div class="slot-pick" id="nSlots"></div>
      <div class="field"><label for="nTime">Ou outro horário</label><input type="time" class="input" id="nTime" value="${nowHHMM()}"></div>
      <div class="row-2">
        <div class="field"><label for="nName">Nome</label><input class="input" id="nName" maxlength="60"></div>
        <div class="field"><label for="nPhone">Telefone</label><input class="input" id="nPhone" type="tel" placeholder="(42) 99999-9999"></div>
      </div>
      <div class="field"><label for="nNotes">Observação</label><input class="input" id="nNotes" maxlength="200"></div>
      <p class="form-error" id="nErr"></p>
      <div class="modal-actions"><button class="btn btn-ghost" id="nCancel">Cancelar</button><button class="btn btn-gold" id="nSave">Agendar</button></div>`);
    BS.maskPhone($('nPhone'));
    time = $('nTime').value;
    const load = () => slotPicker($('nSlots'), {
      serviceId: $('nService').value, date: $('nDate').value,
      onChange: (t) => { time = t; $('nTime').value = t; },
    });
    $('nService').onchange = load;
    $('nDate').onchange = load;
    $('nTime').oninput = () => { time = $('nTime').value; };
    $('nCancel').onclick = closeModal;
    $('nSave').onclick = async () => {
      try {
        await call('/api/admin/bookings', {
          method: 'POST',
          body: {
            serviceId: $('nService').value, date: $('nDate').value, time,
            name: $('nName').value, phone: $('nPhone').value, notes: $('nNotes').value,
          },
        });
        closeModal();
        BS.toast('Agendamento criado!');
        refresh();
      } catch (err) { $('nErr').textContent = err.message; }
    };
    load();
  }

  // -------------------------------------------------------------- início
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: $('password').value } });
      await showApp();
    } catch (err) {
      $('loginError').textContent = err.message;
    }
  });
  $('pwToggle').addEventListener('click', () => {
    const pw = $('password');
    pw.type = pw.type === 'password' ? 'text' : 'password';
  });
  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST', body: {} }).catch(() => {});
    showLogin();
  });
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });
  $('newBookingBtn').addEventListener('click', openNewBooking);
  $('fabNew').addEventListener('click', openNewBooking);

  async function init() {
    try {
      state.cfg = await BS.config();
      const me = await api('/api/admin/me');
      if (me.authed) await showApp();
      else showLogin();
    } catch (err) {
      document.body.innerHTML = `<p class="empty" style="margin:40px">${esc(err.message)}</p>`;
    }
  }
  // Os demais scripts registram suas abas antes do init rodar.
  setTimeout(init, 0);

  return {
    state, call, bookings, card, today, nowHHMM, refresh, openModal, closeModal, STATUS_LABEL,
    register: (tab, loader) => { state.loaders[tab] = loader; },
  };
})();
