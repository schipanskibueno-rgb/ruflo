// Painel do dono: prepara o pagamento da mensalidade em aberto (formulário do Stripe dentro do sistema).
import { db } from '../lib/push.mjs';
import { isOurs, pendingInvoice, saveInvoice, stripe } from '../lib/billing.mjs';

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
  const token = req.headers.get('x-staff-token') || '';
  if (!/^[0-9a-f]{48}$/.test(token)) return json(401, { error: 'Faça login para continuar.' });
  const me = await db('rpc/staff_me', { method: 'POST', body: {}, headers: { 'x-staff-token': token } });
  if (!me) return json(401, { error: 'Faça login para continuar.' });
  if (me.role !== 'admin') return json(403, { error: 'Só o dono paga a mensalidade.' });

  const pending = await pendingInvoice();
  if (!pending) return json(200, { paid: true });
  const invoice = await stripe().invoices.retrieve(pending.id, { expand: ['payment_intent'] });
  if (!isOurs(invoice)) return json(403, { error: 'Fatura de outro cliente.' });
  if (invoice.status !== 'open') {
    await saveInvoice(invoice);
    return json(200, { paid: invoice.status === 'paid' });
  }
  const pi = invoice.payment_intent;
  return json(200, {
    amount: invoice.amount_due / 100,
    currency: invoice.currency,
    hostedUrl: invoice.hosted_invoice_url,
    clientSecret: pi && typeof pi === 'object' && pi.status !== 'succeeded' ? pi.client_secret : null,
  });
};
