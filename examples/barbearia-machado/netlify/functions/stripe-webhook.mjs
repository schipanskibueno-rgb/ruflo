// Webhook do Stripe: mantém as faturas da mensalidade em dia no Supabase (pago = sistema liberado na hora).
import { saveInvoice, stripe } from '../lib/billing.mjs';

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const secret = globalThis.Netlify?.env?.get('STRIPE_WEBHOOK_SECRET') ?? process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json(500, { error: 'Falta STRIPE_WEBHOOK_SECRET.' });
  let event;
  try {
    // Assinatura conferida sobre o corpo bruto: rejeita qualquer chamada que não venha do Stripe.
    event = stripe().webhooks.constructEvent(await req.text(), req.headers.get('stripe-signature') || '', secret);
  } catch {
    return json(400, { error: 'Assinatura inválida.' });
  }
  if (event.type.startsWith('invoice.')) {
    // Busca a versão atual da fatura: os eventos podem chegar fora de ordem.
    const invoice = await stripe().invoices.retrieve(event.data.object.id);
    await saveInvoice(invoice);
  }
  return json(200, { received: true });
};
