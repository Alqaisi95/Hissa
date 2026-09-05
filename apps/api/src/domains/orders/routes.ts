/** Investment commitment journey (FR-301..FR-308) and partner webhooks (AT-08, AT-09). */
import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx, nextSequence } from '../../db/index.ts';
import { newId, nowIso, plus, hours, makeReference } from '../../lib/ids.ts';
import { applyBps } from '../../lib/money.ts';
import { audit } from '../../lib/audit.ts';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { getSetting, SETTING_KEYS, fees } from '../../lib/settings.ts';
import { evaluateEligibility, publicVerdict, committedToPool } from './eligibility.ts';
import { createCollectionIntent, markSettled, markFailed, queryStatus, checkoutUrl } from '../../integrations/partner.ts';
import { signDocument } from '../../integrations/esign.ts';
import { notify } from '../../integrations/notifications.ts';
import { track } from '../analytics/track.ts';
import { allocate } from './allocation.ts';

export const ordersRouter = Router();

/** FR-301 — the gate the checkout screen calls before showing the amount field. */
ordersRouter.get('/eligibility/:poolId', requireAuth, (req, res) => {
  const verdict = evaluateEligibility(req.auth!.userId, req.params.poolId);
  res.json(publicVerdict(verdict));
});

/** FR-302 — amount, fees, rights and risk summary, shown before any commitment. */
ordersRouter.post('/quote', requireAuth, (req, res) => {
  const body = z.object({
    poolId: z.string().uuid(),
    amount: z.number().int().positive(),
  }).parse(req.body);

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [body.poolId]);
  if (!pool) throw notFound();

  const verdict = evaluateEligibility(req.auth!.userId, pool.id);
  const feeSchedule = fees();
  // Pilot decision: investors pay no platform fee; the project bears the success fee.
  const investorFee = 0;
  const units = Math.floor(body.amount / pool.unit_price);

  res.json({
    poolId: pool.id,
    amount: body.amount,
    investorFee,
    total: body.amount + investorFee,
    units,
    unitPrice: pool.unit_price,
    ownershipBps: Math.round((units * 10_000) / pool.total_units),
    eligibility: publicVerdict(verdict),
    withinAvailable: body.amount <= verdict.availableAmount,
    feeScheduleNote: {
      ar: `يتحمل صاحب المشروع رسوم النجاح ${feeSchedule.successFeeBps / 100}% ورسوم المتابعة ${feeSchedule.monitoringFeeBps / 100}% سنويًا وفق مذكرة الإفصاح.`,
      en: `The project owner bears the ${feeSchedule.successFeeBps / 100}% success fee and the ${feeSchedule.monitoringFeeBps / 100}% annual monitoring fee, as set out in the disclosure.`,
    },
    riskWarningAr: 'قد تخسر كامل المبلغ المستثمر. لا ضمان للعائد أو لرأس المال ولا توجد سوق ثانوية.',
  });
});

/** Acknowledgements the investor must give explicitly before the order exists (FR-303). */
export const REQUIRED_ACKNOWLEDGEMENTS = [
  { code: 'capital_loss', textAr: 'أفهم أنني قد أخسر كامل المبلغ المستثمر.', textEn: 'I understand I may lose my entire investment.' },
  { code: 'no_guarantee', textAr: 'أفهم أنه لا يوجد ضمان للعائد أو لرأس المال.', textEn: 'I understand no return or capital is guaranteed.' },
  { code: 'illiquidity', textAr: 'أفهم أنه لا توجد سوق ثانوية وأن الخروج يتم وفق الآلية المكتوبة فقط.', textEn: 'I understand there is no secondary market and exit follows the documented mechanism only.' },
  { code: 'disclosure_read', textAr: 'قرأت مذكرة الإفصاح بنسختها المنشورة وأوافق على شروطها.', textEn: 'I have read the published disclosure version and accept its terms.' },
  { code: 'projections', textAr: 'أفهم أن السيناريوهات المالية توقعات وليست وعودًا.', textEn: 'I understand the financial scenarios are projections, not promises.' },
];

ordersRouter.get('/acknowledgements', (_req, res) => {
  res.json({ acknowledgements: REQUIRED_ACKNOWLEDGEMENTS });
});

// ─────────────────────────── FR-301..FR-305 create commitment ───────────────────────────

ordersRouter.post('/', requireAuth, requirePermission('order.create'), (req, res) => {
  const body = z.object({
    poolId: z.string().uuid(),
    amount: z.number().int().positive(),
    disclosureVersionId: z.string().uuid(),
    acknowledgements: z.array(z.string()).min(REQUIRED_ACKNOWLEDGEMENTS.length),
    idempotencyKey: z.string().min(8).optional(),
  }).parse(req.body);

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [body.poolId]);
  if (!pool) throw notFound();

  track('investment_started', req.auth!.userId, { amount: body.amount }, pool.id);

  // FR-303 — every acknowledgement must be given explicitly.
  const missing = REQUIRED_ACKNOWLEDGEMENTS.filter((a) => !body.acknowledgements.includes(a.code));
  if (missing.length) {
    throw unprocessable('acknowledgements_missing', 'يلزم الإقرار بجميع البنود قبل المتابعة',
      'All acknowledgements are required before proceeding', { missing: missing.map((m) => m.code) });
  }

  // FR-303 — the order binds to the exact disclosure version the investor saw.
  const disclosure = get<any>(
    `SELECT * FROM disclosure_versions WHERE id = ? AND pool_id = ?`, [body.disclosureVersionId, pool.id]);
  if (!disclosure) throw notFound();
  if (disclosure.status !== 'published') {
    throw conflict('disclosure_superseded', 'صدرت نسخة إفصاح أحدث. راجع النسخة الحالية قبل المتابعة.',
      'A newer disclosure version has been published. Review the current version before proceeding.');
  }

  const verdict = evaluateEligibility(req.auth!.userId, pool.id);
  if (!verdict.eligible) {
    // AT-02 — the block states the reason and what is available, not the internal rule.
    throw unprocessable('not_eligible', 'لا يمكن إتمام الاستثمار حاليًا', 'This investment cannot be completed right now',
      { blocks: verdict.blocks, availableAmount: verdict.availableAmount });
  }
  if (body.amount < verdict.minTicket) {
    throw unprocessable('below_min_ticket', `الحد الأدنى للاستثمار ${verdict.minTicket / 1000} ر.ع`,
      `The minimum investment is OMR ${verdict.minTicket / 1000}`, { minTicket: verdict.minTicket });
  }
  if (body.amount > verdict.availableAmount) {
    throw unprocessable('above_available', 'المبلغ يتجاوز الحد المتاح لك في هذه الفرصة',
      'The amount exceeds your available limit for this pool', { availableAmount: verdict.availableAmount });
  }

  const coolingOff = getSetting<{ enabled: boolean; hours: number }>(SETTING_KEYS.coolingOff);
  const id = newId();
  const at = nowIso();
  const units = Math.floor(body.amount / pool.unit_price);
  const idempotencyKey = body.idempotencyKey ?? `order-${id}`;

  const intent = tx(() => {
    run(
      `INSERT INTO investment_orders
         (id, reference, pool_id, investor_id, amount, platform_fee, units, status, disclosure_version_id,
          acknowledgements, cooling_off_until, created_at, updated_at)
       VALUES (?,?,?,?,?,0,?, 'pending', ?,?,?,?,?)`,
      [id, makeReference('ORD', nextSequence('investment_orders')), pool.id, req.auth!.userId, body.amount, units,
       disclosure.id, JSON.stringify(body.acknowledgements),
       coolingOff.enabled ? plus(at, hours(coolingOff.hours)) : null, at, at],
    );
    // FR-304 — the investor is handed off to the partner; card data never reaches Hissa.
    return createCollectionIntent({
      orderId: id, amount: body.amount, escrowAccountRef: pool.escrow_account_ref,
      idempotencyKey, correlationId: req.correlationId,
    });
  });

  audit({ actorId: req.auth!.userId, action: 'order.created', entityType: 'investment_order', entityId: id,
          after: { poolId: pool.id, amount: body.amount, disclosureVersion: disclosure.version },
          correlationId: req.correlationId, ip: req.ip });

  res.status(201).json({
    orderId: id,
    status: 'pending',
    amount: body.amount,
    units,
    // FR-302 — the total handed to the partner matches the quote exactly.
    totalSentToPartner: body.amount,
    payment: { redirectUrl: intent.redirectUrl, providerRef: intent.providerRef },
    coolingOffUntil: coolingOff.enabled ? plus(at, hours(coolingOff.hours)) : null,
  });
});

ordersRouter.get('/mine', requireAuth, (req, res) => {
  const rows = all<any>(
    `SELECT o.*, p.title_ar, p.reference AS pool_reference, p.status AS pool_status
       FROM investment_orders o JOIN pools p ON p.id = o.pool_id
      WHERE o.investor_id = ? ORDER BY o.created_at DESC`, [req.auth!.userId]);
  res.json({ items: rows.map((r) => ({ ...r, acknowledgements: JSON.parse(r.acknowledgements) })) });
});

ordersRouter.get('/:id', requireAuth, (req, res) => {
  const order = get<any>(`SELECT * FROM investment_orders WHERE id = ?`, [req.params.id]);
  if (!order) throw notFound();

  const isStaff = req.auth!.roles.some((r) => ['compliance', 'finance_ops', 'auditor'].includes(r));
  if (order.investor_id !== req.auth!.userId && !isStaff) throw forbidden();

  const payment = get<any>(
    `SELECT provider, provider_ref, status, direction, created_at FROM payment_references
      WHERE order_id = ? AND direction = 'collection' ORDER BY created_at DESC LIMIT 1`, [order.id]);

  res.json({
    order: { ...order, acknowledgements: JSON.parse(order.acknowledgements) },
    pool: get(`SELECT id, reference, title_ar, status, target_amount, closes_at FROM pools WHERE id = ?`, [order.pool_id]),
    /* FR-406 — the investor sees status and reference, never sensitive payment
       data. The checkout link belongs here too: it is derived from the
       reference we already return, and without it a refreshed or bookmarked
       order page showed "being confirmed" and offered no way to pay. It is
       withheld once the money has moved, because then there is nothing to
       pay. */
    payment: payment ? {
      providerRef: payment.provider_ref,
      status: payment.status,
      createdAt: payment.created_at,
      redirectUrl: ['initiated', 'pending'].includes(payment.status)
        ? checkoutUrl(payment.provider_ref) : null,
    } : null,
    refunds: all(`SELECT id, amount, status, reason, created_at, settled_at FROM refunds WHERE order_id = ?`, [order.id]),
  });
});

/** AT-09 — a partner timeout leaves the order Pending; the client polls this. */
ordersRouter.get('/:id/status', requireAuth, (req, res) => {
  const order = get<any>(`SELECT * FROM investment_orders WHERE id = ?`, [req.params.id]);
  if (!order) throw notFound();
  if (order.investor_id !== req.auth!.userId &&
      !req.auth!.roles.some((r) => ['compliance', 'finance_ops', 'auditor'].includes(r))) throw forbidden();

  const payment = get<any>(
    `SELECT provider_ref FROM payment_references WHERE order_id = ? AND direction = 'collection'
      ORDER BY created_at DESC LIMIT 1`, [order.id]);
  const partnerStatus = payment ? queryStatus(payment.provider_ref) : 'pending';

  res.json({
    orderId: order.id,
    status: order.status,
    partnerStatus,
    messageAr: order.status === 'pending'
      ? 'الالتزام قيد التأكيد لدى الشريك المرخّص. لا يعني التأخير فشل العملية.'
      : undefined,
  });
});

/** FR-307 — receipt and investment documents, available after confirmation. */
ordersRouter.get('/:id/receipt', requireAuth, (req, res) => {
  const order = get<any>(`SELECT * FROM investment_orders WHERE id = ?`, [req.params.id]);
  if (!order) throw notFound();
  if (order.investor_id !== req.auth!.userId) throw forbidden();
  if (!['confirmed', 'allocated'].includes(order.status)) {
    throw conflict('not_confirmed', 'يصدر الإيصال بعد تأكيد الالتزام', 'The receipt is issued once the commitment is confirmed');
  }

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [order.pool_id]);
  const disclosure = get<any>(`SELECT version, content_hash FROM disclosure_versions WHERE id = ?`, [order.disclosure_version_id]);
  const user = get<any>(`SELECT full_name FROM users WHERE id = ?`, [order.investor_id]);

  res.json({
    receipt: {
      reference: order.reference,
      issuedAt: order.confirmed_at,
      investorName: user.full_name,
      poolReference: pool.reference,
      poolTitle: pool.title_ar,
      amount: order.amount,
      units: order.allocated_amount ? Math.floor(order.allocated_amount / pool.unit_price) : order.units,
      allocatedAmount: order.allocated_amount ?? order.amount,
      refundedAmount: order.refunded_amount,
      disclosureVersion: disclosure.version,
      disclosureHash: disclosure.content_hash,
      acknowledgements: JSON.parse(order.acknowledgements),
      structure: pool.structure,
      spvName: pool.spv_name,
      riskNoteAr: 'هذا إيصال التزام استثماري ولا يمثل ضمانًا لأي عائد أو استرداد لرأس المال.',
    },
    agreements: all(
      `SELECT id, category, file_name, created_at FROM documents
        WHERE owner_type = 'order' AND owner_id = ?`, [order.id]),
  });
});

/** FR-308 — cancellation inside the cooling-off window, only if legally adopted. */
ordersRouter.post('/:id/cancel', requireAuth, (req, res) => {
  const order = get<any>(`SELECT * FROM investment_orders WHERE id = ?`, [req.params.id]);
  if (!order) throw notFound();
  if (order.investor_id !== req.auth!.userId) throw forbidden();

  const coolingOff = getSetting<{ enabled: boolean; hours: number }>(SETTING_KEYS.coolingOff);
  const withinWindow = order.cooling_off_until && new Date(order.cooling_off_until) > new Date();

  if (order.status === 'pending') {
    // A commitment that never settled can always be withdrawn.
  } else if (!coolingOff.enabled || !withinWindow) {
    throw conflict('cancellation_not_available', 'لا تتوفر إمكانية الإلغاء لهذا الالتزام',
      'Cancellation is not available for this commitment');
  }

  const at = nowIso();
  run(`UPDATE investment_orders SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?`, [at, at, order.id]);
  if (order.status === 'confirmed') {
    run(`INSERT INTO refunds (id, pool_id, order_id, amount, reason, status, created_by, created_at)
         VALUES (?,?,?,?, 'refund.investor_cancellation', 'requested', ?, ?)`,
        [newId(), order.pool_id, order.id, order.amount, req.auth!.userId, at]);
  }
  audit({ actorId: req.auth!.userId, action: 'order.cancelled', entityType: 'investment_order', entityId: order.id,
          before: { status: order.status }, after: { status: 'cancelled' } });

  res.json({ orderId: order.id, status: 'cancelled', refundRequested: order.status === 'confirmed' });
});

// ─────────────────────────── FR-305 partner webhooks ───────────────────────────

/**
 * AT-08 — a duplicated webhook applies the transaction exactly once and records
 * the replay. Signature verification happens in the app-level raw-body middleware.
 */
export function handlePartnerEvent(event: {
  id: string; type: string; providerRef: string; amount?: number; payload: unknown;
}): { applied: boolean; duplicate: boolean; note?: string } {
  const existing = get<any>(`SELECT * FROM webhook_events WHERE provider = 'partner' AND event_id = ?`, [event.id]);
  if (existing) {
    run(`INSERT INTO webhook_events (id, provider, event_id, event_type, signature_ok, payload, duplicate_of, received_at)
         VALUES (?, 'partner', ?, ?, 1, ?, ?, ?)`,
        [newId(), `${event.id}-replay-${newId().slice(0, 8)}`, event.type, JSON.stringify(event.payload),
         existing.id, nowIso()]);
    return { applied: false, duplicate: true, note: 'event already processed' };
  }

  const eventRowId = newId();
  run(`INSERT INTO webhook_events (id, provider, event_id, event_type, signature_ok, payload, received_at)
       VALUES (?, 'partner', ?, ?, 1, ?, ?)`,
      [eventRowId, event.id, event.type, JSON.stringify(event.payload), nowIso()]);

  const payment = get<any>(`SELECT * FROM payment_references WHERE provider_ref = ?`, [event.providerRef]);
  if (!payment) return { applied: false, duplicate: false, note: 'unknown provider reference' };

  const at = nowIso();
  if (event.type === 'payment.settled') {
    markSettled(event.providerRef, event.payload);

    if (payment.order_id) {
      const order = get<any>(`SELECT * FROM investment_orders WHERE id = ?`, [payment.order_id]);
      if (order && order.status === 'pending') {
        run(`UPDATE investment_orders SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?`,
            [at, at, order.id]);
        audit({ action: 'order.confirmed', entityType: 'investment_order', entityId: order.id,
                before: { status: 'pending' }, after: { status: 'confirmed' }, reason: `partner event ${event.id}` });
        track('investment_confirmed', order.investor_id, { amount: order.amount }, order.pool_id);

        const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [order.pool_id]);
        // FR-307 — investment documents are generated on confirmation.
        const envelope = signDocument({
          signerId: order.investor_id,
          title: `اتفاقية استثمار — ${pool.title_ar}`,
          payload: { orderReference: order.reference, poolReference: pool.reference, amount: order.amount, units: order.units },
        });
        run(`INSERT INTO documents (id, owner_type, owner_id, category, file_name, mime_type, size_bytes,
                                    storage_key, checksum, version, malware_scan, visibility, uploaded_by, created_at)
             VALUES (?, 'order', ?, 'investment_agreement', ?, 'application/pdf', 0, ?, ?, 1, 'clean', 'internal', ?, ?)`,
            [envelope.documentId, order.id, `investment-agreement-${order.reference}.pdf`,
             envelope.storageKey, envelope.checksum, order.investor_id, at]);

        notify({ userId: order.investor_id, templateCode: 'order_confirmed',
                 variables: { reference: order.reference, poolTitle: pool.title_ar } });
        checkFundingProgress(order.pool_id);
      }
    }
    return { applied: true, duplicate: false };
  }

  if (event.type === 'payment.failed') {
    markFailed(event.providerRef, event.payload);
    if (payment.order_id) {
      const order = get<any>(`SELECT * FROM investment_orders WHERE id = ?`, [payment.order_id]);
      if (order && order.status === 'pending') {
        run(`UPDATE investment_orders SET status = 'failed', updated_at = ? WHERE id = ?`, [at, order.id]);
        audit({ action: 'order.failed', entityType: 'investment_order', entityId: order.id,
                after: { status: 'failed' }, reason: `partner event ${event.id}` });
        notify({ userId: order.investor_id, templateCode: 'order_failed', variables: { reference: order.reference } });
      }
    }
    return { applied: true, duplicate: false };
  }

  if (event.type === 'payout.settled') {
    markSettled(event.providerRef, event.payload);
    run(`UPDATE refunds SET status = 'settled', settled_at = ? WHERE payment_ref_id = ?`, [at, payment.id]);
    run(`UPDATE distribution_lines SET status = 'paid' WHERE payment_ref_id = ?`, [payment.id]);
    run(`UPDATE disbursements SET status = 'executed', executed_at = ? WHERE payment_ref_id = ? AND status = 'approved'`,
        [at, payment.id]);

    const refund = get<any>(`SELECT * FROM refunds WHERE payment_ref_id = ?`, [payment.id]);
    if (refund) {
      run(`UPDATE investment_orders SET status = 'refunded', refunded_amount = amount, updated_at = ? WHERE id = ?`,
          [at, refund.order_id]);
    }
    return { applied: true, duplicate: false };
  }

  run(`UPDATE webhook_events SET processed_at = ? WHERE id = ?`, [at, eventRowId]);
  return { applied: false, duplicate: false, note: `unhandled event type ${event.type}` };
}

/** Notifies funding milestones and flags a pool that has reached its target. */
export function checkFundingProgress(poolId: string): void {
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [poolId]);
  if (!pool || pool.status !== 'funding') return;

  const raised = committedToPool(poolId);
  const progressBps = Math.round((raised * 10_000) / pool.target_amount);
  for (const milestone of [2_500, 5_000, 7_500, 10_000]) {
    const already = get<any>(
      `SELECT 1 FROM analytics_events WHERE pool_id = ? AND name = ?`, [poolId, `pool_${milestone / 100}`]);
    if (progressBps >= milestone && !already) track(`pool_${milestone / 100}`, null, { progressBps }, poolId);
  }
}

/** FR-306 / BR-017 — allocation preview for operations before closing. */
ordersRouter.get('/allocation/:poolId/preview', requireAuth, requirePermission('funds.read'), (req, res) => {
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.poolId]);
  if (!pool) throw notFound();

  const orders = all<any>(
    `SELECT id, reference, investor_id, amount, created_at FROM investment_orders
      WHERE pool_id = ? AND status = 'confirmed' ORDER BY created_at ASC`, [pool.id]);
  res.json(allocate(pool, orders));
});
