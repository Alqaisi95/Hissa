/** Project origination, due diligence and investment committee (FR-101..FR-108). */
import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx, nextSequence } from '../../db/index.ts';
import { newId, nowIso, plus, hours, makeReference, days } from '../../lib/ids.ts';
import { contentHash } from '../../lib/crypto.ts';
import { audit } from '../../lib/audit.ts';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { poolPolicy, slas } from '../../lib/settings.ts';
import { canApplicationTransition, type ApplicationState } from '../../workflow/applicationState.ts';
import { DD_CHECKLIST, scoreRisk, RISK_MODEL_VERSION } from './riskModel.ts';
import { issuerRaiseAllowed } from '../orders/eligibility.ts';
import { notify } from '../../integrations/notifications.ts';
import { track } from '../analytics/track.ts';
import { attachDocument, listDocuments } from '../../lib/documents.ts';

export const originationRouter = Router();

const useOfFundsItem = z.object({
  item: z.string().min(2),
  supplier: z.string().min(2),
  amount: z.number().int().positive(),        // baisa
  quoteReference: z.string().optional(),
});

function assertOwner(applicationId: string, userId: string, roles: string[]) {
  const app = get<any>(`SELECT * FROM project_applications WHERE id = ?`, [applicationId]);
  if (!app) throw notFound();
  const isStaff = roles.some((r) => ['investment_analyst', 'compliance', 'committee_member', 'auditor', 'portfolio_ops'].includes(r));
  if (app.owner_user_id !== userId && !isStaff) throw forbidden();
  return app;
}

// ─────────────────────────── FR-101 application (draft-capable) ───────────────────────────

originationRouter.post('/applications', requireAuth, requirePermission('application.create'), (req, res) => {
  const body = z.object({
    entityId: z.string().uuid(),
    titleAr: z.string().min(5),
    titleEn: z.string().optional(),
    sector: z.string().min(2),
    governorate: z.string().optional(),
    summaryAr: z.string().optional(),
    requestedAmount: z.number().int().positive(),
    ownerContribution: z.number().int().nonnegative().default(0),
    tenorMonths: z.number().int().positive().max(120).optional(),
    useOfFunds: z.array(useOfFundsItem).default([]),
  }).parse(req.body);

  const entity = get<any>(`SELECT * FROM legal_entities WHERE id = ?`, [body.entityId]);
  if (!entity) throw notFound();
  const isRep = get<any>(`SELECT 1 FROM entity_people WHERE entity_id = ? AND user_id = ?`, [entity.id, req.auth!.userId]);
  if (!isRep) throw forbidden('لست ممثلًا مفوضًا لهذه الشركة', 'You are not an authorised representative of this entity');

  const id = newId();
  const at = nowIso();
  run(
    `INSERT INTO project_applications
       (id, reference, entity_id, owner_user_id, title_ar, title_en, sector, governorate, summary_ar,
        requested_amount, owner_contribution, tenor_months, use_of_funds, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft', ?, ?)`,
    [id, makeReference('APP', nextSequence('project_applications')), body.entityId, req.auth!.userId,
     body.titleAr, body.titleEn ?? null, body.sector, body.governorate ?? null, body.summaryAr ?? null,
     body.requestedAmount, body.ownerContribution, body.tenorMonths ?? null, JSON.stringify(body.useOfFunds), at, at],
  );
  audit({ actorId: req.auth!.userId, action: 'application.created', entityType: 'project_application', entityId: id,
          after: { requestedAmount: body.requestedAmount, sector: body.sector } });
  track('application_started', req.auth!.userId, { sector: body.sector });

  res.status(201).json({ applicationId: id, status: 'draft' });
});

/** FR-101 — drafts survive across sessions; only mandatory fields gate submission. */
originationRouter.patch('/applications/:id', requireAuth, (req, res) => {
  const app = assertOwner(req.params.id, req.auth!.userId, req.auth!.roles);
  if (!['draft', 'returned'].includes(app.status)) {
    throw conflict('not_editable', 'لا يمكن تعديل الطلب في حالته الحالية', 'The application cannot be edited in its current state');
  }

  const body = z.object({
    titleAr: z.string().min(5).optional(),
    titleEn: z.string().optional(),
    sector: z.string().optional(),
    governorate: z.string().optional(),
    summaryAr: z.string().optional(),
    requestedAmount: z.number().int().positive().optional(),
    ownerContribution: z.number().int().nonnegative().optional(),
    tenorMonths: z.number().int().positive().max(120).optional(),
    useOfFunds: z.array(useOfFundsItem).optional(),
  }).parse(req.body);

  const fields: Record<string, unknown> = {
    title_ar: body.titleAr, title_en: body.titleEn, sector: body.sector, governorate: body.governorate,
    summary_ar: body.summaryAr, requested_amount: body.requestedAmount,
    owner_contribution: body.ownerContribution, tenor_months: body.tenorMonths,
    use_of_funds: body.useOfFunds ? JSON.stringify(body.useOfFunds) : undefined,
  };
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length) {
    run(`UPDATE project_applications SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...entries.map(([, v]) => v), nowIso(), app.id]);
  }
  audit({ actorId: req.auth!.userId, action: 'application.updated', entityType: 'project_application',
          entityId: app.id, before: app, after: fields });

  res.json({ applicationId: app.id, updated: entries.map(([k]) => k) });
});

/** Pre-submission completeness check surfaced in the portal (FR-101). */
export function applicationCompleteness(app: any) {
  const useOfFunds = JSON.parse(app.use_of_funds || '[]') as { amount: number }[];
  const policy = poolPolicy();
  const missing: string[] = [];

  if (!app.title_ar || app.title_ar.length < 5) missing.push('title_ar');
  if (!app.summary_ar || app.summary_ar.length < 40) missing.push('summary_ar');
  if (!app.tenor_months) missing.push('tenor_months');
  if (useOfFunds.length === 0) missing.push('use_of_funds');

  const useOfFundsTotal = useOfFunds.reduce((sum, i) => sum + i.amount, 0);
  if (useOfFunds.length && useOfFundsTotal !== app.requested_amount) missing.push('use_of_funds_total_mismatch');

  const docs = listDocuments('application', app.id);
  for (const required of ['cr_certificate', 'bank_statement', 'quotes']) {
    if (!docs.some((d: any) => d.category === required)) missing.push(`document:${required}`);
  }

  const feeds = all<any>(`SELECT * FROM financial_feeds WHERE application_id = ?`, [app.id]);
  const monthsCovered = feeds.reduce((sum, f) =>
    sum + Math.round((new Date(f.period_end).getTime() - new Date(f.period_start).getTime()) / (days(365) / 12)), 0);
  if (monthsCovered < policy.minTradingMonths) missing.push(`financial_history:${monthsCovered}/${policy.minTradingMonths}`);

  return { missing, useOfFundsTotal, monthsCovered, complete: missing.length === 0 };
}

originationRouter.get('/applications/:id/completeness', requireAuth, (req, res) => {
  const app = assertOwner(req.params.id, req.auth!.userId, req.auth!.roles);
  res.json(applicationCompleteness(app));
});

originationRouter.post('/applications/:id/submit', requireAuth, (req, res) => {
  const app = assertOwner(req.params.id, req.auth!.userId, req.auth!.roles);
  if (!canApplicationTransition(app.status as ApplicationState, 'submitted')) {
    throw conflict('invalid_transition', 'لا يمكن إرسال الطلب في حالته الحالية', 'Cannot submit in the current state');
  }

  const completeness = applicationCompleteness(app);
  if (!completeness.complete) {
    // FR-101: never accept a submission with mandatory gaps.
    throw unprocessable('incomplete_application', 'الطلب غير مكتمل', 'The application is incomplete', { missing: completeness.missing });
  }

  const entity = get<any>(`SELECT * FROM legal_entities WHERE id = ?`, [app.entity_id]);
  if (entity.kyb_status !== 'approved') {
    throw unprocessable('kyb_pending', 'لم يكتمل التحقق من الشركة', 'Entity verification is not yet approved');
  }
  // BR-007 — young issuer raise ceiling.
  if (!issuerRaiseAllowed(app.entity_id, app.requested_amount)) {
    throw unprocessable('issuer_cap', 'المبلغ المطلوب يتجاوز الحد المسموح لعمر الكيان',
      'The requested amount exceeds the ceiling permitted for the entity age');
  }

  const at = nowIso();
  const caseId = newId();
  tx(() => {
    run(`UPDATE project_applications SET status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ?`, [at, at, app.id]);
    run(`INSERT INTO dd_cases (id, application_id, status, sla_due_at, opened_at) VALUES (?,?, 'open', ?, ?)`,
        [caseId, app.id, plus(at, hours(slas().kycReviewHours * 5)), at]);
    for (const item of DD_CHECKLIST) {
      run(`INSERT INTO dd_checklist_items (id, case_id, code, label_ar, mandatory, status) VALUES (?,?,?,?,?, 'pending')`,
          [newId(), caseId, item.code, item.labelAr, item.mandatory ? 1 : 0]);
    }
  });

  audit({ actorId: req.auth!.userId, action: 'application.submitted', entityType: 'project_application',
          entityId: app.id, before: { status: app.status }, after: { status: 'submitted' } });
  track('application_submitted', req.auth!.userId, { sector: app.sector });
  notify({ userId: app.owner_user_id, templateCode: 'application_received', variables: { reference: app.reference } });

  res.json({ applicationId: app.id, status: 'submitted', caseId });
});

originationRouter.get('/applications/mine', requireAuth, (req, res) => {
  const rows = all<any>(
    `SELECT a.*, c.status AS case_status, c.risk_grade
       FROM project_applications a LEFT JOIN dd_cases c ON c.application_id = a.id
      WHERE a.owner_user_id = ? ORDER BY a.created_at DESC`, [req.auth!.userId]);
  res.json({ items: rows.map((r) => ({ ...r, use_of_funds: JSON.parse(r.use_of_funds) })) });
});

originationRouter.get('/applications/:id', requireAuth, (req, res) => {
  const app = assertOwner(req.params.id, req.auth!.userId, req.auth!.roles);
  const ddCase = get<any>(`SELECT * FROM dd_cases WHERE application_id = ?`, [app.id]);
  const isStaff = req.auth!.roles.some((r) => ['investment_analyst', 'compliance', 'committee_member', 'auditor'].includes(r));

  res.json({
    application: { ...app, use_of_funds: JSON.parse(app.use_of_funds) },
    documents: listDocuments('application', app.id),
    feeds: all(`SELECT * FROM financial_feeds WHERE application_id = ?`, [app.id]),
    case: ddCase ? {
      id: ddCase.id, status: ddCase.status, slaDueAt: ddCase.sla_due_at,
      // FR-108: internal scores never reach the applicant.
      ...(isStaff ? { riskScore: ddCase.risk_score, riskGrade: ddCase.risk_grade, modelVersion: ddCase.model_version } : {}),
    } : null,
    // Two-way requests are visible to the applicant; internal notes are not (FR-604).
    infoRequests: ddCase ? all(
      `SELECT id, body_ar, status, due_at, answer_body, answered_at, created_at
         FROM info_requests WHERE case_id = ? ORDER BY created_at DESC`, [ddCase.id]) : [],
  });
});

// ─────────────────────────── FR-103 financial feeds ───────────────────────────

originationRouter.post('/applications/:id/feeds', requireAuth, (req, res) => {
  const app = assertOwner(req.params.id, req.auth!.userId, req.auth!.roles);
  const body = z.object({
    source: z.enum(['bank_api', 'pos_api', 'statement_upload']),
    periodStart: z.string(),
    periodEnd: z.string(),
    grossRevenue: z.number().int().nonnegative(),
    netCash: z.number().int().optional(),
    documentId: z.string().uuid().optional(),
  }).parse(req.body);

  if (body.source === 'statement_upload' && !body.documentId) {
    throw badRequest('document_required', 'يلزم رفع مستند الكشف', 'A statement document is required for uploads');
  }
  const id = newId();
  run(
    `INSERT INTO financial_feeds (id, application_id, source, period_start, period_end, gross_revenue, net_cash,
                                  quality, document_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, app.id, body.source, body.periodStart, body.periodEnd, body.grossRevenue, body.netCash ?? null,
     body.source === 'statement_upload' ? 'unverified' : 'verified', body.documentId ?? null, nowIso()],
  );
  audit({ actorId: req.auth!.userId, action: 'feed.added', entityType: 'project_application', entityId: app.id,
          after: { source: body.source, periodStart: body.periodStart, periodEnd: body.periodEnd } });

  const completeness = applicationCompleteness(get<any>(`SELECT * FROM project_applications WHERE id = ?`, [app.id]));
  res.status(201).json({ feedId: id, monthsCovered: completeness.monthsCovered, missing: completeness.missing });
});

// ─────────────────────────── FR-105 analyst workspace ───────────────────────────

originationRouter.get('/cases', requireAuth, requirePermission('dd.work'), (req, res) => {
  const status = z.string().optional().parse(req.query.status);
  const rows = all<any>(
    `SELECT c.*, a.reference, a.title_ar, a.sector, a.requested_amount, a.status AS application_status,
            e.legal_name, u.full_name AS analyst_name
       FROM dd_cases c
       JOIN project_applications a ON a.id = c.application_id
       JOIN legal_entities e ON e.id = a.entity_id
       LEFT JOIN users u ON u.id = c.analyst_id
      ${status ? 'WHERE c.status = ?' : ''}
      ORDER BY c.sla_due_at ASC`,
    status ? [status] : [],
  );
  res.json({ items: rows, count: rows.length });
});

originationRouter.get('/cases/:id', requireAuth, requirePermission('dd.work'), (req, res) => {
  const ddCase = get<any>(`SELECT * FROM dd_cases WHERE id = ?`, [req.params.id]);
  if (!ddCase) throw notFound();
  const app = get<any>(`SELECT * FROM project_applications WHERE id = ?`, [ddCase.application_id]);

  res.json({
    case: { ...ddCase, score_inputs: JSON.parse(ddCase.score_inputs) },
    application: { ...app, use_of_funds: JSON.parse(app.use_of_funds) },
    entity: get(`SELECT * FROM legal_entities WHERE id = ?`, [app.entity_id]),
    people: all(`SELECT * FROM entity_people WHERE entity_id = ?`, [app.entity_id]),
    checklist: all(`SELECT * FROM dd_checklist_items WHERE case_id = ? ORDER BY mandatory DESC, code`, [ddCase.id]),
    infoRequests: all(`SELECT * FROM info_requests WHERE case_id = ? ORDER BY created_at DESC`, [ddCase.id]),
    documents: listDocuments('application', app.id),
    feeds: all(`SELECT * FROM financial_feeds WHERE application_id = ?`, [app.id]),
  });
});

originationRouter.post('/cases/:id/assign', requireAuth, requirePermission('dd.work'), (req, res) => {
  const body = z.object({ analystId: z.string().uuid() }).parse(req.body);
  const ddCase = get<any>(`SELECT * FROM dd_cases WHERE id = ?`, [req.params.id]);
  if (!ddCase) throw notFound();

  run(`UPDATE dd_cases SET analyst_id = ? WHERE id = ?`, [body.analystId, ddCase.id]);
  run(`UPDATE project_applications SET status = 'due_diligence', updated_at = ? WHERE id = ? AND status = 'submitted'`,
      [nowIso(), ddCase.application_id]);
  audit({ actorId: req.auth!.userId, action: 'case.assigned', entityType: 'dd_case', entityId: ddCase.id,
          after: { analystId: body.analystId } });
  res.json({ caseId: ddCase.id, analystId: body.analystId });
});

originationRouter.patch('/cases/:id/checklist/:itemId', requireAuth, requirePermission('dd.work'), (req, res) => {
  const body = z.object({
    status: z.enum(['pending', 'satisfied', 'waived', 'failed']),
    note: z.string().optional(),
    evidenceId: z.string().uuid().optional(),
  }).parse(req.body);

  const item = get<any>(`SELECT * FROM dd_checklist_items WHERE id = ? AND case_id = ?`, [req.params.itemId, req.params.id]);
  if (!item) throw notFound();
  // A mandatory item may only be waived with a written justification.
  if (body.status === 'waived' && item.mandatory === 1 && !(body.note && body.note.length >= 10)) {
    throw unprocessable('waiver_reason_required', 'يلزم تبرير مكتوب لاستثناء بند إلزامي',
      'A written justification is required to waive a mandatory item');
  }

  run(`UPDATE dd_checklist_items SET status = ?, note = ?, evidence_id = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
      [body.status, body.note ?? null, body.evidenceId ?? null, req.auth!.userId, nowIso(), item.id]);
  audit({ actorId: req.auth!.userId, action: 'checklist.updated', entityType: 'dd_case', entityId: req.params.id,
          before: { code: item.code, status: item.status }, after: { code: item.code, status: body.status }, reason: body.note });

  res.json({ itemId: item.id, status: body.status });
});

// FR-104 — two-way information requests with an SLA clock.
originationRouter.post('/cases/:id/requests', requireAuth, requirePermission('dd.work'), (req, res) => {
  const body = z.object({ bodyAr: z.string().min(10), dueHours: z.number().int().positive().optional() }).parse(req.body);
  const ddCase = get<any>(`SELECT * FROM dd_cases WHERE id = ?`, [req.params.id]);
  if (!ddCase) throw notFound();

  const id = newId();
  const at = nowIso();
  run(`INSERT INTO info_requests (id, case_id, requested_by, body_ar, status, due_at, created_at)
       VALUES (?,?,?,?, 'open', ?, ?)`,
      [id, ddCase.id, req.auth!.userId, body.bodyAr, plus(at, hours(body.dueHours ?? slas().infoRequestHours)), at]);
  run(`UPDATE dd_cases SET status = 'awaiting_applicant' WHERE id = ?`, [ddCase.id]);

  const app = get<any>(`SELECT * FROM project_applications WHERE id = ?`, [ddCase.application_id]);
  notify({ userId: app.owner_user_id, templateCode: 'info_request', variables: { reference: app.reference } });
  audit({ actorId: req.auth!.userId, action: 'info_request.created', entityType: 'dd_case', entityId: ddCase.id, after: { id } });

  res.status(201).json({ requestId: id, dueAt: plus(at, hours(body.dueHours ?? slas().infoRequestHours)) });
});

originationRouter.post('/requests/:id/answer', requireAuth, (req, res) => {
  const body = z.object({ answer: z.string().min(2), documentId: z.string().uuid().optional() }).parse(req.body);
  const request = get<any>(`SELECT * FROM info_requests WHERE id = ?`, [req.params.id]);
  if (!request) throw notFound();

  const ddCase = get<any>(`SELECT * FROM dd_cases WHERE id = ?`, [request.case_id]);
  const app = get<any>(`SELECT * FROM project_applications WHERE id = ?`, [ddCase.application_id]);
  if (app.owner_user_id !== req.auth!.userId) throw forbidden();
  // FR-104: the task closes only with an answer (and evidence when asked for).
  if (request.status === 'closed') throw conflict('request_closed', 'تم إغلاق الطلب', 'This request is already closed');

  const at = nowIso();
  run(`UPDATE info_requests SET status = 'answered', answer_body = ?, answer_doc_id = ?, answered_at = ? WHERE id = ?`,
      [body.answer, body.documentId ?? null, at, request.id]);

  const stillOpen = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM info_requests WHERE case_id = ? AND status = 'open'`, [ddCase.id])!.n;
  if (stillOpen === 0) run(`UPDATE dd_cases SET status = 'open' WHERE id = ?`, [ddCase.id]);

  audit({ actorId: req.auth!.userId, action: 'info_request.answered', entityType: 'info_request', entityId: request.id });
  res.json({ requestId: request.id, status: 'answered' });
});

// FR-106 — scoring writes the score, the inputs and the model version.
originationRouter.post('/cases/:id/score', requireAuth, requirePermission('dd.score'), (req, res) => {
  const inputs = z.object({
    monthsTrading: z.number().int().nonnegative(),
    revenueStabilityBps: z.number().int().min(0).max(10_000),
    ownerContributionBps: z.number().int().min(0).max(10_000),
    dataQuality: z.enum(['bank_api', 'pos_api', 'statement_upload', 'none']),
    useOfFundsSpecificity: z.enum(['itemised_quotes', 'partial', 'narrative']),
    sectorRisk: z.enum(['low', 'medium', 'high']),
    managementDepth: z.enum(['team', 'owner_plus', 'owner_only']),
    existingLeverageBps: z.number().int().min(0).max(10_000),
    licensesComplete: z.boolean(),
    supplierConcentrationBps: z.number().int().min(0).max(10_000),
  }).parse(req.body);

  const ddCase = get<any>(`SELECT * FROM dd_cases WHERE id = ?`, [req.params.id]);
  if (!ddCase) throw notFound();

  const outcome = scoreRisk(inputs);
  run(`UPDATE dd_cases SET risk_score = ?, risk_grade = ?, model_version = ?, score_inputs = ? WHERE id = ?`,
      [outcome.score, outcome.grade, outcome.version, JSON.stringify(inputs), ddCase.id]);
  audit({ actorId: req.auth!.userId, action: 'case.scored', entityType: 'dd_case', entityId: ddCase.id,
          after: { score: outcome.score, grade: outcome.grade, version: outcome.version, inputs } });

  res.json(outcome);
});

// FR-105 — the mandatory checklist gates promotion to the committee.
originationRouter.post('/cases/:id/to-committee', requireAuth, requirePermission('dd.work'), (req, res) => {
  const ddCase = get<any>(`SELECT * FROM dd_cases WHERE id = ?`, [req.params.id]);
  if (!ddCase) throw notFound();

  const outstanding = all<any>(
    `SELECT code FROM dd_checklist_items WHERE case_id = ? AND mandatory = 1 AND status NOT IN ('satisfied','waived')`,
    [ddCase.id],
  );
  if (outstanding.length) {
    throw unprocessable('checklist_incomplete', 'لم تكتمل البنود الإلزامية للعناية الواجبة',
      'Mandatory due-diligence items are incomplete', { outstanding: outstanding.map((o) => o.code) });
  }
  if (ddCase.risk_score === null) {
    throw unprocessable('score_missing', 'يلزم احتساب درجة المخاطر أولًا', 'The risk score must be computed first');
  }
  const openRequests = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM info_requests WHERE case_id = ? AND status = 'open'`, [ddCase.id])!.n;
  if (openRequests > 0) {
    throw unprocessable('open_requests', 'توجد طلبات استكمال مفتوحة', 'There are open information requests');
  }

  const app = get<any>(`SELECT * FROM project_applications WHERE id = ?`, [ddCase.application_id]);
  const pack = {
    application: { reference: app.reference, title: app.title_ar, requestedAmount: app.requested_amount, sector: app.sector },
    entity: get(`SELECT legal_name, cr_number, incorporated_on FROM legal_entities WHERE id = ?`, [app.entity_id]),
    risk: { score: ddCase.risk_score, grade: ddCase.risk_grade, version: ddCase.model_version,
            inputs: JSON.parse(ddCase.score_inputs) },
    checklist: all(`SELECT code, status, note FROM dd_checklist_items WHERE case_id = ? ORDER BY code`, [ddCase.id]),
    useOfFunds: JSON.parse(app.use_of_funds),
    feeds: all(`SELECT source, period_start, period_end, gross_revenue FROM financial_feeds WHERE application_id = ?`, [app.id]),
  };

  const sessionId = newId();
  const at = nowIso();
  tx(() => {
    run(`INSERT INTO committee_sessions (id, case_id, pack_hash, status, opened_at) VALUES (?,?,?, 'open', ?)`,
        [sessionId, ddCase.id, contentHash(pack), at]);
    run(`UPDATE dd_cases SET status = 'ready_for_committee' WHERE id = ?`, [ddCase.id]);
    run(`UPDATE project_applications SET status = 'committee', updated_at = ? WHERE id = ?`, [at, app.id]);
  });
  audit({ actorId: req.auth!.userId, action: 'committee.session_opened', entityType: 'committee_session',
          entityId: sessionId, after: { packHash: contentHash(pack) } });

  res.json({ sessionId, packHash: contentHash(pack), pack });
});

// ─────────────────────────── FR-107 committee ───────────────────────────

originationRouter.get('/committee/sessions', requireAuth, requirePermission('committee.read'), (_req, res) => {
  const rows = all<any>(
    `SELECT s.*, a.reference, a.title_ar, a.requested_amount, c.risk_score, c.risk_grade
       FROM committee_sessions s
       JOIN dd_cases c ON c.id = s.case_id
       JOIN project_applications a ON a.id = c.application_id
      ORDER BY s.opened_at DESC`,
  );
  res.json({ items: rows.map((r) => ({ ...r, conditions: JSON.parse(r.conditions) })) });
});

originationRouter.post('/committee/sessions/:id/vote', requireAuth, requirePermission('committee.vote'), (req, res) => {
  const body = z.object({
    vote: z.enum(['approve', 'conditional', 'reject', 'recused']),
    rationale: z.string().min(10),
    conflictDeclared: z.boolean().default(false),
  }).parse(req.body);

  const session = get<any>(`SELECT * FROM committee_sessions WHERE id = ?`, [req.params.id]);
  if (!session) throw notFound();
  if (session.status !== 'open') throw conflict('session_closed', 'انتهت جلسة اللجنة', 'The committee session is closed');

  // BR-016 — a conflicted member must recuse; their vote cannot count.
  const effectiveVote = body.conflictDeclared ? 'recused' : body.vote;
  if (body.conflictDeclared && body.vote !== 'recused') {
    audit({ actorId: req.auth!.userId, action: 'committee.conflict_forced_recusal', entityType: 'committee_session',
            entityId: session.id, after: { attempted: body.vote } });
  }

  const existing = get<any>(`SELECT id FROM committee_votes WHERE session_id = ? AND member_id = ?`,
                            [session.id, req.auth!.userId]);
  if (existing) throw conflict('already_voted', 'سجلت صوتك مسبقًا', 'You have already voted in this session');

  run(`INSERT INTO committee_votes (id, session_id, member_id, vote, rationale, conflict_declared, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [newId(), session.id, req.auth!.userId, effectiveVote, body.rationale, body.conflictDeclared ? 1 : 0, nowIso()]);
  audit({ actorId: req.auth!.userId, action: 'committee.voted', entityType: 'committee_session', entityId: session.id,
          after: { vote: effectiveVote, conflict: body.conflictDeclared } });

  res.status(201).json({ sessionId: session.id, vote: effectiveVote });
});

// FR-108 — reasoned decision, configurable quorum; internal reasons stay internal.
originationRouter.post('/committee/sessions/:id/decide', requireAuth, requirePermission('committee.decide'), (req, res) => {
  const body = z.object({
    decision: z.enum(['approved', 'conditional', 'rejected']),
    reason: z.string().min(10),
    conditions: z.array(z.string()).default([]),
    applicantMessage: z.string().min(5),
  }).parse(req.body);

  const session = get<any>(`SELECT * FROM committee_sessions WHERE id = ?`, [req.params.id]);
  if (!session) throw notFound();
  if (session.status !== 'open') throw conflict('session_closed', 'انتهت جلسة اللجنة', 'The committee session is closed');

  const votes = all<any>(`SELECT * FROM committee_votes WHERE session_id = ?`, [session.id]);
  const counting = votes.filter((v) => v.vote !== 'recused');
  if (counting.length < session.quorum) {
    throw unprocessable('quorum_not_met', 'لم يكتمل النصاب', 'Quorum has not been met',
      { quorum: session.quorum, counted: counting.length });
  }
  if (body.decision === 'conditional' && body.conditions.length === 0) {
    throw unprocessable('conditions_required', 'يلزم تحديد الشروط للقرار المشروط',
      'A conditional decision must specify its conditions');
  }

  const ddCase = get<any>(`SELECT * FROM dd_cases WHERE id = ?`, [session.case_id]);
  const app = get<any>(`SELECT * FROM project_applications WHERE id = ?`, [ddCase.application_id]);
  const at = nowIso();

  tx(() => {
    run(`UPDATE committee_sessions SET status = 'decided', decision = ?, decision_reason = ?, conditions = ?, decided_at = ?
          WHERE id = ?`,
        [body.decision, body.reason, JSON.stringify(body.conditions), at, session.id]);
    run(`UPDATE dd_cases SET status = 'decided', closed_at = ? WHERE id = ?`, [at, ddCase.id]);
    run(`UPDATE project_applications SET status = ?, decided_at = ?, updated_at = ? WHERE id = ?`,
        [body.decision === 'approved' ? 'approved' : body.decision === 'conditional' ? 'conditional' : 'rejected',
         at, at, app.id]);
  });

  audit({ actorId: req.auth!.userId, action: `committee.${body.decision}`, entityType: 'committee_session',
          entityId: session.id, after: { decision: body.decision, conditions: body.conditions },
          reason: body.reason });
  track('application_approved', app.owner_user_id, { decision: body.decision });

  // The applicant receives the outcome and the message written for them — never the internal rationale.
  notify({
    userId: app.owner_user_id,
    templateCode: body.decision === 'rejected' ? 'application_rejected' : 'application_approved',
    variables: { reference: app.reference, message: body.applicantMessage },
  });

  res.json({
    sessionId: session.id, decision: body.decision, conditions: body.conditions,
    tally: {
      approve: counting.filter((v) => v.vote === 'approve').length,
      conditional: counting.filter((v) => v.vote === 'conditional').length,
      reject: counting.filter((v) => v.vote === 'reject').length,
      recused: votes.length - counting.length,
    },
  });
});

// Documents (FR-102)
originationRouter.post('/applications/:id/documents', requireAuth, (req, res) => {
  const app = assertOwner(req.params.id, req.auth!.userId, req.auth!.roles);
  const body = z.object({
    category: z.string().min(2),
    fileName: z.string().min(1),
    mimeType: z.string().min(3),
    contentBase64: z.string().min(1),
    expiresOn: z.string().optional(),
  }).parse(req.body);

  const document = attachDocument({
    ownerType: 'application', ownerId: app.id, category: body.category, fileName: body.fileName,
    mimeType: body.mimeType, contentBase64: body.contentBase64, uploadedBy: req.auth!.userId,
    expiresOn: body.expiresOn, visibility: 'internal',
  });
  res.status(201).json(document);
});
