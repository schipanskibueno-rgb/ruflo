/* Página inicial: menu, serviços, galeria. */
(() => {
  const { esc, brl, fmtDuration } = BS;

  document.getElementById('year').textContent = new Date().getFullYear();

  const topbar = document.getElementById('topbar');
  const onScroll = () => topbar.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const menuBtn = document.getElementById('menuBtn');
  const nav = document.getElementById('nav');
  menuBtn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      nav.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  BS.config().then((cfg) => {
    document.getElementById('servicesGrid').innerHTML = cfg.services.map((s) => `
      <a class="service-card" href="/agendar?servico=${encodeURIComponent(s.id)}">
        ${s.featured ? '<span class="tag">Mais completo</span>' : ''}
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.desc)}</p>
        <div class="service-meta">
          <span class="price"><small>R$</small>${esc(brl(s.price).replace('R$', '').trim())}</span>
          <span class="duration">≈ ${fmtDuration(s.duration)}</span>
        </div>
        <span class="link">Agendar este serviço →</span>
      </a>`).join('');
  }).catch(() => {
    document.getElementById('servicesGrid').innerHTML = '<p class="muted">Não foi possível carregar os serviços agora.</p>';
  });

  // Fotos reais do Instagram @bs_barberhouse (public/img/galeria).
  const PHOTOS = [
    ['/img/galeria/01.jpg', 'Low fade + barba'],
    ['/img/galeria/02.jpg', 'Corte na tesoura'],
    ['/img/galeria/03.jpg', 'Mid fade'],
    ['/img/galeria/04.jpg', 'High fade'],
    ['/img/galeria/05.jpg', 'Taper + barba'],
    ['/img/galeria/06.jpg', 'Low taper'],
    ['/img/galeria/07.jpg', 'Degradê infantil'],
    ['/img/galeria/08.jpg', 'Low fade + barba'],
  ].map(([url, caption]) => ({ url, caption }));
  const gallery = document.getElementById('gallery');
  const renderGallery = (photos) => {
    gallery.innerHTML = photos.map((p) => `
      <figure data-src="${esc(p.url)}">
        <img src="${esc(p.url)}" alt="${esc(p.caption || 'Corte da BS Barber House')}" loading="lazy">
        ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}
      </figure>`).join('');
  };
  renderGallery(PHOTOS);
  // Fotos enviadas pelo painel aparecem primeiro.
  BS.api('/api/gallery').then((uploaded) => {
    if (uploaded.length) renderGallery([...uploaded, ...PHOTOS]);
  }).catch(() => {});

  gallery.addEventListener('click', (e) => {
    const fig = e.target.closest('figure[data-src]');
    if (!fig) return;
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${esc(fig.dataset.src)}" alt="">`;
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  });
})();
