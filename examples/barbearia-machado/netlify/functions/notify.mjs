// Função agendada (a cada minuto): avisos de "atendimento agora" e "novo agendamento".
import { runNotify, setup } from '../lib/push.mjs';

export const config = { schedule: '* * * * *' };

export default async () => {
  setup();
  const result = await runNotify();
  if (result.sent || result.starts || result.fresh) console.log('avisos', result);
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
};
