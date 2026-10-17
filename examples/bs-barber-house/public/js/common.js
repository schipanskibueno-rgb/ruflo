/* Utilitários compartilhados entre site, agendamento e painel. */
const BS = (() => {
  const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  async function api(path, opts = {}) {
    const o = { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}) } };
    if (o.body !== undefined && typeof o.body !== 'string') {
      o.body = JSON.stringify(o.body);
      o.headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(path, o);
    } catch {
      throw new Error('Sem conexão com o servidor. Verifique sua internet.');
    }
    let data = null;
    try { data = await res.json(); } catch { /* resposta vazia */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Algo deu errado. Tente novamente.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let configPromise;
  const config = () => (configPromise ||= api('/api/config'));

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (s, n) => {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return isoDate(d);
  };
  const weekday = (s) => WEEKDAYS[parseDate(s).getDay()];
  const ddmmyyyy = (s) => s.split('-').reverse().join('/');
  const fmtDateLong = (s) => `${weekday(s)}, ${ddmmyyyy(s)}`;
  const fmtDateShort = (s) => {
    const d = parseDate(s);
    return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
  };

  const toMin = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const endTime = (t, dur) => toHHMM(toMin(t) + dur);
  const fmtDuration = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`);

  function fmtPhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return raw || '';
  }

  /** Máscara (42) 99999-9999 enquanto digita. */
  function maskPhone(input) {
    input.addEventListener('input', () => {
      const d = input.value.replace(/\D/g, '').slice(0, 11);
      let v = d;
      if (d.length > 2) v = `(${d.slice(0, 2)}) ${d.slice(2)}`;
      if (d.length > 7) v = `(${d.slice(0, 2)}) ${d.slice(2, d.length === 11 ? 7 : 6)}-${d.slice(d.length === 11 ? 7 : 6)}`;
      input.value = v;
    });
  }

  const waNumber = (phone) => {
    const d = String(phone || '').replace(/\D/g, '');
    return d.startsWith('55') && d.length > 11 ? d : `55${d}`;
  };
  const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

  let toastTimer;
  function toast(msg, type = 'ok') {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.className = `toast ${type}`;
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  const storage = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ }
    },
  };

  return {
    api, config, esc, brl, parseDate, isoDate, addDays, weekday, ddmmyyyy, fmtDateLong, fmtDateShort,
    toMin, toHHMM, endTime, fmtDuration, fmtPhone, maskPhone, waLink, toast, storage, WEEKDAYS,
  };
})();
