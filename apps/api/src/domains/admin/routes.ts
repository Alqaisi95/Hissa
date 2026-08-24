/** Administration, settings, audit, exports and banners (FR-601, FR-603, FR-606..FR-609). */
import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../../db/index.ts';
import { newId, nowIso } from '../../lib/ids.ts';
import { audit, auditTrail } from '../../lib/audit.ts';
import { conflict, forbidden, notFound } from '../../lib/errors.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { ROLES, ROLE_PERMISSIONS } from '../../lib/rbac.ts';
import { SETTING_KEYS, DEFAULT_SETTINGS, getSetting, proposeSetting, approveSetting, settingHistory } from '../../lib/settings.ts';
import { hashPassword } from '../../lib/crypto.ts';
import { kpiSnapshot } from '../analytics/track.ts';
import { toCsv } from '../../lib/csv.ts';

export const adminRouter = Router();

// ─────────────────────────── FR-601 users & roles ───────────────────────────

adminRouter.get('/roles', requireAuth, requirePermission('admin.users'), (_req, res) => {
  res.json({
    roles: ROLES.map((role) => ({
      role,
      permissions: ROLE_PERMISSIONS[role],
      // PRD §9: System Admin holds no financial or investment approval.
      canApproveMoney: ROLE_PERMISSIONS[role].includes('funds.approve'),
      canDecideInvestment: ROLE_PERMISSIONS[role].includes('committee.decide'),
    })),
  });
});

adminRouter.get('/users', requireAuth, requirePermission('admin.users'), (req, res) => {
  const query = z.object({ search: z.string().optional(), role: z.string().optional() }).parse(req.query);
  const rows = all<any>(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status, u.mfa_enabled, u.created_at,
            GROUP_CONCAT(r.role) AS roles
       FROM users u LEFT JOIN user_roles r ON r.user_id = u.id
      ${query.search ? 'WHERE (u.full_name LIKE ? OR u.email LIKE ?)' : ''}
      GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200`,
    query.search ? [`%${query.search}%`, `%${query.search}%`] : []);

  const items = rows.map((r) => ({ ...r, roles: r.roles ? r.roles.split(',') : [] }));
  res.json({ items: query.role ? items.filter((i) => i.roles.includes(query.role)) : items });
});

adminRouter.post('/users', requireAuth, requirePermission('admin.users'), (req, res) => {
  const body = z.object({
    fullName: z.string().min(3),
    email: z.string().email(),
    password: z.string().min(12),
    roles: z.array(z.enum(ROLES)).min(1),
    locale: z.enum(['ar', 'en']).default('ar'),
  }).parse(req.body);

  // Segregation of duties at grant time. Requesting and approving money movements
  // may sit with the same role (PRD §9) because dual control is enforced per
  // transaction; combining technical administration with approval may not.
  if (body.roles.includes('system_admin') && body.roles.some((r) => ['finance_ops', 'committee_member', 'compliance'].includes(r))) {
    throw conflict('sod_violation', 'لا يجمع مسؤول النظام مع أدوار الاعتماد المالي أو الاستثماري',
      'System admin cannot be combined with financial or investment approval roles');
  }

  const { hash, salt } = hashPassword(body.password);
  const id = newId();
  const at = nowIso();
  run(`INSERT INTO users (id, email, full_name, password_hash, password_salt, locale, status, email_verified_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'active', ?, ?, ?)`,
      [id, body.email, body.fullName, hash, salt, body.locale, at, at, at]);
  for (const role of body.roles) {
    run(`INSERT INTO user_roles (user_id, role, granted_by, granted_at) VALUES (?,?,?,?)`, [id, role, req.auth!.userId, at]);
  }
  audit({ actorId: req.auth!.userId, action: 'user.created', entityType: 'user', entityId: id,
          after: { email: body.email, roles: body.roles } });

  res.status(201).json({ userId: id, roles: body.roles });
});

adminRouter.post('/users/:id/roles', requireAuth, requirePermission('admin.users'), (req, res) => {
  const body = z.object({ roles: z.array(z.enum(ROLES)), reason: z.string().min(5) }).parse(req.body);
  const user = get<any>(`SELECT id FROM users WHERE id = ?`, [req.params.id]);
  if (!user) throw notFound();

  if (body.roles.includes('system_admin') && body.roles.some((r) => ['finance_ops', 'committee_member', 'compliance'].includes(r))) {
    throw conflict('sod_violation', 'لا يجمع مسؤول النظام مع أدوار الاعتماد المالي أو الاستثماري',
      'System admin cannot be combined with financial or investment approval roles');
  }

  const before = all<{ role: string }>(`SELECT role FROM user_roles WHERE user_id = ?`, [user.id]).map((r) => r.role);
  run(`DELETE FROM user_roles WHERE user_id = ?`, [user.id]);
  for (const role of body.roles) {
    run(`INSERT INTO user_roles (user_id, role, granted_by, granted_at) VALUES (?,?,?,?)`,
        [user.id, role, req.auth!.userId, nowIso()]);
  }
  audit({ actorId: req.auth!.userId, action: 'user.roles_changed', entityType: 'user', entityId: user.id,
          before: { roles: before }, after: { roles: body.roles }, reason: body.reason });

  res.json({ userId: user.id, roles: body.roles });
});

// ─────────────────────────── FR-607 settings ───────────────────────────

adminRouter.get('/settings', requireAuth, requirePermission('settings.propose'), (_req, res) => {
  res.json({
    active: Object.values(SETTING_KEYS).map((key) => ({ key, value: getSetting(key) })),
    pending: all(`SELECT * FROM settings WHERE status = 'pending_approval' ORDER BY effective_from`),
    defaults: DEFAULT_SETTINGS,
  });
});

adminRouter.get('/settings/:key/history', requireAuth, requirePermission('settings.propose'), (req, res) => {
  res.json({ key: req.params.key, history: settingHistory(req.params.key) });
});

adminRouter.post('/settings', requireAuth, requirePermission('settings.propose'), (req, res) => {
  const body = z.object({
    key: z.string(),
    value: z.unknown(),
    effectiveFrom: z.string(),
    note: z.string().min(10),
  }).parse(req.body);

  const id = proposeSetting({
    key: body.key, value: body.value, effectiveFrom: body.effectiveFrom,
    createdBy: req.auth!.userId, note: body.note,
  });
  res.status(201).json({ settingId: id, status: 'pending_approval' });
});

/** BR-020 — approval by a second authorised user; the change is never retroactive. */
adminRouter.post('/settings/:id/approve', requireAuth, requirePermission('settings.approve'), (req, res) => {
  approveSetting(req.params.id, req.auth!.userId);
  res.json({ settingId: req.params.id, status: 'active' });
});

// ─────────────────────────── FR-608 notification templates ───────────────────────────

adminRouter.get('/templates', requireAuth, requirePermission('settings.propose'), (_req, res) => {
  res.json({ items: all(`SELECT * FROM notification_templates ORDER BY code`) });
});

adminRouter.post('/templates', requireAuth, requirePermission('settings.propose'), (req, res) => {
  const body = z.object({
    code: z.string().min(3),
    channel: z.enum(['email', 'sms', 'inapp']),
    subjectAr: z.string().optional(), subjectEn: z.string().optional(),
    bodyAr: z.string().min(5), bodyEn: z.string().min(5),
  }).parse(req.body);

  run(`INSERT INTO notification_templates (id, code, channel, subject_ar, subject_en, body_ar, body_en, status, updated_at)
       VALUES (?,?,?,?,?,?,?, 'draft', ?)
       ON CONFLICT(code) DO UPDATE SET channel = excluded.channel, subject_ar = excluded.subject_ar,
         subject_en = excluded.subject_en, body_ar = excluded.body_ar, body_en = excluded.body_en,
         status = 'draft', updated_at = excluded.updated_at`,
      [newId(), body.code, body.channel, body.subjectAr ?? null, body.subjectEn ?? null,
       body.bodyAr, body.bodyEn, nowIso()]);
  audit({ actorId: req.auth!.userId, action: 'template.drafted', entityType: 'notification_template', entityId: body.code });

  res.status(201).json({ code: body.code, status: 'draft' });
});

/** A template is dispatched only after approval — preview then approve (FR-608). */
adminRouter.post('/templates/:code/approve', requireAuth, requirePermission('settings.approve'), (req, res) => {
  const template = get<any>(`SELECT * FROM notification_templates WHERE code = ?`, [req.params.code]);
  if (!template) throw notFound();

  run(`UPDATE notification_templates SET status = 'approved', approved_by = ?, updated_at = ? WHERE code = ?`,
      [req.auth!.userId, nowIso(), req.params.code]);
  audit({ actorId: req.auth!.userId, action: 'template.approved', entityType: 'notification_template',
          entityId: req.params.code });
  res.json({ code: req.params.code, status: 'approved' });
});

adminRouter.post('/templates/:code/preview', requireAuth, requirePermission('settings.propose'), (req, res) => {
  const body = z.object({ variables: z.record(z.union([z.string(), z.number()])).default({}) }).parse(req.body);
  const template = get<any>(`SELECT * FROM notification_templates WHERE code = ?`, [req.params.code]);
  if (!template) throw notFound();

  const render = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_m, key) => String(body.variables[key] ?? `{{${key}}}`));
  res.json({
    ar: { subject: render(template.subject_ar ?? ''), body: render(template.body_ar) },
    en: { subject: render(template.subject_en ?? ''), body: render(template.body_en) },
  });
});

// ─────────────────────────── FR-609 incident banner ───────────────────────────

adminRouter.post('/banners', requireAuth, requirePermission('banner.manage'), (req, res) => {
  const body = z.object({
    messageAr: z.string().min(10), messageEn: z.string().min(10),
    severity: z.enum(['info', 'warning', 'critical']),
    audience: z.enum(['all', 'investors', 'owners', 'staff']).default('all'),
    startsAt: z.string(), endsAt: z.string(),
  }).parse(req.body);

  const id = newId();
  run(`INSERT INTO banners (id, message_ar, message_en, severity, audience, starts_at, ends_at, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, body.messageAr, body.messageEn, body.severity, body.audience, body.startsAt, body.endsAt,
       req.auth!.userId, nowIso()]);
  audit({ actorId: req.auth!.userId, action: 'banner.published', entityType: 'banner', entityId: id, after: body });

  res.status(201).json({ bannerId: id });
});

adminRouter.delete('/banners/:id', requireAuth, requirePermission('banner.manage'), (req, res) => {
  run(`UPDATE banners SET ends_at = ? WHERE id = ?`, [nowIso(), req.params.id]);
  audit({ actorId: req.auth!.userId, action: 'banner.retracted', entityType: 'banner', entityId: req.params.id });
  res.json({ bannerId: req.params.id, retracted: true });
});

// ─────────────────────────── FR-603 audit log ───────────────────────────

adminRouter.get('/audit', requireAuth, requirePermission('audit.read'), (req, res) => {
  const query = z.object({
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    actorId: z.string().optional(),
    action: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }).parse(req.query);

  const filters: string[] = [];
  const params: any[] = [];
  for (const [column, value] of [['entity_type', query.entityType], ['entity_id', query.entityId],
                                 ['actor_id', query.actorId], ['action', query.action]] as const) {
    if (value) { filters.push(`${column} = ?`); params.push(value); }
  }
  if (query.from) { filters.push('created_at >= ?'); params.push(query.from); }
  if (query.to) { filters.push('created_at <= ?'); params.push(query.to); }

  res.json({
    items: all(
      `SELECT a.*, u.full_name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY a.created_at DESC LIMIT ?`,
      [...params, query.limit]),
    // The store itself is append-only; SQLite triggers reject UPDATE and DELETE.
    immutable: true,
  });
});

adminRouter.get('/audit/:entityType/:entityId', requireAuth, requirePermission('audit.read'), (req, res) => {
  res.json({ items: auditTrail(req.params.entityType, req.params.entityId) });
});

// ─────────────────────────── FR-606 operational & regulatory exports ───────────────────────────

const EXPORTS: Record<string, { sql: string; label: string }> = {
  investors: {
    label: 'المستثمرون وحالات التحقق',
    sql: `SELECT u.id, u.full_name, u.status, p.classification, p.kyc_status, p.suitability_result, u.created_at
            FROM users u JOIN investor_profiles p ON p.user_id = u.id`,
  },
  commitments: {
    label: 'الالتزامات الاستثمارية',
    sql: `SELECT o.reference, o.created_at, o.confirmed_at, o.amount, o.allocated_amount, o.status,
                 p.reference AS pool_reference, p.title_ar
            FROM investment_orders o JOIN pools p ON p.id = o.pool_id`,
  },
  pools: {
    label: 'الفرص والتمويل',
    sql: `SELECT reference, title_ar, sector, status, target_amount, min_amount, published_at, funded_at, closed_at FROM pools`,
  },
  money_movements: {
    label: 'حركات الأموال',
    sql: `SELECT direction, provider_ref, amount, status, created_at, updated_at FROM payment_references`,
  },
  complaints: {
    label: 'الشكاوى وSLA',
    sql: `SELECT reference, type, subject, severity, status, sla_due_at, created_at, closed_at FROM cases WHERE type = 'complaint'`,
  },
  reports: {
    label: 'تقارير المشاريع',
    sql: `SELECT r.period_label, r.due_at, r.status, r.published_at, p.reference AS pool_reference
            FROM project_reports r JOIN pools p ON p.id = r.pool_id`,
  },
};

adminRouter.get('/exports', requireAuth, requirePermission('reports.export'), (_req, res) => {
  res.json({ available: Object.entries(EXPORTS).map(([key, value]) => ({ key, label: value.label })) });
});

/** FR-606 — every export shows its filters, period and extraction time so it is reproducible. */
adminRouter.get('/exports/:key', requireAuth, requirePermission('reports.export'), (req, res) => {
  const spec = EXPORTS[req.params.key];
  if (!spec) throw notFound();

  const query = z.object({
    from: z.string().optional(), to: z.string().optional(),
    format: z.enum(['json', 'csv']).default('json'),
  }).parse(req.query);

  const filters: string[] = [];
  const params: any[] = [];
  if (query.from) { filters.push('created_at >= ?'); params.push(query.from); }
  if (query.to) { filters.push('created_at <= ?'); params.push(query.to); }

  const sql = filters.length
    ? `SELECT * FROM (${spec.sql}) WHERE ${filters.join(' AND ')}`
    : spec.sql;
  const rows = all<any>(sql, params);
  const extractedAt = nowIso();

  audit({ actorId: req.auth!.userId, action: 'export.generated', entityType: 'export', entityId: req.params.key,
          after: { rows: rows.length, from: query.from ?? null, to: query.to ?? null } });

  if (query.format === 'csv') {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${req.params.key}-${extractedAt.slice(0, 10)}.csv"`);
    res.send(toCsv(rows));
    return;
  }
  res.json({
    export: req.params.key, label: spec.label,
    filters: { from: query.from ?? null, to: query.to ?? null },
    extractedAt, extractedBy: req.auth!.userId, rowCount: rows.length, rows,
  });
});

// ─────────────────────────── Dashboards ───────────────────────────

adminRouter.get('/dashboard', requireAuth, (req, res) => {
  if (!req.auth!.roles.some((r) => ['compliance', 'system_admin', 'portfolio_ops', 'finance_ops', 'auditor', 'investment_analyst'].includes(r))) {
    throw forbidden();
  }
  const at = nowIso();
  res.json({
    kpis: kpiSnapshot(30),
    pipeline: all(`SELECT status, COUNT(*) AS count FROM project_applications GROUP BY status`),
    pools: all(`SELECT status, COUNT(*) AS count, SUM(target_amount) AS target FROM pools GROUP BY status`),
    queues: {
      kycReview: get<{ n: number }>(`SELECT COUNT(*) AS n FROM investor_profiles WHERE kyc_status IN ('pending','in_review')`)!.n,
      ddOpen: get<{ n: number }>(`SELECT COUNT(*) AS n FROM dd_cases WHERE status IN ('open','awaiting_applicant')`)!.n,
      committee: get<{ n: number }>(`SELECT COUNT(*) AS n FROM committee_sessions WHERE status = 'open'`)!.n,
      fundsApproval: get<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM disbursements WHERE status = 'pending_approval')
              + (SELECT COUNT(*) FROM refunds WHERE status IN ('requested','pending_approval'))
              + (SELECT COUNT(*) FROM distributions WHERE status = 'pending_approval') AS n`)!.n,
      reconBreaks: get<{ n: number }>(`SELECT COUNT(*) AS n FROM reconciliation_breaks WHERE status <> 'resolved'`)!.n,
      casesOverdue: get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM cases WHERE closed_at IS NULL AND sla_due_at < ?`, [at])!.n,
      reportsLate: get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM project_reports WHERE status IN ('scheduled','draft','late') AND due_at < ?`, [at])!.n,
    },
  });
});

adminRouter.get('/jobs', requireAuth, requirePermission('audit.read'), (_req, res) => {
  res.json({ items: all(`SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 100`) });
});
