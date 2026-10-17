/* Abas Clientes, Bloqueios e Galeria. */
(() => {
  const { esc, brl } = BS;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------- clientes
  let clients = [];

  function daysBetween(a, b) {
    return Math.round((BS.parseDate(b) - BS.parseDate(a)) / 86400000);
  }

  function renderClients() {
    const q = $('clientSearch').value.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const list = clients.filter((c) => !q || c.name.toLowerCase().includes(q) || (qDigits.length >= 3 && c.phone.includes(qDigits)));
    if (!list.length) {
      $('clientList').innerHTML = '<div class="empty">Nenhum cliente encontrado.</div>';
      return;
    }
    const t = Admin.today();
    $('clientList').innerHTML = list.map((c) => {
      const away = c.lastVisit && !c.next && daysBetween(c.lastVisit, t) > 30;
      const first = c.name.split(' ')[0];
      const msg = away
        ? `Olá, ${first}! Sentimos sua falta aqui na BS Barber House 💈 Bora dar um trato no visual? Agende em ${location.origin}/agendar`
        : `Olá, ${first}! Aqui é da BS Barber House.`;
      return `<div class="client">
        <div>
          <strong>${esc(c.name)}</strong>${away ? '<span class="badge-away">sumido</span>' : ''}
          <div class="line">
            <span>${esc(BS.fmtPhone(c.phone))}</span>
            <span>${c.visits} visita(s)</span>
            <span>Gasto total: ${brl(c.spent)}</span>
            <span>Última visita: ${c.lastVisit ? `${esc(BS.ddmmyyyy(c.lastVisit))} (há ${daysBetween(c.lastVisit, t)} dias)` : '—'}</span>
            ${c.next ? `<span>Próximo: ${esc(BS.ddmmyyyy(c.next.date))} ${esc(c.next.time)}</span>` : ''}
            ${c.noShows ? `<span>Faltas: ${c.noShows}</span>` : ''}
          </div>
        </div>
        <a class="act wa" href="${esc(BS.waLink(c.phone, msg))}" target="_blank" rel="noopener">WhatsApp</a>
      </div>`;
    }).join('');
  }

  async function loadClients() {
    const all = await Admin.bookings();
    const t = Admin.today();
    const map = new Map();
    for (const b of all) {
      const c = map.get(b.phone) || { phone: b.phone, name: b.name, visits: 0, spent: 0, lastVisit: null, next: null, noShows: 0, lastSeen: '' };
      c.name = b.name;
      if (b.status === 'concluido') {
        c.visits += 1;
        c.spent += b.price;
        if (!c.lastVisit || b.date > c.lastVisit) c.lastVisit = b.date;
      }
      if (b.status === 'faltou') c.noShows += 1;
      if (b.status === 'agendado' && b.date >= t && (!c.next || b.date + b.time < c.next.date + c.next.time)) c.next = b;
      if (b.date > c.lastSeen) c.lastSeen = b.date;
      map.set(b.phone, c);
    }
    clients = [...map.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    renderClients();
  }

  $('clientSearch').addEventListener('input', renderClients);
  Admin.register('clientes', loadClients);

  // ------------------------------------------------------------ bloqueios
  async function loadBlocks() {
    if (!$('bDate').value) $('bDate').value = Admin.today();
    const blocks = await Admin.call('/api/admin/blocks');
    $('blockList').innerHTML = blocks.length
      ? blocks.map((b) => `<div class="block-item">
          <div><strong>${esc(BS.fmtDateLong(b.date))}</strong>
            <div class="muted">${b.allDay ? 'Dia inteiro' : `${esc(b.start)} às ${esc(b.end)}`}${b.reason ? ` · ${esc(b.reason)}` : ''}</div></div>
          <button class="act danger" data-block="${esc(b.id)}">Remover</button>
        </div>`).join('')
      : '<div class="empty">Nenhum bloqueio futuro.</div>';
  }

  $('bAllDay').addEventListener('change', () => {
    $('bStart').disabled = $('bAllDay').checked;
    $('bEnd').disabled = $('bAllDay').checked;
  });

  $('blockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { conflicts } = await Admin.call('/api/admin/blocks', {
        method: 'POST',
        body: { date: $('bDate').value, allDay: $('bAllDay').checked, start: $('bStart').value, end: $('bEnd').value, reason: $('bReason').value },
      });
      $('bReason').value = '';
      if (conflicts) BS.toast(`Bloqueado. Atenção: já existem ${conflicts} agendamento(s) nesse período — remarque ou cancele na Agenda.`, 'warn');
      else BS.toast('Horário bloqueado.');
      loadBlocks();
    } catch (err) {
      BS.toast(err.message, 'error');
    }
  });

  $('blockList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-block]');
    if (!btn) return;
    try {
      await Admin.call(`/api/admin/blocks/${encodeURIComponent(btn.dataset.block)}`, { method: 'DELETE' });
      BS.toast('Bloqueio removido.');
      loadBlocks();
    } catch (err) {
      BS.toast(err.message, 'error');
    }
  });

  Admin.register('bloqueios', loadBlocks);

  // -------------------------------------------------------------- galeria
  async function loadGallery() {
    const photos = await BS.api('/api/gallery');
    $('adminGallery').innerHTML = photos.length
      ? photos.map((p) => `<figure>
          <img src="${esc(p.url)}" alt="${esc(p.caption)}" loading="lazy">
          ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}
          <button class="act danger del" data-photo="${esc(p.id)}">Excluir</button>
        </figure>`).join('')
      : '<div class="empty">Nenhuma foto ainda. Envie fotos dos seus melhores cortes!</div>';
  }

  /** Reduz a imagem no navegador (máx. 1600px) para envio rápido. */
  function resize(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error(`Não foi possível ler “${file.name}”.`));
      img.src = URL.createObjectURL(file);
    });
  }

  $('photoInput').addEventListener('change', () => {
    const n = $('photoInput').files.length;
    $('photoInput').nextElementSibling.textContent = n ? `📷 ${n} foto(s) selecionada(s)` : '📷 Toque para escolher fotos';
  });

  $('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = [...$('photoInput').files];
    if (!files.length) {
      BS.toast('Escolha pelo menos uma foto.', 'warn');
      return;
    }
    const btn = $('uploadBtn');
    btn.disabled = true;
    try {
      for (const [i, file] of files.entries()) {
        btn.textContent = `Enviando ${i + 1}/${files.length}…`;
        const image = await resize(file);
        await Admin.call('/api/admin/gallery', { method: 'POST', body: { image, caption: $('photoCaption').value } });
      }
      BS.toast('Fotos publicadas no site!');
      $('uploadForm').reset();
      $('photoInput').dispatchEvent(new Event('change'));
      loadGallery();
    } catch (err) {
      BS.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar fotos';
    }
  });

  $('adminGallery').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-photo]');
    if (!btn || !window.confirm('Excluir esta foto do site?')) return;
    try {
      await Admin.call(`/api/admin/gallery/${encodeURIComponent(btn.dataset.photo)}`, { method: 'DELETE' });
      BS.toast('Foto excluída.');
      loadGallery();
    } catch (err) {
      BS.toast(err.message, 'error');
    }
  });

  Admin.register('galeria', loadGallery);
})();
