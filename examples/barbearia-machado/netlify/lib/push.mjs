/*
 * Avisos no celular dos barbeiros (Web Push), usados pelas funções da Netlify.
 * Variáveis de ambiente (Netlify → Site configuration → Environment variables):
 *   SUPABASE_URL, SUPABASE_SECRET_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (opcional)
 */
import webpush from 'web-push';

const TZ = 'America/Sao_Paulo';
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const env = (key) => globalThis.Netlify?.env?.get(key) ?? process.env[key];

export function setup() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter((k) => !env(k));
  if (missing.length) throw new Error(`Faltam variáveis de ambiente na Netlify: ${missing.join(', ')}`);
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:schipanskibueno@outlook.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
}

/** REST do Supabase com a chave secreta (ignora as regras de acesso; nunca vai para o navegador). */
export async function db(path, { method = 'GET', body, headers = {} } = {}) {
  const key = env('SUPABASE_SECRET_KEY');
  const res = await fetch(`${env('SUPABASE_URL').replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/** Envia para cada aparelho; aparelhos que desinstalaram/bloquearam (404/410) saem da lista. */
export async function sendTo(subs, payload) {
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 900, urgency: 'high' });
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' }).catch(() => {});
      } else {
        console.error('push falhou', err.statusCode, err.body || err.message);
      }
    }
  }
  return sent;
}

export function localNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const first = (name) => String(name).split(' ')[0];
const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

/**
 * Roda a cada minuto: avisa o barbeiro do atendimento que começa (5 min antes até 5 min depois)
 * e avisa barbeiro + dono de cada agendamento novo feito pelo site.
 * Cada agendamento é "reservado" com um PATCH antes do envio, então nunca é avisado duas vezes.
 */
/**
 * Mensalidade do sistema: lembra o dono no celular, mais vezes perto do dia 10
 * (9h todo dia; também 15h faltando 2 dias ou menos; também 19h no último dia).
 */
export async function billingReminders(local) {
  const [pending] = await db('billing_invoices?select=*&status=in.(open,uncollectible)&order=deadline.asc&limit=1');
  if (!pending) return 0;
  const hour = Math.floor(local.minutes / 60);
  const daysLeft = Math.round((Date.parse(pending.deadline) - Date.parse(local.date)) / 86400000);
  const blocked = daysLeft < 0 && (await db('rpc/system_blocked', { method: 'POST', body: {} }));
  if (daysLeft < 0 && !blocked) return 0; // liberado manualmente
  const slots = [[hour >= 9, 'manha'], [daysLeft <= 2 && hour >= 15, 'tarde'], [daysLeft <= 0 && hour >= 19, 'noite']]
    .filter(([due]) => due).map(([, slot]) => slot);
  if (!slots.length) return 0;
  const owners = (await db('staff_access?select=id&role=eq.admin')).map((s) => s.id);
  if (!owners.length) return 0;
  const subs = await db(`push_subscriptions?select=*&staff_id=in.(${owners.map(encodeURIComponent).join(',')})`);
  const value = Number(pending.amount_due).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const [, mm, dd] = pending.deadline.split('-');
  const payload = blocked
    ? { title: '⛔ Sistema suspenso', body: `Pague a mensalidade (${value}) para voltar a receber agendamentos.` }
    : daysLeft === 0
      ? { title: '🚨 Hoje é o último dia', body: `Pague a mensalidade do sistema (${value}) até hoje para não suspender.` }
      : daysLeft <= 2
        ? { title: `⚠️ Faltam ${daysLeft} dia(s)`, body: `Mensalidade do sistema: ${value} · vence ${dd}/${mm}.` }
        : { title: '💳 Mensalidade do sistema', body: `Disponível para pagamento: ${value} · vence ${dd}/${mm}.` };
  // Reserva todos os horários vencidos, mas manda um aviso só (sem dois iguais seguidos).
  let claimed = false;
  for (const slot of slots) {
    if (await db('rpc/claim_billing_reminder', { method: 'POST', body: { p_slot: slot } })) claimed = true;
  }
  return claimed ? sendTo(subs, { ...payload, tag: 'mensalidade', url: './#/admin' }) : 0;
}

export async function runNotify(now = new Date()) {
  const local = localNow(now);
  const stamp = now.toISOString();
  const billing = await billingReminders(local).catch((err) => {
    console.error('lembrete da mensalidade falhou', err.message);
    return 0;
  });
  const starts = await db(
    `bookings?select=*&status=eq.agendado&date=eq.${local.date}&time=gte.${hhmm(Math.max(0, local.minutes - 5))}&time=lte.${hhmm(local.minutes + 5)}&notified_start_at=is.null`,
    { method: 'PATCH', body: { notified_start_at: stamp } },
  );
  const fresh = await db(
    `bookings?select=*&source=eq.site&notified_new_at=is.null&created_at=gte.${encodeURIComponent(new Date(now - 15 * 60000).toISOString())}`,
    { method: 'PATCH', body: { notified_new_at: stamp } },
  );
  if (!starts.length && !fresh.length) return { starts: 0, fresh: 0, sent: billing };

  const [staff, subs] = await Promise.all([db('staff_access?select=id,role,barber_id'), db('push_subscriptions?select=*')]);
  const byId = Object.fromEntries(staff.map((s) => [s.id, s]));
  const to = (barberId, withOwner) => subs.filter((s) => {
    const who = byId[s.staff_id];
    return who && (who.barber_id === barberId || (withOwner && who.role === 'admin'));
  });

  let sent = billing;
  for (const b of starts) {
    const end = hhmm(toMin(b.time) + b.duration);
    sent += await sendTo(to(b.barber_id, false), {
      title: `✂️ Agora: ${first(b.name)} — ${b.time.slice(0, 5)}`,
      body: `${b.service_name} · até ${end}${b.notes ? ` · “${b.notes}”` : ''}`,
      tag: `start-${b.id}`,
      url: './#/admin',
    });
  }
  // Agendamento recorrente cria vários horários de uma vez: um aviso só por série.
  const seen = new Set();
  for (const b of fresh.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time))) {
    const key = b.series_id || b.id;
    if (seen.has(key)) continue;
    seen.add(key);
    sent += await sendTo(to(b.barber_id, true), {
      title: '📅 Novo agendamento',
      body: `${b.name} · ${b.service_name} · ${dayLabel(b.date)} às ${b.time.slice(0, 5)} com ${first(b.barber_name)}${b.series_id ? ' · 🔁 todo mês' : ''}`,
      tag: `new-${key}`,
      url: './#/admin',
    });
  }
  return { starts: starts.length, fresh: fresh.length, sent };
}
