/*
 * Mensalidade do sistema no Stripe (Billing + Invoicing).
 * Variáveis na Netlify: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CUSTOMER_ID (+ SUPABASE_URL, SUPABASE_SECRET_KEY).
 */
import Stripe from 'stripe';
import { db } from './push.mjs';

const TZ = 'America/Sao_Paulo';
// Versão da API fixa: muda só de propósito (nela a fatura traz o payment_intent para pagar no painel).
export const STRIPE_API_VERSION = '2025-02-24.acacia';
const env = (key) => globalThis.Netlify?.env?.get(key) ?? process.env[key];

let client;
export function stripe() {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Falta a variável STRIPE_SECRET_KEY na Netlify.');
  client ||= new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  return client;
}

/** Só as faturas do cliente desta barbearia (a mesma conta Stripe pode cobrar outros sites). */
export function isOurs(invoice) {
  const customer = env('STRIPE_CUSTOMER_ID');
  if (!customer) throw new Error('Falta a variável STRIPE_CUSTOMER_ID na Netlify.');
  const id = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  return id === customer;
}

/** Prazo: dia 10. Fatura emitida a partir do dia 20 vence no dia 10 do mês seguinte. */
export function deadlineFor(createdUnix) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(createdUnix * 1000));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  let y = get('year');
  let m = get('month');
  if (get('day') >= 20) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return `${y}-${String(m).padStart(2, '0')}-10`;
}

/** Grava/atualiza a fatura no Supabase (rascunho ainda não pode ser pago: fica de fora). */
export async function saveInvoice(inv) {
  if (!isOurs(inv) || inv.status === 'draft') return false;
  const paidAt = inv.status_transitions?.paid_at;
  await db('billing_invoices?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      id: inv.id,
      status: inv.status,
      amount_due: inv.amount_due / 100,
      currency: inv.currency,
      number: inv.number,
      hosted_url: inv.hosted_invoice_url,
      deadline: deadlineFor(inv.created),
      paid_at: paidAt ? new Date(paidAt * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
  });
  return true;
}

export async function pendingInvoice() {
  const rows = await db('billing_invoices?select=*&status=in.(open,uncollectible)&order=deadline.asc&limit=1');
  return rows[0] || null;
}
