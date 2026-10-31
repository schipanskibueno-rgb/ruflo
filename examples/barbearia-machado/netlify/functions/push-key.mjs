// Entrega a chave pública das notificações para o painel ativar os avisos (a privada nunca sai da Netlify).
export default async () => {
  const publicKey = globalThis.Netlify?.env?.get('VAPID_PUBLIC_KEY') ?? process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return new Response(JSON.stringify({ error: 'VAPID_PUBLIC_KEY não configurada.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ publicKey }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
};
