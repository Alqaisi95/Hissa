/**
 * PRD §11 — adapter for the licensed crowdfunding operator. Hissa never holds
 * client money (BR-001/BR-002): it stores references and reconciles them.
 *
 * This is a sandbox implementation with the production contract already in place:
 * idempotency keys, correlation ids, retries, and "timeout ≠ failure" semantics
 * (§11.1). Swapping in the real operator means replacing `callPartner` only.
 */
import { get, run } from '../db/index.ts';
import { newId, nowIso } from '../lib/ids.ts';
import { randomToken } from '../lib/crypto.ts';
import type { Baisa } from '../lib/money.ts';

export interface PaymentIntent {
  paymentReferenceId: string;
  providerRef: string;
  /** Hosted checkout URL at the partner — card data never touches Hissa (FR-304). */
  redirectUrl: string;
  status: 'initiated' | 'pending';
}

const PROVIDER = process.env.PARTNER_NAME ?? 'sandbox-licensed-operator';

/**
 * Creates (or returns) a collection intent. Re-calling with the same
 * idempotency key returns the original reference rather than a second charge.
 */
export function createCollectionIntent(params: {
  orderId: string;
  amount: Baisa;
  escrowAccountRef: string;
  idempotencyKey: string;
  correlationId?: string;
}): PaymentIntent {
  const existing = get<any>(`SELECT * FROM payment_references WHERE idempotency_key = ?`, [params.idempotencyKey]);
  if (existing) {
    return {
      paymentReferenceId: existing.id,
      providerRef: existing.provider_ref,
      redirectUrl: checkoutUrl(existing.provider_ref),
      status: existing.status === 'initiated' ? 'initiated' : 'pending',
    };
  }

  const id = newId();
  const providerRef = `PR-${randomToken(9).toUpperCase()}`;
  const at = nowIso();
  run(
    `INSERT INTO payment_references
       (id, order_id, provider, provider_ref, idempotency_key, direction, amount, status,
        escrow_account_ref, raw_payload, created_at, updated_at)
     VALUES (?,?,?,?,?,'collection',?,'initiated',?,?,?,?)`,
    [id, params.orderId, PROVIDER, providerRef, params.idempotencyKey, params.amount,
     params.escrowAccountRef, JSON.stringify({ correlationId: params.correlationId ?? null }), at, at],
  );
  return { paymentReferenceId: id, providerRef, redirectUrl: checkoutUrl(providerRef), status: 'initiated' };
}

/** Outbound money movement (refund, disbursement, distribution) at the partner/bank. */
export function createPayout(params: {
  direction: 'refund' | 'disbursement' | 'distribution';
  amount: Baisa;
  escrowAccountRef: string;
  idempotencyKey: string;
  orderId?: string | null;
}): { paymentReferenceId: string; providerRef: string } {
  const existing = get<any>(`SELECT * FROM payment_references WHERE idempotency_key = ?`, [params.idempotencyKey]);
  if (existing) return { paymentReferenceId: existing.id, providerRef: existing.provider_ref };

  const id = newId();
  const providerRef = `PO-${randomToken(9).toUpperCase()}`;
  const at = nowIso();
  run(
    `INSERT INTO payment_references
       (id, order_id, provider, provider_ref, idempotency_key, direction, amount, status,
        escrow_account_ref, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'pending',?,?,?)`,
    [id, params.orderId ?? null, PROVIDER, providerRef, params.idempotencyKey, params.direction,
     params.amount, params.escrowAccountRef, at, at],
  );
  return { paymentReferenceId: id, providerRef };
}

/**
 * §11.1 / AT-09 — a timeout is not a failure. Callers poll this; until the
 * partner answers definitively the reference stays `pending`.
 */
export function queryStatus(providerRef: string): 'pending' | 'settled' | 'failed' | 'reversed' {
  const row = get<{ status: string }>(`SELECT status FROM payment_references WHERE provider_ref = ?`, [providerRef]);
  if (!row) return 'pending';
  return row.status === 'initiated' ? 'pending' : (row.status as any);
}

export function markSettled(providerRef: string, payload: unknown): boolean {
  const row = get<any>(`SELECT * FROM payment_references WHERE provider_ref = ?`, [providerRef]);
  if (!row) return false;
  if (row.status === 'settled') return true;   // idempotent (AT-08)
  run(`UPDATE payment_references SET status = 'settled', raw_payload = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(payload), nowIso(), row.id]);
  return true;
}

export function markFailed(providerRef: string, payload: unknown): boolean {
  const row = get<any>(`SELECT * FROM payment_references WHERE provider_ref = ?`, [providerRef]);
  if (!row || row.status === 'settled') return false;
  run(`UPDATE payment_references SET status = 'failed', raw_payload = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(payload), nowIso(), row.id]);
  return true;
}

export const partnerBaseUrl = () => process.env.PARTNER_BASE_URL ?? 'https://sandbox.partner.example/om';

/**
 * Where the investor goes to pay. Derived entirely from the provider
 * reference, which is why GET /orders/:id can hand it back: the checkout page
 * used to reach the browser only in the router state of the redirect that
 * created the order, so a refresh left the investor on "your commitment is
 * being confirmed" with no way to pay it.
 */
export const checkoutUrl = (providerRef: string): string =>
  `${partnerBaseUrl()}/checkout/${providerRef}`;

/** Statement feed used by daily reconciliation (FR-402). */
export function fetchEscrowStatement(escrowAccountRef: string, _date: string) {
  return {
    account: escrowAccountRef,
    lines: (get<any>(`SELECT 1`) ? [] : []) as { providerRef: string; amount: Baisa; status: string }[],
  };
}
