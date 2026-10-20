'use strict';

const token = location.pathname.split('/')[2] || '';
const msg = document.getElementById('share-msg');
const passForm = document.getElementById('pass-form');

async function open(password) {
  const res = await fetch(`/api/public/${encodeURIComponent(token)}/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    passForm.hidden = false;
    msg.textContent = password ? data.error : '';
    return;
  }
  if (!res.ok) {
    msg.textContent = data.error || 'Não foi possível abrir o link.';
    return;
  }
  passForm.hidden = true;
  const when = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  document.getElementById('share-title').textContent =
    data.kind === 'live' ? `${data.cameraName} — ao vivo` : `${data.cameraName} — ${when(data.from)} a ${when(data.to)}`;
  msg.textContent = `Link válido até ${when(data.expiresAt)}.`;
  document.getElementById('share-player').hidden = false;
  window.playHls(document.getElementById('share-video'), data.src, { live: data.kind === 'live' });
}

passForm.addEventListener('submit', (e) => {
  e.preventDefault();
  open(passForm.password.value);
});
open('');
