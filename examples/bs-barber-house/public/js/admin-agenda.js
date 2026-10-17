/* Aba Agenda: filtros, lista por dia e exportação em planilha. */
(() => {
  const { esc, brl } = BS;
  const $ = (id) => document.getElementById(id);
  let current = [];

  const quickRanges = {
    today: (t) => [t, t],
    tomorrow: (t) => [BS.addDays(t, 1), BS.addDays(t, 1)],
    week: (t) => [t, BS.addDays(t, 6)],
    next30: (t) => [t, BS.addDays(t, 30)],
    past30: (t) => [BS.addDays(t, -30), t],
  };

  function setQuick(key) {
    const [from, to] = quickRanges[key](Admin.today());
    $('fFrom').value = from;
    $('fTo').value = to;
    for (const b of $('agendaQuick').children) b.classList.toggle('active', b.dataset.quick === key);
  }

  function filtered() {
    const status = $('fStatus').value;
    const service = $('fService').value;
    const q = $('fSearch').value.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return current.filter((b) => (!status || b.status === status)
      && (!service || b.serviceId === service)
      && (!q || b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q)
        || (qDigits.length >= 3 && b.phone.includes(qDigits))));
  }

  function render() {
    const list = filtered();
    const done = list.filter((b) => b.status === 'concluido');
    const open = list.filter((b) => b.status === 'agendado');
    $('agendaSummary').innerHTML = `
      <span><strong>${list.length}</strong> agendamento(s)</span>
      <span><strong>${open.length}</strong> em aberto</span>
      <span>Recebido: <strong>${brl(done.reduce((s, b) => s + b.price, 0))}</strong></span>
      <span>Previsto: <strong>${brl(open.reduce((s, b) => s + b.price, 0))}</strong></span>`;

    if (!list.length) {
      $('agendaList').innerHTML = '<div class="empty">Nenhum agendamento encontrado com esses filtros.</div>';
      return;
    }
    const groups = new Map();
    for (const b of list) {
      if (!groups.has(b.date)) groups.set(b.date, []);
      groups.get(b.date).push(b);
    }
    $('agendaList').innerHTML = [...groups.entries()].map(([date, items]) => {
      const total = items.filter((b) => b.status !== 'cancelado' && b.status !== 'faltou').reduce((s, b) => s + b.price, 0);
      return `<div class="day-group">
        <h3 class="day-title">${esc(BS.fmtDateLong(date))}<span>${items.length} horário(s) · ${brl(total)}</span></h3>
        ${items.map((b) => Admin.card(b)).join('')}
      </div>`;
    }).join('');
  }

  async function load() {
    if (!$('fFrom').value) setQuick('today');
    if ($('fService').options.length === 1) {
      $('fService').insertAdjacentHTML('beforeend', Admin.state.cfg.services
        .map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join(''));
    }
    let from = $('fFrom').value;
    let to = $('fTo').value;
    if (from && to && from > to) [from, to] = [to, from];
    current = await Admin.bookings(from, to);
    render();
  }

  function exportCsv() {
    const list = filtered();
    if (!list.length) {
      BS.toast('Nada para exportar.', 'warn');
      return;
    }
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
    const rows = [['Data', 'Hora', 'Cliente', 'Telefone', 'Serviço', 'Valor', 'Status', 'Código', 'Observação']];
    for (const b of list) {
      rows.push([BS.ddmmyyyy(b.date), b.time, b.name, BS.fmtPhone(b.phone), b.serviceName,
        b.price.toFixed(2).replace('.', ','), Admin.STATUS_LABEL[b.status], b.code, b.notes]);
    }
    const csv = `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `agenda-bs-barber_${$('fFrom').value}_a_${$('fTo').value}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('agendaQuick').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-quick]');
    if (!b) return;
    setQuick(b.dataset.quick);
    Admin.refresh();
  });
  for (const id of ['fFrom', 'fTo']) {
    $(id).addEventListener('change', () => {
      for (const b of $('agendaQuick').children) b.classList.remove('active');
      Admin.refresh();
    });
  }
  for (const id of ['fStatus', 'fService']) $(id).addEventListener('change', render);
  $('fSearch').addEventListener('input', render);
  $('exportCsv').addEventListener('click', exportCsv);

  Admin.register('agenda', load);
})();
