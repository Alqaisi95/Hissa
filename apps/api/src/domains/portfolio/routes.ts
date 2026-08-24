/** Post-investment monitoring and investor portfolio (FR-501..FR-509). */
import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx } from '../../db/index.ts';
import { newId, nowIso, plus, days, hours } from '../../lib/ids.ts';
import { audit } from '../../lib/audit.ts';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { slas, findBannedTerms } from '../../lib/settings.ts';
import { transition } from '../../workflow/poolState.ts';
import { attachDocument } from '../../lib/documents.ts';
import { notify } from '../../integrations/notifications.ts';
import { track } from '../analytics/track.ts';

export const portfolioRouter = Router();

// ─────────────────────────── FR-505 investor portfolio ───────────────────────────

portfolioRouter.get('/', requireAuth, (req, res) => {
  const holdings = all<any>(
    `SELECT h.*, p.reference, p.title_ar, p.status AS pool_status, p.structure, p.tenor_months,
            p.total_units, p.unit_price, p.funded_at
       FROM holdings h JOIN pools p ON p.id = h.pool_id
      WHERE h.investor_id = ? ORDER BY h.created_at DESC`, [req.auth!.userId]);

  const pending = all<any>(
    `SELECT o.id, o.reference, o.amount, o.status, o.created_at, p.title_ar, p.reference AS pool_reference
       FROM investment_orders o JOIN pools p ON p.id = o.pool_id
      WHERE o.investor_id = ? AND o.status IN ('pending','confirmed') ORDER BY o.created_at DESC`, [req.auth!.userId]);

  const invested = holdings.reduce((sum, h) => sum + h.invested_amount, 0);
  const distributed = holdings.reduce((sum, h) => sum + h.distributed_amount, 0);
  const committedPending = pending.reduce((sum, o) => sum + o.amount, 0);

  res.json({
    summary: {
      // FR-505 — nominal figures only; no market valuation is implied.
      investedAmount: invested,
      distributedAmount: distributed,
      committedPending,
      activePools: holdings.filter((h) => ['operating', 'disbursement', 'workout'].includes(h.pool_status)).length,
      closedPools: holdings.filter((h) => h.pool_status === 'closed').length,
      valuationNoteAr: 'تعرض القيم الاسمية للاستثمار والتوزيعات المحققة فقط. لا تقدم المنصة قيمة سوقية للحصص.',
    },
    holdings: holdings.map((h) => ({
      ...h,
      ownershipBps: Math.round((h.units * 10_000) / h.total_units),
      // FR-506 — expected distributions are shown separately from paid ones.
      distributions: all(
        `SELECT d.period_label, d.status, dl.net_amount, d.paid_at, d.approved_at
           FROM distribution_lines dl JOIN distributions d ON d.id = dl.distribution_id
          WHERE dl.investor_id = ? AND d.pool_id = ? ORDER BY d.created_at DESC`, [req.auth!.userId, h.pool_id]),
      latestReport: get(
        `SELECT period_label, status, published_at FROM project_reports
          WHERE pool_id = ? AND status = 'published' ORDER BY period_end DESC LIMIT 1`, [h.pool_id]),
    })),
    pendingCommitments: pending,
  });
});

/** FR-408 — downloadable statement for a period. */
portfolioRouter.get('/statement', requireAuth, (req, res) => {
  const query = z.object({
    from: z.string().default(new Date(Date.now() - days(365)).toISOString().slice(0, 10)),
    to: z.string().default(nowIso().slice(0, 10)),
  }).parse(req.query);

  const from = `${query.from}T00:00:00.000Z`;
  const to = `${query.to}T23:59:59.999Z`;

  const investments = all<any>(
    `SELECT o.reference, o.created_at, o.confirmed_at, o.amount, COALESCE(o.allocated_amount, o.amount) AS allocated,
            o.refunded_amount, o.status, p.reference AS pool_reference, p.title_ar
       FROM investment_orders o JOIN pools p ON p.id = o.pool_id
      WHERE o.investor_id = ? AND o.created_at BETWEEN ? AND ? ORDER BY o.created_at`,
    [req.auth!.userId, from, to]);

  const distributions = all<any>(
    `SELECT d.period_label, d.approved_at, d.paid_at, d.status, dl.net_amount, dl.units,
            p.reference AS pool_reference, p.title_ar
       FROM distribution_lines dl JOIN distributions d ON d.id = dl.distribution_id
       JOIN pools p ON p.id = d.pool_id
      WHERE dl.investor_id = ? AND d.created_at BETWEEN ? AND ? ORDER BY d.created_at`,
    [req.auth!.userId, from, to]);

  const refunds = all<any>(
    `SELECT r.amount, r.status, r.reason, r.created_at, r.settled_at, p.reference AS pool_reference
       FROM refunds r JOIN investment_orders o ON o.id = r.order_id JOIN pools p ON p.id = r.pool_id
      WHERE o.investor_id = ? AND r.created_at BETWEEN ? AND ? ORDER BY r.created_at`,
    [req.auth!.userId, from, to]);

  const user = get<any>(`SELECT full_name FROM users WHERE id = ?`, [req.auth!.userId]);
  res.json({
    statement: {
      investorName: user.full_name,
      period: { from: query.from, to: query.to },
      generatedAt: nowIso(),
      investments, distributions, refunds,
      totals: {
        invested: investments.reduce((s, i) => s + (i.status === 'allocated' ? i.allocated : 0), 0),
        distributed: distributions.filter((d) => d.status === 'paid' || d.status === 'approved')
                                  .reduce((s, d) => s + d.net_amount, 0),
        refunded: refunds.filter((r) => r.status === 'settled').reduce((s, r) => s + r.amount, 0),
      },
      noteAr: 'كشف حساب استرشادي يعكس البيانات المسجلة في النظام حتى وقت الاستخراج.',
    },
  });
});

// ─────────────────────────── FR-501 report schedule ───────────────────────────

portfolioRouter.post('/pools/:id/report-schedule', requireAuth, requirePermission('pool.monitor'), (req, res) => {
  const body = z.object({
    frequency: z.enum(['monthly', 'quarterly']),
    startDate: z.string(),
    periods: z.number().int().min(1).max(60),
    graceDays: z.number().int().min(0).max(30).default(15),
  }).parse(req.body);

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();

  const stepMonths = body.frequency === 'monthly' ? 1 : 3;
  const created: string[] = [];
  const at = nowIso();

  tx(() => {
    for (let index = 0; index < body.periods; index += 1) {
      const start = new Date(body.startDate);
      start.setUTCMonth(start.getUTCMonth() + index * stepMonths);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + stepMonths);
      end.setUTCDate(end.getUTCDate() - 1);

      const label = body.frequency === 'monthly'
        ? `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
        : `${start.getUTCFullYear()}-Q${Math.floor(start.getUTCMonth() / 3) + 1}`;

      const id = newId();
      run(`INSERT INTO project_reports (id, pool_id, period_label, period_start, period_end, due_at, status, created_at)
           VALUES (?,?,?,?,?,?, 'scheduled', ?)
           ON CONFLICT(pool_id, period_label) DO NOTHING`,
          [id, pool.id, label, start.toISOString(), end.toISOString(),
           plus(end.toISOString(), days(body.graceDays)), at]);
      created.push(label);
    }
  });
  audit({ actorId: req.auth!.userId, action: 'report_schedule.created', entityType: 'pool', entityId: pool.id,
          after: { frequency: body.frequency, periods: created } });

  res.status(201).json({ poolId: pool.id, periods: created });
});

/** FR-502 — covenants monitored against reported KPIs. */
portfolioRouter.post('/pools/:id/covenants', requireAuth, requirePermission('pool.monitor'), (req, res) => {
  const body = z.object({
    code: z.string().min(2),
    labelAr: z.string().min(5),
    metric: z.string().min(2),
    operator: z.enum(['gte', 'lte']),
    threshold: z.number().int(),
    breachAction: z.enum(['alert', 'escalate', 'suspend_distribution']).default('alert'),
  }).parse(req.body);

  const id = newId();
  run(`INSERT INTO covenants (id, pool_id, code, label_ar, metric, operator, threshold, breach_action, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, req.params.id, body.code, body.labelAr, body.metric, body.operator, body.threshold, body.breachAction, nowIso()]);
  res.status(201).json({ covenantId: id });
});

// ─────────────────────────── FR-502/FR-503 reporting ───────────────────────────

portfolioRouter.get('/pools/:id/reports', requireAuth, (req, res) => {
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();

  const isStaff = req.auth!.roles.some((r) => ['portfolio_ops', 'compliance', 'auditor', 'investment_analyst'].includes(r));
  const isOwner = get<any>(
    `SELECT 1 FROM project_applications a JOIN entity_people ep ON ep.entity_id = a.entity_id
      WHERE a.id = ? AND ep.user_id = ?`, [pool.application_id, req.auth!.userId]) != null;
  const isInvestor = get<any>(`SELECT 1 FROM holdings WHERE pool_id = ? AND investor_id = ?`,
                              [pool.id, req.auth!.userId]) != null;
  if (!isStaff && !isOwner && !isInvestor) throw forbidden();

  // FR-503 — investors never see drafts, only published reports.
  const statuses = isStaff || isOwner ? null : ['published'];
  const rows = all<any>(
    `SELECT * FROM project_reports WHERE pool_id = ?
      ${statuses ? `AND status IN (${statuses.map(() => '?').join(',')})` : ''}
      ORDER BY period_end DESC`,
    statuses ? [pool.id, ...statuses] : [pool.id]);

  res.json({ items: rows.map((r) => ({ ...r, kpis: JSON.parse(r.kpis) })) });
});

portfolioRouter.post('/reports/:id/submit', requireAuth, requirePermission('report.submit'), (req, res) => {
  const body = z.object({
    kpis: z.record(z.object({ actual: z.number(), forecast: z.number().optional() })),
    narrative: z.string().min(20),
    varianceNote: z.string().optional(),
    evidence: z.object({ fileName: z.string(), mimeType: z.string(), contentBase64: z.string() }).optional(),
  }).parse(req.body);

  const report = get<any>(`SELECT * FROM project_reports WHERE id = ?`, [req.params.id]);
  if (!report) throw notFound();

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [report.pool_id]);
  const isOwner = get<any>(
    `SELECT 1 FROM project_applications a JOIN entity_people ep ON ep.entity_id = a.entity_id
      WHERE a.id = ? AND ep.user_id = ?`, [pool.application_id, req.auth!.userId]) != null;
  if (!isOwner && !req.auth!.roles.includes('portfolio_ops')) throw forbidden();

  const banned = findBannedTerms(body.narrative);
  if (banned.length) {
    throw unprocessable('banned_terms', 'يحتوي التقرير على عبارات ضمان غير مسموحة',
      'The report contains prohibited guarantee wording', { terms: banned });
  }

  let evidenceId: string | null = report.evidence_doc_id;
  if (body.evidence) {
    evidenceId = attachDocument({
      ownerType: 'report', ownerId: report.id, category: 'report_evidence',
      fileName: body.evidence.fileName, mimeType: body.evidence.mimeType,
      contentBase64: body.evidence.contentBase64, uploadedBy: req.auth!.userId,
    }).documentId;
  }

  const at = nowIso();
  run(`UPDATE project_reports SET kpis = ?, narrative = ?, variance_note = ?, evidence_doc_id = ?,
                                  status = 'submitted', submitted_by = ? WHERE id = ?`,
      [JSON.stringify(body.kpis), body.narrative, body.varianceNote ?? null, evidenceId, req.auth!.userId, report.id]);
  audit({ actorId: req.auth!.userId, action: 'report.submitted', entityType: 'project_report', entityId: report.id,
          after: { period: report.period_label, late: new Date(at) > new Date(report.due_at) } });

  res.json({
    reportId: report.id, status: 'submitted',
    late: new Date(at) > new Date(report.due_at),
    variances: computeVariances(body.kpis),
  });
});

/** FR-502 — actual vs forecast, with the deviation and its percentage. */
export function computeVariances(kpis: Record<string, { actual: number; forecast?: number }>) {
  return Object.entries(kpis).map(([metric, values]) => {
    const forecast = values.forecast;
    const deviation = forecast === undefined ? null : values.actual - forecast;
    return {
      metric,
      actual: values.actual,
      forecast: forecast ?? null,
      deviation,
      // Basis points keeps the arithmetic integer-safe.
      deviationBps: forecast ? Math.round(((values.actual - forecast) * 10_000) / forecast) : null,
    };
  });
}

/** FR-503 — review before publication; investors never see an unapproved draft. */
portfolioRouter.post('/reports/:id/publish', requireAuth, requirePermission('report.publish'), (req, res) => {
  const body = z.object({ reason: z.string().min(5) }).parse(req.body);
  const report = get<any>(`SELECT * FROM project_reports WHERE id = ?`, [req.params.id]);
  if (!report) throw notFound();
  if (report.status !== 'submitted') {
    throw conflict('not_submitted', 'التقرير غير جاهز للنشر', 'The report is not ready for publication');
  }
  if (!report.evidence_doc_id) {
    throw unprocessable('evidence_required', 'يلزم إرفاق دليل التقرير قبل النشر',
      'Supporting evidence must be attached before publication');
  }
  if (report.submitted_by === req.auth!.userId) {
    throw conflict('dual_control_violation', 'لا يمكن لنفس المستخدم الإرسال والنشر',
      'The submitter cannot publish their own report');
  }

  const at = nowIso();
  run(`UPDATE project_reports SET status = 'published', approved_by = ?, published_at = ? WHERE id = ?`,
      [req.auth!.userId, at, report.id]);
  audit({ actorId: req.auth!.userId, action: 'report.published', entityType: 'project_report', entityId: report.id,
          after: { status: 'published' }, reason: body.reason });
  track('report_published', null, { onTime: new Date(at) <= new Date(report.due_at) }, report.pool_id);

  const pool = get<any>(`SELECT title_ar FROM pools WHERE id = ?`, [report.pool_id]);
  for (const holder of all<{ investor_id: string }>(`SELECT investor_id FROM holdings WHERE pool_id = ?`, [report.pool_id])) {
    notify({ userId: holder.investor_id, templateCode: 'report_published',
             variables: { poolTitle: pool.title_ar, period: report.period_label } });
  }

  // FR-502/FR-504 — covenant breaches raise alerts on publication.
  const breaches = evaluateCovenants(report.pool_id, JSON.parse(report.kpis));
  res.json({ reportId: report.id, status: 'published', covenantBreaches: breaches });
});

export function evaluateCovenants(poolId: string, kpis: Record<string, { actual: number }>) {
  const covenants = all<any>(`SELECT * FROM covenants WHERE pool_id = ?`, [poolId]);
  const breaches: { code: string; metric: string; actual: number; threshold: number }[] = [];
  const at = nowIso();

  for (const covenant of covenants) {
    const value = kpis[covenant.metric]?.actual;
    if (value === undefined) continue;
    const breached = covenant.operator === 'gte' ? value < covenant.threshold : value > covenant.threshold;
    if (!breached) continue;

    breaches.push({ code: covenant.code, metric: covenant.metric, actual: value, threshold: covenant.threshold });
    run(`INSERT INTO alerts (id, pool_id, type, severity, message_ar, context, status, created_at)
         VALUES (?,?, 'covenant_breach', ?, ?, ?, 'open', ?)`,
        [newId(), poolId, covenant.breach_action === 'alert' ? 'warning' : 'critical',
         `مخالفة تعهد: ${covenant.label_ar}`,
         JSON.stringify({ code: covenant.code, metric: covenant.metric, actual: value, threshold: covenant.threshold }),
         at]);
    run(`INSERT INTO cases (id, reference, type, subject, body, severity, status, related_type, related_id,
                            sla_due_at, created_at, updated_at)
         VALUES (?,?, 'default', ?, ?, 'high', 'open', 'pool', ?, ?, ?, ?)`,
        [newId(), `CASE-COV-${covenant.code}-${at.slice(0, 10)}`, `مخالفة تعهد — ${covenant.label_ar}`,
         `القيمة الفعلية ${value} مقابل الحد ${covenant.threshold}`, poolId, plus(at, days(5)), at, at]);
  }
  return breaches;
}

// ─────────────────────────── FR-504 alerts ───────────────────────────

portfolioRouter.get('/alerts', requireAuth, requirePermission('monitor.read'), (req, res) => {
  const status = z.string().optional().parse(req.query.status);
  res.json({
    items: all<any>(
      `SELECT a.*, p.title_ar, p.reference FROM alerts a LEFT JOIN pools p ON p.id = a.pool_id
        ${status ? 'WHERE a.status = ?' : ''} ORDER BY
        CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.created_at DESC`,
      status ? [status] : []),
  });
});

portfolioRouter.post('/alerts/:id/resolve', requireAuth, requirePermission('pool.monitor'), (req, res) => {
  const body = z.object({ resolution: z.string().min(5) }).parse(req.body);
  run(`UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?`, [nowIso(), req.params.id]);
  audit({ actorId: req.auth!.userId, action: 'alert.resolved', entityType: 'alert', entityId: req.params.id,
          reason: body.resolution });
  res.json({ alertId: req.params.id, status: 'resolved' });
});

// ─────────────────────────── FR-507 voting ───────────────────────────

portfolioRouter.post('/pools/:id/votes', requireAuth, requirePermission('pool.monitor'), (req, res) => {
  const body = z.object({
    titleAr: z.string().min(5),
    description: z.string().min(20),
    opensAt: z.string(),
    closesAt: z.string(),
    recordDate: z.string(),
  }).parse(req.body);

  const id = newId();
  run(`INSERT INTO votes (id, pool_id, title_ar, description, opens_at, closes_at, record_date, status, created_at)
       VALUES (?,?,?,?,?,?,?, 'open', ?)`,
      [id, req.params.id, body.titleAr, body.description, body.opensAt, body.closesAt, body.recordDate, nowIso()]);

  for (const holder of all<{ investor_id: string }>(`SELECT investor_id FROM holdings WHERE pool_id = ?`, [req.params.id])) {
    notify({ userId: holder.investor_id, templateCode: 'vote_opened', variables: { title: body.titleAr, closesAt: body.closesAt } });
  }
  res.status(201).json({ voteId: id });
});

/** Votes an investor can act on, with their own ballot if already cast. */
portfolioRouter.get('/pools/:id/votes', requireAuth, (req, res) => {
  const holding = get<any>(`SELECT units FROM holdings WHERE pool_id = ? AND investor_id = ?`,
                           [req.params.id, req.auth!.userId]);
  const isStaff = req.auth!.roles.some((r) => ['portfolio_ops', 'compliance', 'auditor'].includes(r));
  if (!holding && !isStaff) throw forbidden();

  const votes = all<any>(`SELECT * FROM votes WHERE pool_id = ? ORDER BY closes_at DESC`, [req.params.id]);
  res.json({
    items: votes.map((vote) => ({
      id: vote.id, titleAr: vote.title_ar, description: vote.description,
      opensAt: vote.opens_at, closesAt: vote.closes_at, recordDate: vote.record_date, status: vote.status,
      myBallot: get<any>(`SELECT choice, weight, created_at FROM vote_ballots WHERE vote_id = ? AND investor_id = ?`,
                         [vote.id, req.auth!.userId]) ?? null,
      myWeight: holding?.units ?? 0,
    })),
  });
});

portfolioRouter.post('/votes/:id/ballot', requireAuth, (req, res) => {
  const body = z.object({ choice: z.enum(['for', 'against', 'abstain']) }).parse(req.body);
  const vote = get<any>(`SELECT * FROM votes WHERE id = ?`, [req.params.id]);
  if (!vote) throw notFound();

  const now = new Date();
  if (vote.status !== 'open' || now < new Date(vote.opens_at) || now > new Date(vote.closes_at)) {
    throw conflict('vote_closed', 'التصويت غير مفتوح حاليًا', 'Voting is not currently open');
  }
  // FR-507 — eligibility and weight are taken from holdings at the record date.
  const holding = get<any>(`SELECT units FROM holdings WHERE pool_id = ? AND investor_id = ? AND created_at <= ?`,
                           [vote.pool_id, req.auth!.userId, vote.record_date]);
  if (!holding || holding.units <= 0) {
    throw forbidden('لا تملك حقوق تصويت في هذه الفرصة بتاريخ الإغلاق', 'You hold no voting rights as at the record date');
  }
  if (get<any>(`SELECT 1 FROM vote_ballots WHERE vote_id = ? AND investor_id = ?`, [vote.id, req.auth!.userId])) {
    throw conflict('already_voted', 'سجلت صوتك مسبقًا', 'You have already voted');
  }

  run(`INSERT INTO vote_ballots (id, vote_id, investor_id, choice, weight, created_at) VALUES (?,?,?,?,?,?)`,
      [newId(), vote.id, req.auth!.userId, body.choice, holding.units, nowIso()]);
  audit({ actorId: req.auth!.userId, action: 'vote.ballot_cast', entityType: 'vote', entityId: vote.id,
          after: { choice: body.choice, weight: holding.units } });

  res.status(201).json({ voteId: vote.id, choice: body.choice, weight: holding.units });
});

portfolioRouter.get('/votes/:id/results', requireAuth, (req, res) => {
  const vote = get<any>(`SELECT * FROM votes WHERE id = ?`, [req.params.id]);
  if (!vote) throw notFound();

  const ballots = all<any>(`SELECT choice, weight FROM vote_ballots WHERE vote_id = ?`, [vote.id]);
  const tally = { for: 0, against: 0, abstain: 0 };
  for (const ballot of ballots) tally[ballot.choice as keyof typeof tally] += ballot.weight;

  const totalUnits = get<{ total: number | null }>(
    `SELECT SUM(units) AS total FROM holdings WHERE pool_id = ?`, [vote.pool_id])?.total ?? 0;

  res.json({
    vote: { id: vote.id, titleAr: vote.title_ar, status: vote.status, closesAt: vote.closes_at, recordDate: vote.record_date },
    tally, ballots: ballots.length, totalUnits,
    turnoutBps: totalUnits ? Math.round(((tally.for + tally.against + tally.abstain) * 10_000) / totalUnits) : 0,
  });
});

// ─────────────────────────── FR-508/FR-509 default, workout, closure ───────────────────────────

portfolioRouter.post('/pools/:id/default', requireAuth, requirePermission('pool.monitor'), (req, res) => {
  const body = z.object({
    reason: z.string().min(20),
    plan: z.string().min(20),
    severity: z.enum(['high', 'critical']).default('high'),
  }).parse(req.body);

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();

  const at = nowIso();
  const caseId = newId();
  tx(() => {
    transition({ poolId: pool.id, to: 'default', reason: body.reason, actorId: req.auth!.userId });
    run(`INSERT INTO cases (id, reference, type, subject, body, severity, status, raised_by, related_type, related_id,
                            sla_due_at, created_at, updated_at)
         VALUES (?,?, 'default', ?, ?, ?, 'open', ?, 'pool', ?, ?, ?, ?)`,
        [caseId, `CASE-DEF-${pool.reference}`, `تعثر — ${pool.title_ar}`, body.plan, body.severity,
         req.auth!.userId, pool.id, plus(at, days(3)), at, at]);
  });

  // FR-508 — investors are told, with the plan, not left to discover it.
  for (const holder of all<{ investor_id: string }>(`SELECT investor_id FROM holdings WHERE pool_id = ?`, [pool.id])) {
    notify({ userId: holder.investor_id, templateCode: 'pool_default', variables: { poolTitle: pool.title_ar } });
  }
  res.json({ poolId: pool.id, status: 'default', caseId });
});

portfolioRouter.post('/pools/:id/workout', requireAuth, requirePermission('pool.monitor'), (req, res) => {
  const body = z.object({ reason: z.string().min(20) }).parse(req.body);
  transition({ poolId: req.params.id, to: 'workout', reason: body.reason, actorId: req.auth!.userId });
  res.json({ poolId: req.params.id, status: 'workout' });
});

/** FR-509 — final settlement; the pool becomes read-only after reconciliation. */
portfolioRouter.post('/pools/:id/close', requireAuth, requirePermission('pool.monitor'), (req, res) => {
  const body = z.object({ reason: z.string().min(20), finalSettlementNote: z.string().min(10) }).parse(req.body);
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();

  const unresolved = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM reconciliation_breaks b
       JOIN investment_orders o ON o.id = b.order_id
      WHERE o.pool_id = ? AND b.status <> 'resolved'`, [pool.id])!.n;
  if (unresolved > 0) {
    throw unprocessable('unresolved_breaks', 'توجد فروقات مطابقة غير مغلقة',
      'Unresolved reconciliation breaks must be closed first', { unresolved });
  }
  // Final settlement means nothing is still in flight: an approved-but-unpaid
  // distribution or an unexecuted disbursement blocks closure just as an open refund does.
  const inFlight = get<{ refunds: number; distributions: number; disbursements: number }>(
    `SELECT
       (SELECT COUNT(*) FROM refunds       WHERE pool_id = ? AND status NOT IN ('settled','failed'))       AS refunds,
       (SELECT COUNT(*) FROM distributions WHERE pool_id = ? AND status NOT IN ('paid','cancelled'))       AS distributions,
       (SELECT COUNT(*) FROM disbursements WHERE pool_id = ? AND status IN ('draft','pending_approval','approved')) AS disbursements`,
    [pool.id, pool.id, pool.id])!;
  const pendingMoney = inFlight.refunds + inFlight.distributions + inFlight.disbursements;
  if (pendingMoney > 0) {
    throw unprocessable('pending_money_movements', 'توجد حركات مالية غير مكتملة',
      'Outstanding money movements must be completed first', { pendingMoney, breakdown: inFlight });
  }

  transition({ poolId: pool.id, to: 'closed', reason: body.reason, actorId: req.auth!.userId,
               payload: { finalSettlementNote: body.finalSettlementNote } });
  res.json({ poolId: pool.id, status: 'closed', readOnly: true });
});

/** Monitoring dashboard for portfolio operations. */
portfolioRouter.get('/monitoring', requireAuth, requirePermission('monitor.read'), (_req, res) => {
  const at = nowIso();
  res.json({
    pools: all(`SELECT id, reference, title_ar, status, funded_at, tenor_months FROM pools
                 WHERE status IN ('disbursement','operating','default','workout') ORDER BY funded_at DESC`),
    reportsDue: all(`SELECT r.*, p.title_ar FROM project_reports r JOIN pools p ON p.id = r.pool_id
                      WHERE r.status IN ('scheduled','draft') AND r.due_at <= ? ORDER BY r.due_at`, [plus(at, days(7))]),
    reportsLate: all(`SELECT r.*, p.title_ar FROM project_reports r JOIN pools p ON p.id = r.pool_id
                       WHERE r.status IN ('scheduled','draft','late') AND r.due_at < ? ORDER BY r.due_at`, [at]),
    pendingReview: all(`SELECT r.*, p.title_ar FROM project_reports r JOIN pools p ON p.id = r.pool_id
                         WHERE r.status = 'submitted' ORDER BY r.due_at`),
    openAlerts: all(`SELECT * FROM alerts WHERE status = 'open' ORDER BY created_at DESC LIMIT 50`),
  });
});
