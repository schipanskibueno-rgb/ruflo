// Função do Supabase (Edge Functions): avisos no celular dos barbeiros.
// Como publicar: Supabase → Edge Functions → Deploy a new function → Via Editor → cole este arquivo
// → Deploy. Depois, nos detalhes da função, desligue "Verify JWT".
// Publicada como "{{SUPABASE_FUNCAO}}": o nome precisa ser o mesmo de FUNCTION_NAME (agendamento.html)
// e do endereço no final de supabase/schema.sql.
//
// Rotas (depois do nome da função):
//   POST /notify     (o banco chama a cada minuto, com a senha interna)
//   GET  /push-key   (painel: chave pública para ativar os avisos)
//   POST /push-test  (painel: "Enviar teste" para o barbeiro logado)

import webpush from 'npm:web-push@3.6.7';

const TZ = '{{FUSO}}';
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const SUBJECT = 'mailto:schipanskibueno@outlook.com';
const env = (key: string) => Deno.env.get(key) || '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-staff-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ------------------------------------------------------------------ banco (chave de serviço)
async function db(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const secret = async (key: string): Promise<string | null> =>
  (await db(`app_secrets?select=value&key=eq.${key}`))[0]?.value ?? null;

/** Chaves dos avisos: criadas sozinhas na primeira vez e guardadas no banco. */
async function vapid() {
  let pub = await secret('vapid_public');
  let priv = await secret('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    await db('app_secrets?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: [{ key: 'vapid_public', value: keys.publicKey }, { key: 'vapid_private', value: keys.privateKey }],
    });
    pub = await secret('vapid_public'); // se duas chamadas criarem ao mesmo tempo, vale a primeira gravada
    priv = await secret('vapid_private');
  }
  webpush.setVapidDetails(SUBJECT, pub!, priv!);
  return pub!;
}

// ------------------------------------------------------------------ envio
// deno-lint-ignore no-explicit-any
async function sendTo(subs: any[], payload: Record<string, string>) {
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 900, urgency: 'high' });
      sent += 1;
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.statusCode;
      if (code === 404 || code === 410) {
        await db(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'DELETE' }).catch(() => {});
      } else {
        console.error('push falhou', code, (err as Error).message);
      }
    }
  }
  return sent;
}

function localNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const first = (name: string) => String(name).split(' ')[0];
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

/**
 * A cada minuto: avisa o barbeiro do atendimento que começa (5 min antes até 5 min depois)
 * e avisa barbeiro + dono de cada agendamento novo feito pelo site (um aviso por série recorrente).
 * O create_booking também chama esta rota na hora em que o cliente marca (_notify_now no schema.sql).
 * Cada horário é "reservado" antes do envio, então nunca é avisado duas vezes.
 */
async function runNotify(now = new Date()) {
  const local = localNow(now);
  const stamp = now.toISOString();
  const starts = await db(
    `bookings?select=*&status=eq.agendado&date=eq.${local.date}&time=gte.${hhmm(Math.max(0, local.minutes - 5))}&time=lte.${hhmm(local.minutes + 5)}&notified_start_at=is.null`,
    { method: 'PATCH', body: { notified_start_at: stamp } },
  );
  const fresh = await db(
    `bookings?select=*&source=eq.site&notified_new_at=is.null&created_at=gte.${encodeURIComponent(new Date(now.getTime() - 15 * 60000).toISOString())}`,
    { method: 'PATCH', body: { notified_new_at: stamp } },
  );
  if (!starts.length && !fresh.length) return { starts: 0, fresh: 0, sent: 0 };

  await vapid();
  const [staff, subs] = await Promise.all([db('staff_access?select=id,role,barber_id'), db('push_subscriptions?select=*')]);
  // deno-lint-ignore no-explicit-any
  const byId = Object.fromEntries(staff.map((s: any) => [s.id, s]));
  // deno-lint-ignore no-explicit-any
  const to = (barberId: string, withOwner: boolean) => subs.filter((s: any) => {
    const who = byId[s.staff_id];
    return who && (who.barber_id === barberId || (withOwner && who.role === 'admin'));
  });

  let sent = 0;
  for (const b of starts) {
    sent += await sendTo(to(b.barber_id, false), {
      title: `✂️ Agora: ${first(b.name)} — ${b.time.slice(0, 5)}`,
      body: `${b.service_name} · até ${hhmm(toMin(b.time) + b.duration)}${b.notes ? ` · “${b.notes}”` : ''}`,
      tag: `start-${b.id}`,
      url: './#/admin',
    });
  }
  const seen = new Set();
  // deno-lint-ignore no-explicit-any
  for (const b of fresh.sort((x: any, y: any) => (x.date + x.time).localeCompare(y.date + y.time))) {
    const key = b.series_id || b.id;
    if (seen.has(key)) continue;
    seen.add(key);
    sent += await sendTo(to(b.barber_id, true), {
      title: `📅 Novo agendamento: ${b.name}`,
      body: `${b.service_name} · ${dayLabel(b.date)} às ${b.time.slice(0, 5)} · com ${first(b.barber_name)}${b.series_id ? ' · 🔁 todo mês' : ''}`,
      tag: `new-${key}`,
      url: './#/admin',
    });
  }
  return { starts: starts.length, fresh: fresh.length, sent };
}

/** Barbeiro logado no painel (pelo token da sessão), ou null. */
async function staffFrom(req: Request) {
  const token = req.headers.get('x-staff-token') || '';
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  return db('rpc/staff_me', { method: 'POST', body: {}, headers: { 'x-staff-token': token } });
}

// ------------------------------------------------------------------ rotas
export async function handle(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  try {
    if (route === 'notify' && req.method === 'POST') {
      const expected = await secret('cron_secret');
      if (!expected || req.headers.get('x-cron-secret') !== expected) return json(401, { error: 'Não autorizado.' });
      return json(200, await runNotify());
    }
    if (route === 'push-key' && req.method === 'GET') {
      return json(200, { publicKey: await vapid() });
    }
    if (route === 'push-test' && req.method === 'POST') {
      const me = await staffFrom(req);
      if (!me) return json(401, { error: 'Faça login para continuar.' });
      const subs = await db(`push_subscriptions?select=*&staff_id=eq.${encodeURIComponent(me.id)}`);
      if (!subs.length) return json(404, { error: 'Ative as notificações neste aparelho primeiro.' });
      await vapid();
      const sent = await sendTo(subs, {
        title: '🔔 Notificações ativas',
        body: 'Você vai receber aqui os avisos de atendimento e novos agendamentos.',
        tag: 'teste',
        url: './#/admin',
      });
      return json(200, { sent });
    }
    return json(404, { error: 'Rota não encontrada.' });
  } catch (err) {
    console.error(err);
    return json(500, { error: 'Erro no servidor. Tente de novo em instantes.' });
  }
}

Deno.serve(handle);
