/* Aba Painel: ganhos, gráfico, serviços mais procurados, agenda de hoje e pendências. */
(() => {
  const { esc, brl } = BS;
  const $ = (id) => document.getElementById(id);
  let period = 'month';

  function range() {
    const t = Admin.today();
    const d = BS.parseDate(t);
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    switch (period) {
      case 'today': return [t, t];
      case '7d': return [BS.addDays(t, -6), t];
      case 'lastmonth': return [
        BS.isoDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
        BS.isoDate(new Date(d.getFullYear(), d.getMonth(), 0)),
      ];
      case 'custom': return [$('dashFrom').value || t, $('dashTo').value || t];
      default: return [BS.isoDate(first), BS.isoDate(last)];
    }
  }

  function kpis(list) {
    const done = list.filter((b) => b.status === 'concluido');
    const sched = list.filter((b) => b.status === 'agendado');
    const revenue = done.reduce((s, b) => s + b.price, 0);
    const forecast = sched.reduce((s, b) => s + b.price, 0);
    const cancelled = list.filter((b) => b.status === 'cancelado').length;
    const noShow = list.filter((b) => b.status === 'faltou').length;
    const k = (label, value, sub, cls = '') => `<div class="kpi ${cls}"><small>${label}</small><strong>${value}</strong><span>${sub}</span></div>`;
    $('kpis').innerHTML = [
      k('Ganhos (recebido)', brl(revenue), `${done.length} atendimento(s) concluído(s)`, 'main'),
      k('Previsto', brl(forecast), `${sched.length} agendado(s) em aberto`),
      k('Total do período', brl(revenue + forecast), 'recebido + previsto'),
      k('Ticket médio', brl(done.length ? revenue / done.length : 0), 'por atendimento'),
      k('Cancelados / faltas', `${cancelled} / ${noShow}`, list.length ? `${Math.round(((cancelled + noShow) / list.length) * 100)}% do total` : '—'),
    ].join('');
  }

  function chart(list, from, to) {
    const days = [];
    for (let d = from; d <= to && days.length < 400; d = BS.addDays(d, 1)) days.push(d);
    const byMonth = days.length > 62;
    const buckets = new Map();
    for (const d of days) {
      const key = byMonth ? d.slice(0, 7) : d;
      if (!buckets.has(key)) buckets.set(key, { done: 0, fore: 0 });
    }
    for (const b of list) {
      const bucket = buckets.get(byMonth ? b.date.slice(0, 7) : b.date);
      if (!bucket) continue;
      if (b.status === 'concluido') bucket.done += b.price;
      if (b.status === 'agendado') bucket.fore += b.price;
    }
    const max = Math.max(...[...buckets.values()].map((v) => v.done + v.fore), 0);
    if (!max) {
      $('chart').innerHTML = '<div class="chart-empty">Sem valores neste período ainda.</div>';
      return;
    }
    const entries = [...buckets.entries()];
    const every = Math.ceil(entries.length / 16);
    $('chart').innerHTML = entries.map(([key, v], i) => {
      const label = byMonth ? `${key.slice(5)}/${key.slice(2, 4)}` : key.slice(8);
      const title = `${byMonth ? label : BS.ddmmyyyy(key)} — Recebido ${brl(v.done)} · Previsto ${brl(v.fore)}`;
      return `<div class="bar" title="${esc(title)}">
        ${v.done ? `<div class="seg-done" style="height:${(v.done / max) * 100}%"></div>` : ''}
        ${v.fore ? `<div class="seg-fore" style="height:${(v.fore / max) * 100}%"></div>` : ''}
        ${i % every === 0 ? `<label>${label}</label>` : ''}
      </div>`;
    }).join('');
  }

  function topServices(list) {
    const stats = new Map();
    for (const b of list) {
      if (b.status === 'cancelado') continue;
      const s = stats.get(b.serviceName) || { count: 0, total: 0 };
      s.count += 1;
      if (b.status === 'concluido') s.total += b.price;
      stats.set(b.serviceName, s);
    }
    const rows = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
    if (!rows.length) {
      $('topServices').innerHTML = '<p class="muted">Nenhum atendimento no período.</p>';
      return;
    }
    const max = rows[0][1].count;
    $('topServices').innerHTML = rows.map(([name, s]) => `
      <div class="top-row">
        <strong>${esc(name)}</strong><span>${s.count}× · ${brl(s.total)}</span>
        <div class="meter"><i style="width:${(s.count / max) * 100}%"></i></div>
      </div>`).join('');
  }

  async function load() {
    const [from, to] = range();
    const t = Admin.today();
    const [list, todayList, recent] = await Promise.all([
      Admin.bookings(from, to),
      Admin.bookings(t, t),
      Admin.bookings(BS.addDays(t, -60), t),
    ]);
    kpis(list);
    chart(list, from, to);
    topServices(list);

    $('todayLabel').textContent = BS.fmtDateLong(t);
    const active = todayList.filter((b) => b.status !== 'cancelado');
    $('todayList').innerHTML = active.length
      ? active.map((b) => Admin.card(b)).join('')
      : '<div class="empty">Nenhum atendimento hoje. Bora divulgar o link de agendamento! 💈</div>';

    const now = Admin.nowHHMM();
    const pending = recent.filter((b) => b.status === 'agendado'
      && (b.date < t || (b.date === t && BS.endTime(b.time, b.duration) <= now)));
    $('pendingPanel').hidden = !pending.length;
    $('pendingList').innerHTML = pending.map((b) => Admin.card(b, { showDate: true })).join('');
  }

  $('periodChips').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-period]');
    if (!b) return;
    period = b.dataset.period;
    for (const x of $('periodChips').children) x.classList.toggle('active', x === b);
    $('customRange').hidden = period !== 'custom';
    if (period === 'custom') {
      const [from, to] = range();
      if (!$('dashFrom').value) $('dashFrom').value = from;
      if (!$('dashTo').value) $('dashTo').value = to;
    }
    Admin.refresh();
  });
  $('dashApply').addEventListener('click', () => Admin.refresh());

  Admin.register('painel', load);
})();
