/** Escrow references, reconciliation, closing, refunds, disbursements, distributions (FR-401..FR-408). */
import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx } from '../../db/index.ts';
import { newId, nowIso } from '../../lib/ids.ts';
import { proRata, applyBps } from '../../lib/money.ts';
import { audit } from '../../lib/audit.ts';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { assertDualControl } from '../../lib/rbac.ts';
import { fees } from '../../lib/settings.ts';
import { closePool, poolsDueForClosing } from './closing.ts';
import { runReconciliation, openBreaks, resolveBreak } from './reconciliation.ts';
import { createPayout } from '../../integrations/partner.ts';
import { transition } from '../../workflow/poolState.ts';
import { attachDocument } from '../../lib/documents.ts';
import { notify } from '../../integrations/notifications.ts';

export const fundsRouter = Router();

// ─────────────────────────── FR-401 escrow view ───────────────────────────

/** Escrow position is a *view over external references*, never an internal balance (BR-002). */
fundsRouter.get('/pools/:id/position', requireAuth, requirePermission('funds.read'), (req, res) => {
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();

  const sums = get<any>(
    `SELECT
       SUM(CASE WHEN o.status IN ('pending')                  THEN o.amount ELSE 0 END) AS pending,
       SUM(CASE WHEN o.status IN ('confirmed','allocated')    THEN o.amount ELSE 0 END) AS confirmed,
       SUM(CASE WHEN o.status = 'allocated'                   THEN COALESCE(o.allocated_amount,0) ELSE 0 END) AS allocated,
       SUM(o.refunded_amount) AS refunded
     FROM investment_orders o WHERE o.pool_id = ?`, [pool.id]);

  const settledCollections = get<{ total: number | null }>(
    `SELECT SUM(pr.amount) AS total FROM payment_references pr
       JOIN investment_orders o ON o.id = pr.order_id
      WHERE o.pool_id = ? AND pr.direction = 'collection' AND pr.status = 'settled'`, [pool.id])?.total ?? 0;

  const disbursed = get<{ total: number | null }>(
    `SELECT SUM(amount) AS total FROM disbursements WHERE pool_id = ? AND status = 'executed'`, [pool.id])?.total ?? 0;
  const refundsSettled = get<{ total: number | null }>(
    `SELECT SUM(amount) AS total FROM refunds WHERE pool_id = ? AND status = 'settled'`, [pool.id])?.total ?? 0;

  res.json({
    poolId: pool.id,
    escrowAccountRef: pool.escrow_account_ref,
    ownerContributionReceivedAt: pool.owner_contribution_received_at,
    commitments: {
      pending: sums?.pending ?? 0, confirmed: sums?.confirmed ?? 0,
      allocated: sums?.allocated ?? 0, refunded: sums?.refunded ?? 0,
    },
    external: { settledCollections, disbursed, refundsSettled,
                impliedEscrowBalance: settledCollections - disbursed - refundsSettled },
    note: 'أرقام الضمان مراجع خارجية لدى الشريك/البنك ولا تمثل رصيدًا داخليًا لدى حِصّة.',
  });
});

// ─────────────────────────── FR-402 reconciliation ───────────────────────────

fundsRouter.post('/reconciliation/run', requireAuth, requirePermission('funds.reconcile'), (req, res) => {
  const body = z.object({
    scope: z.string().default('daily-collections'),
    externalLines: z.array(z.object({
      providerRef: z.string(),
      amount: z.number().int(),
      status: z.enum(['settled', 'failed', 'pending', 'reversed']),
    })),
  }).parse(req.body);

  res.json(runReconciliation(body.scope, body.externalLines, req.auth!.userId));
});

fundsRouter.get('/reconciliation/breaks', requireAuth, requirePermission('funds.read'), (_req, res) => {
  const items = openBreaks();
  res.json({
    items,
    overSla: items.filter((b: any) => new Date(b.sla_due_at) < new Date()).length,
  });
});

fundsRouter.post('/reconciliation/breaks/:id/resolve', requireAuth, requirePermission('funds.reconcile'), (req, res) => {
  const body = z.object({ resolution: z.string().min(10) }).parse(req.body);
  resolveBreak(req.params.id, body.resolution, req.auth!.userId);
  res.json({ breakId: req.params.id, status: 'resolved' });
});

fundsRouter.get('/reconciliation/runs', requireAuth, requirePermission('funds.read'), (_req, res) => {
  res.json({ items: all(`SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT 60`) });
});

// ─────────────────────────── FR-403 closing ───────────────────────────

fundsRouter.get('/closing/due', requireAuth, requirePermission('funds.read'), (_req, res) => {
  res.json({ items: poolsDueForClosing() });
});

/** Closing is an approval action: it is never triggered by the maker alone. */
fundsRouter.post('/pools/:id/close', requireAuth, requirePermission('funds.approve'), (req, res) => {
  const body = z.object({ reason: z.string().min(10) }).parse(req.body);
  res.json(closePool(req.params.id, req.auth!.userId, body.reason));
});

// ─────────────────────────── FR-406 refunds ───────────────────────────

fundsRouter.get('/refunds', requireAuth, requirePermission('funds.read'), (req, res) => {
  const status = z.string().optional().parse(req.query.status);
  res.json({
    items: all<any>(
      `SELECT r.*, o.reference AS order_reference, p.title_ar, u.full_name AS investor_name
         FROM refunds r
         JOIN investment_orders o ON o.id = r.order_id
         JOIN pools p ON p.id = r.pool_id
         JOIN users u ON u.id = o.investor_id
        ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC`,
      status ? [status] : []),
  });
});

/** FR-405 — maker requests, a second authorised user approves. */
fundsRouter.post('/refunds/:id/submit', requireAuth, requirePermission('funds.request'), (req, res) => {
  const refund = get<any>(`SELECT * FROM refunds WHERE id = ?`, [req.params.id]);
  if (!refund) throw notFound();
  if (refund.status !== 'requested') throw conflict('invalid_status', 'حالة الاسترداد لا تسمح بالإرسال', 'Refund is not in a submittable state');

  run(`UPDATE refunds SET status = 'pending_approval', created_by = ? WHERE id = ?`, [req.auth!.userId, refund.id]);
  audit({ actorId: req.auth!.userId, action: 'refund.submitted', entityType: 'refund', entityId: refund.id,
          after: { status: 'pending_approval', amount: refund.amount } });
  res.json({ refundId: refund.id, status: 'pending_approval' });
});

fundsRouter.post('/refunds/:id/approve', requireAuth, requirePermission('funds.approve'), (req, res) => {
  const refund = get<any>(`SELECT * FROM refunds WHERE id = ?`, [req.params.id]);
  if (!refund) throw notFound();
  if (refund.status !== 'pending_approval') throw conflict('invalid_status', 'الاسترداد ليس بانتظار الاعتماد', 'Refund is not pending approval');
  assertDualControl(refund.created_by, req.auth!.userId);   // FR-405

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [refund.pool_id]);
  const payout = createPayout({
    direction: 'refund', amount: refund.amount, escrowAccountRef: pool.escrow_account_ref,
    idempotencyKey: `refund-${refund.id}`, orderId: refund.order_id,
  });

  run(`UPDATE refunds SET status = 'approved', approved_by = ?, payment_ref_id = ? WHERE id = ?`,
      [req.auth!.userId, payout.paymentReferenceId, refund.id]);
  audit({ actorId: req.auth!.userId, action: 'refund.approved', entityType: 'refund', entityId: refund.id,
          before: { status: 'pending_approval' }, after: { status: 'approved', providerRef: payout.providerRef } });

  const order = get<any>(`SELECT investor_id, reference FROM investment_orders WHERE id = ?`, [refund.order_id]);
  notify({ userId: order.investor_id, templateCode: 'refund_initiated',
           variables: { reference: order.reference, amount: refund.amount / 1000 } });

  res.json({ refundId: refund.id, status: 'approved', providerRef: payout.providerRef });
});

// ─────────────────────────── FR-404 milestone disbursements ───────────────────────────

fundsRouter.post('/pools/:id/disbursements', requireAuth, requirePermission('funds.request'), (req, res) => {
  const body = z.object({
    milestoneCode: z.string().min(2),
    milestoneLabel: z.string().min(3),
    beneficiary: z.string().min(3),
    beneficiaryIban: z.string().optional(),
    amount: z.number().int().positive(),
    conditionText: z.string().min(10),
  }).parse(req.body);

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();
  if (!['funded', 'disbursement', 'operating'].includes(pool.status)) {
    throw conflict('pool_not_disbursable', 'لا يمكن الصرف في حالة الفرصة الحالية', 'The pool cannot disburse in its current state');
  }

  // A pool never disburses more than it raised.
  const raised = get<{ total: number | null }>(
    `SELECT SUM(COALESCE(allocated_amount, amount)) AS total FROM investment_orders
      WHERE pool_id = ? AND status = 'allocated'`, [pool.id])?.total ?? 0;
  const alreadyPlanned = get<{ total: number | null }>(
    `SELECT SUM(amount) AS total FROM disbursements WHERE pool_id = ? AND status <> 'rejected' AND status <> 'cancelled'`,
    [pool.id])?.total ?? 0;

  if (alreadyPlanned + body.amount > raised + pool.owner_contribution) {
    throw unprocessable('exceeds_raised', 'إجمالي الصرف يتجاوز المبلغ المحصل',
      'Total disbursements would exceed the amount raised',
      { raised, ownerContribution: pool.owner_contribution, alreadyPlanned, requested: body.amount });
  }

  const id = newId();
  run(
    `INSERT INTO disbursements (id, pool_id, milestone_code, milestone_label, beneficiary, beneficiary_iban,
                                amount, condition_text, status, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?, 'draft', ?, ?)`,
    [id, pool.id, body.milestoneCode, body.milestoneLabel, body.beneficiary, body.beneficiaryIban ?? null,
     body.amount, body.conditionText, req.auth!.userId, nowIso()],
  );
  audit({ actorId: req.auth!.userId, action: 'disbursement.drafted', entityType: 'disbursement', entityId: id,
          after: { poolId: pool.id, amount: body.amount, beneficiary: body.beneficiary } });

  res.status(201).json({ disbursementId: id, status: 'draft' });
});

/** FR-404 — evidence that the milestone condition is met, before approval. */
fundsRouter.post('/disbursements/:id/evidence', requireAuth, requirePermission('funds.request'), (req, res) => {
  const body = z.object({
    fileName: z.string(), mimeType: z.string(), contentBase64: z.string(),
    conditionMet: z.boolean(), note: z.string().optional(),
  }).parse(req.body);

  const item = get<any>(`SELECT * FROM disbursements WHERE id = ?`, [req.params.id]);
  if (!item) throw notFound();

  const doc = attachDocument({
    ownerType: 'disbursement', ownerId: item.id, category: 'milestone_evidence',
    fileName: body.fileName, mimeType: body.mimeType, contentBase64: body.contentBase64,
    uploadedBy: req.auth!.userId,
  });
  run(`UPDATE disbursements SET evidence_doc_id = ?, condition_met = ?, status = 'pending_approval' WHERE id = ?`,
      [doc.documentId, body.conditionMet ? 1 : 0, item.id]);
  audit({ actorId: req.auth!.userId, action: 'disbursement.evidence_attached', entityType: 'disbursement',
          entityId: item.id, after: { conditionMet: body.conditionMet, documentId: doc.documentId }, reason: body.note });

  res.json({ disbursementId: item.id, status: 'pending_approval', documentId: doc.documentId });
});

/** AT-05 / FR-405 / BR-012 — the maker cannot approve; the condition must be met with evidence. */
fundsRouter.post('/disbursements/:id/approve', requireAuth, requirePermission('funds.approve'), (req, res) => {
  const body = z.object({ reason: z.string().min(5) }).parse(req.body);
  const item = get<any>(`SELECT * FROM disbursements WHERE id = ?`, [req.params.id]);
  if (!item) throw notFound();
  if (item.status !== 'pending_approval') {
    throw conflict('invalid_status', 'الطلب ليس بانتظار الاعتماد', 'The request is not pending approval');
  }
  assertDualControl(item.created_by, req.auth!.userId);

  if (item.condition_met !== 1 || !item.evidence_doc_id) {
    throw unprocessable('condition_not_met', 'لا يمكن الصرف قبل استيفاء الشرط وإرفاق الدليل',
      'Disbursement requires the condition to be met with attached evidence');
  }

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [item.pool_id]);
  const payout = createPayout({
    direction: 'disbursement', amount: item.amount, escrowAccountRef: pool.escrow_account_ref,
    idempotencyKey: `disb-${item.id}`,
  });

  const at = nowIso();
  tx(() => {
    run(`UPDATE disbursements SET status = 'approved', approved_by = ?, approved_at = ?, payment_ref_id = ? WHERE id = ?`,
        [req.auth!.userId, at, payout.paymentReferenceId, item.id]);
    if (pool.status === 'funded') {
      transition({ poolId: pool.id, to: 'disbursement', reason: 'first milestone disbursement approved',
                   actorId: req.auth!.userId });
    }
  });
  audit({ actorId: req.auth!.userId, action: 'disbursement.approved', entityType: 'disbursement', entityId: item.id,
          before: { status: 'pending_approval' }, after: { status: 'approved', providerRef: payout.providerRef },
          reason: body.reason });

  res.json({ disbursementId: item.id, status: 'approved', providerRef: payout.providerRef });
});

fundsRouter.get('/pools/:id/disbursements', requireAuth, requirePermission('funds.read'), (req, res) => {
  res.json({
    items: all(
      `SELECT d.*, maker.full_name AS created_by_name, checker.full_name AS approved_by_name
         FROM disbursements d
         LEFT JOIN users maker ON maker.id = d.created_by
         LEFT JOIN users checker ON checker.id = d.approved_by
        WHERE d.pool_id = ? ORDER BY d.created_at DESC`, [req.params.id]),
  });
});

// ─────────────────────────── FR-407/FR-408 distributions ───────────────────────────

/** BR-015 — distributions come only from realised, evidenced cash. */
fundsRouter.post('/pools/:id/distributions', requireAuth, requirePermission('distribution.create'), (req, res) => {
  const body = z.object({
    periodLabel: z.string().min(4),
    grossAmount: z.number().int().positive(),
    cashEvidence: z.object({
      fileName: z.string(), mimeType: z.string(), contentBase64: z.string(),
    }),
    applyMonitoringFee: z.boolean().default(true),
  }).parse(req.body);

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();
  if (!['operating', 'workout'].includes(pool.status)) {
    throw conflict('pool_not_operating', 'لا يمكن التوزيع في حالة الفرصة الحالية', 'Distributions require an operating pool');
  }

  const holdings = all<any>(`SELECT investor_id, units FROM holdings WHERE pool_id = ? AND units > 0 ORDER BY investor_id`,
                            [pool.id]);
  if (holdings.length === 0) throw unprocessable('no_holdings', 'لا توجد ملكيات مسجلة', 'No holdings recorded for this pool');

  const evidence = attachDocument({
    ownerType: 'pool', ownerId: pool.id, category: `distribution_evidence_${body.periodLabel}`,
    fileName: body.cashEvidence.fileName, mimeType: body.cashEvidence.mimeType,
    contentBase64: body.cashEvidence.contentBase64, uploadedBy: req.auth!.userId, visibility: 'internal',
  });

  const feeSchedule = fees();
  const feeAmount = body.applyMonitoringFee ? applyBps(body.grossAmount, feeSchedule.monitoringFeeBps) : 0;
  const netAmount = body.grossAmount - feeAmount;

  // FR-407 — investor shares plus fees must equal the approved amount exactly.
  const shares = proRata(netAmount, holdings.map((h) => h.units));
  const id = newId();
  const at = nowIso();

  tx(() => {
    run(`INSERT INTO distributions (id, pool_id, period_label, gross_amount, fee_amount, net_amount,
                                    cash_evidence_doc_id, status, created_by, created_at)
         VALUES (?,?,?,?,?,?,?, 'pending_approval', ?, ?)`,
        [id, pool.id, body.periodLabel, body.grossAmount, feeAmount, netAmount, evidence.documentId,
         req.auth!.userId, at]);

    holdings.forEach((holding, index) => {
      run(`INSERT INTO distribution_lines (id, distribution_id, investor_id, units, gross_amount, fee_amount, net_amount)
           VALUES (?,?,?,?,?,?,?)`,
          [newId(), id, holding.investor_id, holding.units, shares[index], 0, shares[index]]);
    });
  });

  const linesTotal = shares.reduce((sum, s) => sum + s, 0);
  audit({ actorId: req.auth!.userId, action: 'distribution.created', entityType: 'distribution', entityId: id,
          after: { grossAmount: body.grossAmount, feeAmount, netAmount, investors: holdings.length } });

  res.status(201).json({
    distributionId: id, status: 'pending_approval',
    grossAmount: body.grossAmount, feeAmount, netAmount,
    // Reconciliation check surfaced to the reviewer: lines + fees = gross.
    balanced: linesTotal + feeAmount === body.grossAmount,
    investors: holdings.length,
  });
});

fundsRouter.post('/distributions/:id/approve', requireAuth, requirePermission('funds.approve'), (req, res) => {
  const body = z.object({ reason: z.string().min(5) }).parse(req.body);
  const distribution = get<any>(`SELECT * FROM distributions WHERE id = ?`, [req.params.id]);
  if (!distribution) throw notFound();
  if (distribution.status !== 'pending_approval') {
    throw conflict('invalid_status', 'التوزيع ليس بانتظار الاعتماد', 'The distribution is not pending approval');
  }
  assertDualControl(distribution.created_by, req.auth!.userId);
  if (!distribution.cash_evidence_doc_id) {
    throw unprocessable('cash_evidence_required', 'يلزم دليل نقد محقق قبل الاعتماد',
      'Realised-cash evidence is required before approval');   // BR-015
  }

  const lines = all<any>(`SELECT * FROM distribution_lines WHERE distribution_id = ?`, [distribution.id]);
  const linesTotal = lines.reduce((sum, l) => sum + l.net_amount, 0);
  if (linesTotal + distribution.fee_amount !== distribution.gross_amount) {
    throw unprocessable('distribution_unbalanced', 'مجموع الحصص والرسوم لا يساوي المبلغ المعتمد',
      'Investor shares plus fees do not equal the approved amount');
  }

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [distribution.pool_id]);
  const at = nowIso();

  tx(() => {
    run(`UPDATE distributions SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?`,
        [req.auth!.userId, at, distribution.id]);

    for (const line of lines) {
      const payout = createPayout({
        direction: 'distribution', amount: line.net_amount, escrowAccountRef: pool.escrow_account_ref,
        idempotencyKey: `dist-${line.id}`,
      });
      run(`UPDATE distribution_lines SET payment_ref_id = ? WHERE id = ?`, [payout.paymentReferenceId, line.id]);
      run(`UPDATE holdings SET distributed_amount = distributed_amount + ?, updated_at = ?
            WHERE pool_id = ? AND investor_id = ?`, [line.net_amount, at, distribution.pool_id, line.investor_id]);
      notify({ userId: line.investor_id, templateCode: 'distribution_paid',
               variables: { poolTitle: pool.title_ar, amount: line.net_amount / 1000, period: distribution.period_label } });
    }
  });
  audit({ actorId: req.auth!.userId, action: 'distribution.approved', entityType: 'distribution',
          entityId: distribution.id, after: { status: 'approved', lines: lines.length }, reason: body.reason });

  res.json({ distributionId: distribution.id, status: 'approved', lines: lines.length });
});

fundsRouter.get('/pools/:id/distributions', requireAuth, requirePermission('funds.read'), (req, res) => {
  const items = all<any>(`SELECT * FROM distributions WHERE pool_id = ? ORDER BY created_at DESC`, [req.params.id]);
  res.json({
    items: items.map((d) => ({
      ...d,
      lines: all(`SELECT dl.*, u.full_name AS investor_name FROM distribution_lines dl
                    JOIN users u ON u.id = dl.investor_id WHERE dl.distribution_id = ?`, [d.id]),
    })),
  });
});

/** Money-operations queue: everything awaiting a second pair of eyes. */
fundsRouter.get('/queue', requireAuth, requirePermission('funds.read'), (_req, res) => {
  res.json({
    disbursements: all(`SELECT d.*, p.title_ar FROM disbursements d JOIN pools p ON p.id = d.pool_id
                         WHERE d.status = 'pending_approval' ORDER BY d.created_at`),
    refunds: all(`SELECT r.*, p.title_ar FROM refunds r JOIN pools p ON p.id = r.pool_id
                   WHERE r.status IN ('requested','pending_approval') ORDER BY r.created_at`),
    distributions: all(`SELECT d.*, p.title_ar FROM distributions d JOIN pools p ON p.id = d.pool_id
                         WHERE d.status = 'pending_approval' ORDER BY d.created_at`),
    breaks: openBreaks(),
    closingDue: poolsDueForClosing(),
  });
});
