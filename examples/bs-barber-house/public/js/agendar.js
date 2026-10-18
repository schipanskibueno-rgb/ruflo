/* Fluxo de agendamento do cliente: serviço → dia/horário → dados → comprovante. */
(async () => {
  const { esc, brl, fmtDuration, fmtDateLong, endTime, api } = BS;
  const $ = (id) => document.getElementById(id);

  const state = { service: null, date: null, time: null };
  let cfg;

  try {
    cfg = await BS.config();
  } catch (err) {
    $('serviceOptions').innerHTML = `<p class="slots-empty">${esc(err.message)}</p>`;
    return;
  }
  const byId = Object.fromEntries(cfg.services.map((s) => [s.id, s]));

  // ---------------------------------------------------------------- etapas
  function goTo(step) {
    for (const n of [1, 2, 3]) $(`step${n}`).hidden = n !== step;
    for (const li of $('stepper').children) {
      const n = Number(li.dataset.step);
      li.classList.toggle('active', n === step);
      li.classList.toggle('done', n < step);
    }
    if (step === 3) setTimeout(() => $('name').focus(), 50);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateSummary() {
    const s = state.service;
    $('sumService').textContent = s ? s.name : '—';
    $('sumDate').textContent = state.date ? fmtDateLong(state.date) : '—';
    $('sumTime').textContent = state.time ? `${state.time} às ${endTime(state.time, s.duration)}` : '—';
    $('sumPrice').textContent = s ? brl(s.price) : '—';
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) goTo(Number(go.dataset.go));
  });

  // -------------------------------------------------------------- serviços
  $('serviceOptions').innerHTML = cfg.services.map((s) => `
    <button type="button" class="opt" role="listitem" data-id="${esc(s.id)}">
      <strong>${esc(s.name)}</strong>
      <span class="opt-meta"><span class="opt-price">${brl(s.price)}</span><span>≈ ${fmtDuration(s.duration)}</span></span>
    </button>`).join('');

  $('serviceOptions').addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (btn) selectService(btn.dataset.id);
  });

  function selectService(id) {
    state.service = byId[id];
    state.time = null;
    for (const b of $('serviceOptions').children) b.classList.toggle('selected', b.dataset.id === id);
    updateSummary();
    goTo(2);
    if (!state.date) selectFirstAvailable();
    else loadSlots();
  }

  // ----------------------------------------------------------------- datas
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const lastDay = BS.addDays(cfg.today, cfg.bookingWindowDays);
  const isBookable = (d) => d >= cfg.today && d <= lastDay && cfg.hours.days.includes(BS.parseDate(d).getDay());

  function openDays() {
    const days = [];
    for (let d = cfg.today; d <= lastDay; d = BS.addDays(d, 1)) if (isBookable(d)) days.push(d);
    return days;
  }

  // Calendário mensal: mês atual com setas ▲ ▼ para trocar de mês.
  let view = BS.parseDate(cfg.today);
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
  const minMonth = monthKey(BS.parseDate(cfg.today));
  const maxMonth = monthKey(BS.parseDate(lastDay));

  function renderCalendar() {
    const y = view.getFullYear();
    const m = view.getMonth();
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay()); // começa no domingo
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = BS.isoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
      const other = BS.parseDate(d).getMonth() !== m;
      const cls = ['cal-day', other && 'other', d === cfg.today && 'today', d === state.date && 'selected'].filter(Boolean).join(' ');
      cells.push(`<button type="button" class="${cls}" data-date="${d}" ${isBookable(d) ? '' : 'disabled'}
        aria-label="${BS.fmtDateLong(d)}${isBookable(d) ? '' : ' (indisponível)'}">${Number(d.slice(8))}</button>`);
    }
    $('dateStrip').innerHTML = `
      <div class="cal-head">
        <strong>${MONTHS[m]} de ${y}</strong>
        <div class="cal-nav">
          <button type="button" data-month="-1" aria-label="Mês anterior" ${monthKey(view) <= minMonth ? 'disabled' : ''}>▲</button>
          <button type="button" data-month="1" aria-label="Próximo mês" ${monthKey(view) >= maxMonth ? 'disabled' : ''}>▼</button>
        </div>
      </div>
      <div class="cal-grid">
        ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((w) => `<span class="cal-wd">${w}</span>`).join('')}
        ${cells.join('')}
      </div>
      <p class="cal-note">Atendimento de segunda a sábado. Dias apagados não estão disponíveis.</p>`;
  }

  $('dateStrip').addEventListener('click', (e) => {
    const nav = e.target.closest('[data-month]');
    if (nav && !nav.disabled) {
      view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.month), 1);
      renderCalendar();
      return;
    }
    const btn = e.target.closest('.cal-day');
    if (btn && !btn.disabled) selectDate(btn.dataset.date);
  });

  function selectDate(date) {
    state.date = date;
    state.time = null;
    const d = BS.parseDate(date);
    view = new Date(d.getFullYear(), d.getMonth(), 1);
    renderCalendar();
    updateSummary();
    loadSlots();
  }

  /** Abre no primeiro dia que ainda tem horário livre (ex.: hoje já lotado). */
  async function selectFirstAvailable() {
    const days = openDays();
    for (const d of days.slice(0, 7)) {
      try {
        const { slots } = await api(`/api/availability?date=${d}&service=${encodeURIComponent(state.service.id)}`);
        if (slots.length) {
          selectDate(d);
          return;
        }
      } catch { break; }
    }
    selectDate(days[0]);
  }

  renderCalendar();

  // -------------------------------------------------------------- horários
  let slotsReq = 0;
  async function loadSlots() {
    const req = ++slotsReq;
    const box = $('slots');
    box.innerHTML = '<p class="loading">Buscando horários livres…</p>';
    try {
      const { slots } = await api(`/api/availability?date=${state.date}&service=${encodeURIComponent(state.service.id)}`);
      if (req !== slotsReq) return;
      if (!slots.length) {
        box.innerHTML = '<div class="slots-empty">Nenhum horário livre neste dia. 😕<br>Escolha outro dia acima.</div>';
        return;
      }
      const groups = [['Manhã', (t) => t < '12:00'], ['Tarde', (t) => t >= '12:00' && t < '18:00'], ['Noite', (t) => t >= '18:00']];
      box.innerHTML = groups.map(([label, test]) => {
        const list = slots.filter(test);
        if (!list.length) return '';
        return `<div class="slots-group"><h4>${label}</h4><div class="slot-list">
          ${list.map((t) => `<button type="button" class="slot" data-time="${t}">${t}</button>`).join('')}
        </div></div>`;
      }).join('');
    } catch (err) {
      if (req === slotsReq) box.innerHTML = `<div class="slots-empty">${esc(err.message)}</div>`;
    }
  }

  $('slots').addEventListener('click', (e) => {
    const btn = e.target.closest('.slot');
    if (!btn) return;
    state.time = btn.dataset.time;
    for (const b of $('slots').querySelectorAll('.slot')) b.classList.toggle('selected', b === btn);
    updateSummary();
    goTo(3);
  });

  // ----------------------------------------------------------------- dados
  BS.maskPhone($('phone'));
  const saved = BS.storage.get('bs-client');
  if (saved) {
    $('name').value = saved.name || '';
    $('phone').value = saved.phone || '';
  }

  $('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('name').value.trim();
    const phone = $('phone').value.trim();
    const digits = phone.replace(/\D/g, '');
    const error = $('formError');
    error.textContent = '';
    if (name.length < 2) { error.textContent = 'Informe seu nome.'; $('name').focus(); return; }
    if (digits.length < 10) { error.textContent = 'Informe um telefone com DDD. Ex.: (42) 99999-9999'; $('phone').focus(); return; }

    const btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Confirmando…';
    try {
      const booking = await api('/api/bookings', {
        method: 'POST',
        body: { serviceId: state.service.id, date: state.date, time: state.time, name, phone: digits, notes: $('notes').value },
      });
      BS.storage.set('bs-client', { name, phone });
      showDone(booking);
    } catch (err) {
      if (err.status === 409) {
        BS.toast(err.message, 'error');
        state.time = null;
        updateSummary();
        goTo(2);
        loadSlots();
      } else {
        error.textContent = err.message;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar agendamento';
    }
  });

  // ----------------------------------------------------------- comprovante
  function suggestionsFor(serviceId) {
    const offer = (id, text) => (byId[id] ? text.replace('{price}', brl(byId[id].price)) : null);
    const upsell = {
      cabelo: offer('cabelo-barba', 'Na próxima, experimente o combo <strong>Cabelo e Barba</strong> ({price}) e saia completo.'),
      barba: offer('barba-sobrancelha', 'Que tal alinhar a sobrancelha também? <strong>Barba + Sobrancelha</strong> por {price}.'),
      'cabelo-barba': offer('completo', 'Inclua a sobrancelha: <strong>Cabelo e Barba + Sobrancelha</strong> por {price}.'),
      'cabelo-sobrancelha': offer('completo', 'Quer sair completo? <strong>Cabelo e Barba + Sobrancelha</strong> por {price}.'),
      'barba-sobrancelha': offer('completo', 'Quer sair completo? <strong>Cabelo e Barba + Sobrancelha</strong> por {price}.'),
      completo: offer('hidratacao', 'Uma <strong>Hidratação Capilar</strong> ({price}) deixa os fios macios e o corte com mais caimento.'),
      'limpeza-pele': offer('barba', 'Combine com uma <strong>Barba</strong> bem feita ({price}) para um visual impecável.'),
      hidratacao: offer('selagem', 'Para fios rebeldes ou com volume, conheça a <strong>Desondulação (Selagem)</strong> por {price}.'),
      selagem: offer('hidratacao', 'Mantenha o resultado com uma <strong>Hidratação Capilar</strong> ({price}) a cada 15 dias.'),
    }[serviceId];
    const tips = ['Chegue com <strong>5 minutos de antecedência</strong> para ser atendido no horário certinho.'];
    if (/cabelo|barba|completo/.test(serviceId)) tips.push('Para manter o visual alinhado, o ideal é voltar a cada <strong>15 a 20 dias</strong>.');
    if (upsell) tips.push(upsell);
    tips.push('Imprevisto? Avise pelo WhatsApp com antecedência para remarcar sem problema.');
    return tips;
  }

  function gcalLink(b) {
    const start = `${b.date.replace(/-/g, '')}T${b.time.replace(':', '')}00`;
    const end = `${b.date.replace(/-/g, '')}T${endTime(b.time, b.duration).replace(':', '')}00`;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${b.serviceName} — BS Barber House`,
      dates: `${start}/${end}`,
      ctz: cfg.timezone,
      location: `${cfg.address}, ${cfg.city}`,
      details: `Código: ${b.code}\nValor: ${brl(b.price)}\nWhatsApp: ${cfg.phoneDisplay}`,
    });
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  function showDone(b) {
    $('bookingLayout').hidden = true;
    $('stepper').hidden = true;
    document.querySelector('.booking-head').hidden = true;
    $('done').hidden = false;

    $('tCode').textContent = b.code;
    $('tName').textContent = b.name;
    $('tPhone').textContent = BS.fmtPhone(b.phone);
    $('tService').textContent = b.serviceName;
    $('tDate').textContent = fmtDateLong(b.date);
    $('tTime').textContent = `${b.time} às ${endTime(b.time, b.duration)}`;
    $('tPrice').textContent = brl(b.price);
    $('tDuration').textContent = fmtDuration(b.duration);
    $('suggestions').innerHTML = suggestionsFor(b.serviceId).map((t) => `<li>${t}</li>`).join('');

    const msg = [
      'Olá! Acabei de agendar pelo site da *BS Barber House* ✂️',
      '',
      `*Código:* ${b.code}`,
      `*Nome:* ${b.name}`,
      `*Serviço:* ${b.serviceName} (${brl(b.price)})`,
      `*Data:* ${fmtDateLong(b.date)}`,
      `*Horário:* ${b.time}`,
      '',
      'Pode confirmar, por favor?',
    ].join('\n');
    $('waConfirm').href = BS.waLink(cfg.phone, msg);
    $('gcal').href = gcalLink(b);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- início
  updateSummary();
  const preselect = new URLSearchParams(location.search).get('servico');
  if (preselect && byId[preselect]) selectService(preselect);
  else goTo(1);
})();
