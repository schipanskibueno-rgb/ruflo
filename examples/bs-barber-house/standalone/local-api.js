/*
 * Versão HTML (sem servidor): substitui BS.api por um "servidor" que roda no
 * próprio navegador e guarda os dados no localStorage. Mesmas rotas e regras
 * do server.js, para que as páginas funcionem sem nenhuma alteração.
 */
(() => {
  // Troque a senha do painel aqui.
  const ADMIN_PASSWORD = 'bsbarber2026';
  const DEFAULT_PASSWORD = 'bsbarber2026';

  const CFG = __CONFIG__;
  const DB_KEY = 'bs-barber-db-v1';
  const SESSION_KEY = 'bs-barber-admin';
  const ACTIVE = new Set(['agendado', 'concluido']);
  const STATUSES = ['agendado', 'concluido', 'cancelado', 'faltou'];

  // ------------------------------------------------------------- armazenamento
  function load() {
    try {
      return { bookings: [], blocks: [], gallery: [], ...JSON.parse(localStorage.getItem(DB_KEY) || '{}') };
    } catch {
      return { bookings: [], blocks: [], gallery: [] };
    }
  }
  let db = load();
  function save() {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch {
      db = load();
      fail(507, 'Sem espaço no navegador. Exclua algumas fotos da galeria e tente de novo.');
    }
  }
  // Outra aba alterou os dados: recarrega.
  window.addEventListener('storage', (e) => { if (e.key === DB_KEY) db = load(); });

  function fail(status, message) {
    const err = new Error(message);
    err.status = status;
    throw err;
  }
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  function code() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return [...bytes].map((b) => chars[b % chars.length]).join('');
  }

  // -------------------------------------------------------------------- agenda
  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

  function nowLocal() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: CFG.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type).value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
  }
  function weekday(date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  function addDays(date, n) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  const isOpenDay = (date) => CFG.hours.days.includes(weekday(date));

  function busy(date, excludeId) {
    const out = [];
    for (const b of db.bookings) {
      if (b.date === date && ACTIVE.has(b.status) && b.id !== excludeId) out.push([toMin(b.time), toMin(b.time) + b.duration]);
    }
    for (const bl of db.blocks) if (bl.date === date) out.push([toMin(bl.start), toMin(bl.end)]);
    return out;
  }

  function freeSlots(date, duration, excludeId) {
    if (!isOpenDay(date)) return [];
    const now = nowLocal();
    if (date < now.date) return [];
    const taken = busy(date, excludeId);
    const slots = [];
    for (let s = toMin(CFG.hours.open); s + duration <= toMin(CFG.hours.close); s += CFG.slotStep) {
      if (date === now.date && s <= now.minutes) continue;
      if (!taken.some(([a, b]) => overlaps(s, s + duration, a, b))) slots.push(toHHMM(s));
    }
    return slots;
  }

  function placementError(date, time, duration, excludeId) {
    const s = toMin(time);
    const e = s + duration;
    if (!isOpenDay(date)) return 'A barbearia não abre neste dia.';
    if (s < toMin(CFG.hours.open) || e > toMin(CFG.hours.close)) return `Fora do horário de funcionamento (${CFG.hours.open} às ${CFG.hours.close}).`;
    if (busy(date, excludeId).some(([a, b]) => overlaps(s, e, a, b))) return 'Esse horário conflita com outro agendamento ou bloqueio.';
    return null;
  }

  // ---------------------------------------------------------------- validação
  function requireDate(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(400, 'Data inválida.');
    const [y, m, day] = d.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) fail(400, 'Data inválida.');
    return d;
  }
  function requireTime(t) {
    if (typeof t !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) fail(400, 'Horário inválido.');
    return t;
  }
  function requireService(id) {
    return CFG.services.find((s) => s.id === id) || fail(400, 'Serviço inválido.');
  }
  const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  function createBooking(input, admin) {
    const service = requireService(input.serviceId);
    const date = requireDate(input.date);
    const time = requireTime(input.time);
    const name = cleanText(input.name, 60);
    if (name.length < 2) fail(400, 'Informe seu nome.');
    const phone = String(input.phone ?? '').replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 13) fail(400, 'Informe um telefone/WhatsApp válido com DDD.');
    if (admin) {
      const err = placementError(date, time, service.duration);
      if (err) fail(409, err);
    } else {
      if (date > addDays(nowLocal().date, CFG.bookingWindowDays)) fail(400, `Agendamentos são liberados para os próximos ${CFG.bookingWindowDays} dias.`);
      if (!freeSlots(date, service.duration).includes(time)) fail(409, 'Esse horário acabou de ser ocupado. Por favor, escolha outro.');
    }
    const booking = {
      id: uid(), code: code(), serviceId: service.id, serviceName: service.name, price: service.price,
      duration: service.duration, date, time, name, phone, notes: cleanText(input.notes, 200),
      status: 'agendado', source: admin ? 'painel' : 'site', createdAt: new Date().toISOString(), history: [],
    };
    db.bookings.push(booking);
    save();
    return booking;
  }

  function updateBooking(id, patch) {
    const b = db.bookings.find((x) => x.id === id) || fail(404, 'Agendamento não encontrado.');
    const before = clone(b);
    const at = new Date().toISOString();
    try {
      if (patch.date !== undefined || patch.time !== undefined) {
        const date = requireDate(patch.date);
        const time = requireTime(patch.time);
        const err = placementError(date, time, b.duration, b.id);
        if (err) fail(409, err);
        b.history.push({ at, action: 'remarcado', from: `${b.date} ${b.time}`, to: `${date} ${time}` });
        Object.assign(b, { date, time, status: 'agendado' });
      }
      if (patch.status !== undefined) {
        if (!STATUSES.includes(patch.status)) fail(400, 'Status inválido.');
        if (patch.status === 'agendado' && b.status !== 'agendado') {
          const err = placementError(b.date, b.time, b.duration, b.id);
          if (err) fail(409, err);
        }
        if (patch.status !== b.status) {
          b.history.push({ at, action: patch.status, from: b.status });
          b.status = patch.status;
        }
      }
      if (patch.notes !== undefined) b.notes = cleanText(patch.notes, 200);
      if (patch.price !== undefined) {
        const price = Number(patch.price);
        if (!Number.isFinite(price) || price < 0 || price > 10000) fail(400, 'Valor inválido.');
        b.price = Math.round(price * 100) / 100;
      }
      save();
    } catch (err) {
      Object.assign(b, before);
      throw err;
    }
    return b;
  }

  // ---------------------------------------------------------------- sessão
  async function sha256(text) {
    if (!crypto.subtle) return text;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const isAuthed = () => {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; }
  };
  function requireAuth() {
    if (!isAuthed()) fail(401, 'Faça login para continuar.');
  }

  // ------------------------------------------------------------------ rotas
  async function api(path, opts = {}) {
    const url = new URL(path, 'http://local');
    const p = url.pathname;
    const q = url.searchParams;
    const m = (opts.method || 'GET').toUpperCase();
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || {});
    const tail = (prefix) => (p.startsWith(prefix) ? decodeURIComponent(p.slice(prefix.length)) : null);

    if (m === 'GET' && p === '/api/config') return clone({ ...CFG, today: nowLocal().date });
    if (m === 'GET' && p === '/api/availability') {
      const date = requireDate(q.get('date'));
      const service = requireService(q.get('service'));
      const exclude = isAuthed() ? q.get('exclude') || undefined : undefined;
      return { date, open: isOpenDay(date), slots: freeSlots(date, service.duration, exclude) };
    }
    if (m === 'POST' && p === '/api/bookings') {
      const b = createBooking(body, false);
      return clone({ code: b.code, serviceId: b.serviceId, serviceName: b.serviceName, price: b.price, duration: b.duration, date: b.date, time: b.time, name: b.name, phone: b.phone, status: b.status });
    }
    if (m === 'GET' && p === '/api/gallery') return db.gallery.map((g) => ({ id: g.id, url: g.image, caption: g.caption }));

    if (m === 'POST' && p === '/api/admin/login') {
      if ((await sha256(String(body.password || ''))) !== (await sha256(ADMIN_PASSWORD))) fail(401, 'Senha incorreta.');
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* sem sessão */ }
      return { ok: true };
    }
    if (m === 'POST' && p === '/api/admin/logout') {
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ok */ }
      return { ok: true };
    }
    if (m === 'GET' && p === '/api/admin/me') return { authed: isAuthed(), defaultPassword: ADMIN_PASSWORD === DEFAULT_PASSWORD };

    requireAuth();
    if (m === 'GET' && p === '/api/admin/bookings') {
      const from = q.get('from');
      const to = q.get('to');
      return clone(db.bookings.filter((b) => (!from || b.date >= from) && (!to || b.date <= to))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
    }
    if (m === 'POST' && p === '/api/admin/bookings') return clone(createBooking(body, true));
    if (m === 'PATCH' && tail('/api/admin/bookings/')) return clone(updateBooking(tail('/api/admin/bookings/'), body));

    if (m === 'GET' && p === '/api/admin/blocks') {
      const today = nowLocal().date;
      return clone(db.blocks.filter((b) => b.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)));
    }
    if (m === 'POST' && p === '/api/admin/blocks') {
      const date = requireDate(body.date);
      const allDay = Boolean(body.allDay);
      const start = allDay ? CFG.hours.open : requireTime(body.start);
      const end = allDay ? CFG.hours.close : requireTime(body.end);
      if (toMin(end) <= toMin(start)) fail(400, 'O horário final deve ser depois do inicial.');
      const block = { id: uid(), date, start, end, allDay, reason: cleanText(body.reason, 80) };
      const conflicts = db.bookings.filter((b) => b.date === date && b.status === 'agendado'
        && overlaps(toMin(b.time), toMin(b.time) + b.duration, toMin(start), toMin(end))).length;
      db.blocks.push(block);
      save();
      return clone({ block, conflicts });
    }
    if (m === 'DELETE' && tail('/api/admin/blocks/')) {
      const id = tail('/api/admin/blocks/');
      if (!db.blocks.some((b) => b.id === id)) fail(404, 'Bloqueio não encontrado.');
      db.blocks = db.blocks.filter((b) => b.id !== id);
      save();
      return { ok: true };
    }

    if (m === 'POST' && p === '/api/admin/gallery') {
      const image = String(body.image || '');
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) fail(400, 'Envie uma imagem JPG, PNG ou WEBP.');
      const photo = { id: uid(), image, caption: cleanText(body.caption, 60), createdAt: new Date().toISOString() };
      db.gallery.unshift(photo);
      try {
        save();
      } catch (err) {
        db.gallery = db.gallery.filter((g) => g.id !== photo.id);
        throw err;
      }
      return { id: photo.id, url: photo.image, caption: photo.caption };
    }
    if (m === 'DELETE' && tail('/api/admin/gallery/')) {
      const id = tail('/api/admin/gallery/');
      if (!db.gallery.some((g) => g.id === id)) fail(404, 'Foto não encontrada.');
      db.gallery = db.gallery.filter((g) => g.id !== id);
      save();
      return { ok: true };
    }

    fail(404, 'Rota não encontrada.');
  }

  BS.api = api;
  BS.config = () => api('/api/config');
  // Link de agendamento para mensagens de WhatsApp (só quando o arquivo está publicado num site).
  BS.bookingLine = () => (location.protocol.startsWith('http') ? ` Ou agende pelo site: ${location.href.split('#')[0]}#/agendar` : '');
})();
