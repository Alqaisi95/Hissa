/** Cases, complaints and data-subject requests (FR-604, FR-605, FR-610). */
import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../../db/index.ts';
import { newId, nowIso, plus, hours, makeReference } from '../../lib/ids.ts';
import { audit } from '../../lib/audit.ts';
import { forbidden, notFound } from '../../lib/errors.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { slas } from '../../lib/settings.ts';
import { notify } from '../../integrations/notifications.ts';
import { nextSequence } from '../../db/index.ts';
import { track } from '../analytics/track.ts';

export const casesRouter = Router();

const COMPLAINT_CATEGORIES = [
  { code: 'investment_process', labelAr: 'إجراءات الاستثمار', slaHours: 120 },
  { code: 'payment_refund', labelAr: 'الدفع أو الاسترداد', slaHours: 72 },
  { code: 'disclosure_accuracy', labelAr: 'دقة الإفصاح أو المعلومات', slaHours: 72 },
  { code: 'project_reporting', labelAr: 'تقارير المشروع', slaHours: 120 },
  { code: 'data_privacy', labelAr: 'الخصوصية وحماية البيانات', slaHours: 72 },
  { code: 'service_quality', labelAr: 'جودة الخدمة', slaHours: 168 },
  { code: 'other', labelAr: 'أخرى', slaHours: 168 },
];

casesRouter.get('/complaints/categories', (_req, res) => res.json({ categories: COMPLAINT_CATEGORIES }));

/** FR-605 — a complaint always yields a reference, an SLA, an owner and an acknowledgement. */
casesRouter.post('/complaints', requireAuth, requirePermission('complaint.create'), (req, res) => {
  const body = z.object({
    category: z.string().min(2),
    subject: z.string().min(5).max(200),
    body: z.string().min(20).max(5000),
    relatedType: z.string().optional(),
    relatedId: z.string().optional(),
  }).parse(req.body);

  const category = COMPLAINT_CATEGORIES.find((c) => c.code === body.category) ?? COMPLAINT_CATEGORIES.at(-1)!;
  const id = newId();
  const reference = makeReference('CMP', nextSequence('cases'));
  const at = nowIso();
  const slaDueAt = plus(at, hours(Math.min(category.slaHours, slas().complaintResolutionHours * 2)));

  run(
    `INSERT INTO cases (id, reference, type, subject, body, severity, status, raised_by, related_type, related_id,
                        sla_due_at, created_at, updated_at)
     VALUES (?,?, 'complaint', ?,?, ?, 'open', ?,?,?,?,?,?)`,
    [id, reference, body.subject, body.body, body.category === 'data_privacy' ? 'high' : 'normal',
     req.auth!.userId, body.relatedType ?? null, body.relatedId ?? null, slaDueAt, at, at],
  );
  audit({ actorId: req.auth!.userId, action: 'complaint.opened', entityType: 'case', entityId: id,
          after: { reference, category: body.category } });
  notify({ userId: req.auth!.userId, templateCode: 'complaint_received', variables: { reference, slaDueAt } });
  track('complaint_opened', req.auth!.userId, { category: body.category });

  res.status(201).json({ caseId: id, reference, slaDueAt, status: 'open' });
});

casesRouter.get('/complaints/mine', requireAuth, (req, res) => {
  res.json({
    items: all(
      `SELECT id, reference, subject, status, severity, sla_due_at, resolution, created_at, closed_at
         FROM cases WHERE type = 'complaint' AND raised_by = ? ORDER BY created_at DESC`, [req.auth!.userId]),
  });
});

casesRouter.get('/complaints/:reference', requireAuth, (req, res) => {
  const item = get<any>(`SELECT * FROM cases WHERE reference = ?`, [req.params.reference]);
  if (!item) throw notFound();

  const isStaff = req.auth!.roles.some((r) => ['compliance', 'portfolio_ops', 'finance_ops', 'auditor'].includes(r));
  if (item.raised_by !== req.auth!.userId && !isStaff) throw forbidden();

  res.json({
    case: item,
    // FR-604 — internal notes never reach the customer.
    notes: all(`SELECT body, created_at, internal FROM case_notes WHERE case_id = ? ${isStaff ? '' : 'AND internal = 0'}
                 ORDER BY created_at`, [item.id]),
  });
});

// ─────────────────────────── FR-602 staff queues ───────────────────────────

casesRouter.get('/', requireAuth, requirePermission('case.work'), (req, res) => {
  const query = z.object({
    type: z.string().optional(),
    status: z.string().optional(),
    assignee: z.string().optional(),
    overdue: z.coerce.boolean().optional(),
  }).parse(req.query);

  const filters: string[] = [];
  const params: any[] = [];
  if (query.type) { filters.push('type = ?'); params.push(query.type); }
  if (query.status) { filters.push('status = ?'); params.push(query.status); }
  if (query.assignee) { filters.push('assignee_id = ?'); params.push(query.assignee); }
  if (query.overdue) { filters.push('sla_due_at < ? AND closed_at IS NULL'); params.push(nowIso()); }

  const rows = all<any>(
    `SELECT c.*, u.full_name AS assignee_name, r.full_name AS raised_by_name
       FROM cases c LEFT JOIN users u ON u.id = c.assignee_id LEFT JOIN users r ON r.id = c.raised_by
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY CASE c.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               c.sla_due_at ASC`,
    params);

  res.json({
    items: rows,
    counts: {
      total: rows.length,
      overdue: rows.filter((c) => c.closed_at === null && new Date(c.sla_due_at) < new Date()).length,
      unassigned: rows.filter((c) => !c.assignee_id && c.status !== 'closed').length,
    },
  });
});

casesRouter.post('/:id/assign', requireAuth, requirePermission('case.work'), (req, res) => {
  const body = z.object({ assigneeId: z.string().uuid() }).parse(req.body);
  run(`UPDATE cases SET assignee_id = ?, status = 'in_progress', updated_at = ? WHERE id = ?`,
      [body.assigneeId, nowIso(), req.params.id]);
  audit({ actorId: req.auth!.userId, action: 'case.assigned', entityType: 'case', entityId: req.params.id,
          after: { assigneeId: body.assigneeId } });
  res.json({ caseId: req.params.id, assigneeId: body.assigneeId });
});

casesRouter.post('/:id/notes', requireAuth, requirePermission('case.work'), (req, res) => {
  const body = z.object({ body: z.string().min(2), internal: z.boolean().default(true) }).parse(req.body);
  const id = newId();
  run(`INSERT INTO case_notes (id, case_id, author_id, body, internal, created_at) VALUES (?,?,?,?,?,?)`,
      [id, req.params.id, req.auth!.userId, body.body, body.internal ? 1 : 0, nowIso()]);

  if (!body.internal) {
    const item = get<any>(`SELECT raised_by, reference FROM cases WHERE id = ?`, [req.params.id]);
    if (item?.raised_by) {
      notify({ userId: item.raised_by, templateCode: 'complaint_update', variables: { reference: item.reference } });
    }
  }
  res.status(201).json({ noteId: id });
});

casesRouter.post('/:id/escalate', requireAuth, requirePermission('case.work'), (req, res) => {
  const body = z.object({ reason: z.string().min(10), severity: z.enum(['high', 'critical']).default('high') }).parse(req.body);
  const item = get<any>(`SELECT * FROM cases WHERE id = ?`, [req.params.id]);
  if (!item) throw notFound();

  run(`UPDATE cases SET status = 'escalated', severity = ?, updated_at = ? WHERE id = ?`,
      [body.severity, nowIso(), item.id]);
  audit({ actorId: req.auth!.userId, action: 'case.escalated', entityType: 'case', entityId: item.id,
          before: { status: item.status, severity: item.severity }, after: { status: 'escalated', severity: body.severity },
          reason: body.reason });
  res.json({ caseId: item.id, status: 'escalated', severity: body.severity });
});

casesRouter.post('/:id/resolve', requireAuth, requirePermission('case.work'), (req, res) => {
  const body = z.object({ resolution: z.string().min(10), notifyCustomer: z.boolean().default(true) }).parse(req.body);
  const item = get<any>(`SELECT * FROM cases WHERE id = ?`, [req.params.id]);
  if (!item) throw notFound();

  const at = nowIso();
  run(`UPDATE cases SET status = 'closed', resolution = ?, closed_at = ?, updated_at = ? WHERE id = ?`,
      [body.resolution, at, at, item.id]);
  audit({ actorId: req.auth!.userId, action: 'case.resolved', entityType: 'case', entityId: item.id,
          before: { status: item.status }, after: { status: 'closed' }, reason: body.resolution });

  if (body.notifyCustomer && item.raised_by) {
    notify({ userId: item.raised_by, templateCode: 'complaint_resolved',
             variables: { reference: item.reference, resolution: body.resolution } });
  }
  if (item.type === 'complaint') track('complaint_closed', null, { withinSla: new Date(at) <= new Date(item.sla_due_at) });

  res.json({ caseId: item.id, status: 'closed', withinSla: new Date(at) <= new Date(item.sla_due_at) });
});

// ─────────────────────────── FR-610 data subject requests ───────────────────────────

/** Access / correction / deletion requests under the PDPL workflow (§13.3). */
casesRouter.post('/dsar', requireAuth, (req, res) => {
  const body = z.object({
    requestType: z.enum(['access', 'correction', 'deletion', 'objection']),
    details: z.string().min(10),
  }).parse(req.body);

  const id = newId();
  const reference = makeReference('DSAR', nextSequence('cases'));
  const at = nowIso();
  run(
    `INSERT INTO cases (id, reference, type, subject, body, severity, status, raised_by, sla_due_at, created_at, updated_at)
     VALUES (?,?, 'dsar', ?,?, 'high', 'open', ?, ?, ?, ?)`,
    [id, reference, `طلب بيانات شخصية — ${body.requestType}`, body.details, req.auth!.userId,
     plus(at, hours(30 * 24)), at, at],
  );
  audit({ actorId: req.auth!.userId, action: 'dsar.opened', entityType: 'case', entityId: id,
          after: { reference, requestType: body.requestType } });
  notify({ userId: req.auth!.userId, templateCode: 'dsar_received', variables: { reference } });

  res.status(201).json({
    caseId: id, reference, status: 'open',
    noteAr: 'يُتحقق من هوية مقدم الطلب قبل التنفيذ، وقد ترفض بعض الطلبات جزئيًا وفق الالتزامات القانونية وفترات الاحتفاظ.',
  });
});

/** The subject's own data export, assembled from the source tables. */
casesRouter.get('/dsar/export', requireAuth, (req, res) => {
  const userId = req.auth!.userId;
  res.json({
    generatedAt: nowIso(),
    user: get(`SELECT id, full_name, email, phone, locale, status, created_at FROM users WHERE id = ?`, [userId]),
    investorProfile: get(
      `SELECT classification, kyc_status, suitability_score, suitability_result, risk_rating, created_at
         FROM investor_profiles WHERE user_id = ?`, [userId]),
    consents: all(`SELECT document_key, version, accepted_at FROM consents WHERE user_id = ?`, [userId]),
    orders: all(`SELECT reference, pool_id, amount, status, created_at FROM investment_orders WHERE investor_id = ?`, [userId]),
    holdings: all(`SELECT pool_id, units, invested_amount, distributed_amount FROM holdings WHERE investor_id = ?`, [userId]),
    complaints: all(`SELECT reference, subject, status, created_at FROM cases WHERE raised_by = ?`, [userId]),
    notifications: all(`SELECT template_code, channel, created_at FROM notifications WHERE user_id = ?`, [userId]),
  });
});
