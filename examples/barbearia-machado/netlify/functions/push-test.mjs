// Botão "Enviar teste" do painel: manda uma notificação para os aparelhos de quem está logado.
import { db, sendTo, setup } from '../lib/push.mjs';

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const token = req.headers.get('x-staff-token') || '';
  if (!/^[0-9a-f]{48}$/.test(token)) return json(401, { error: 'Faça login para continuar.' });
  setup();
  const me = await db('rpc/staff_me', { method: 'POST', body: {}, headers: { 'x-staff-token': token } });
  if (!me) return json(401, { error: 'Faça login para continuar.' });
  const subs = await db(`push_subscriptions?select=*&staff_id=eq.${encodeURIComponent(me.id)}`);
  if (!subs.length) return json(404, { error: 'Ative as notificações neste aparelho primeiro.' });
  const sent = await sendTo(subs, {
    title: '🔔 Notificações ativas',
    body: 'Você vai receber aqui os avisos de atendimento e novos agendamentos.',
    tag: 'teste',
    url: './#/admin',
  });
  return json(200, { sent });
};
