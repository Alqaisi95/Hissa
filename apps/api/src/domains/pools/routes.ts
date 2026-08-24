/** Pool construction, disclosure, marketplace, data room and Q&A (FR-201..FR-208). */
import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx, nextSequence } from '../../db/index.ts';
import { newId, nowIso, plus, days, makeReference } from '../../lib/ids.ts';
import { contentHash } from '../../lib/crypto.ts';
import { audit } from '../../lib/audit.ts';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { poolPolicy, fees, findBannedTerms } from '../../lib/settings.ts';
import { transition } from '../../workflow/poolState.ts';
import { committedToPool, evaluateEligibility, publicVerdict, issuerRaiseAllowed } from '../orders/eligibility.ts';
import { listDocuments, readDocument, attachDocument } from '../../lib/documents.ts';
import { notify } from '../../integrations/notifications.ts';
import { track } from '../analytics/track.ts';

export const poolsRouter = Router();

/** FR-201 — the mandatory disclosure sections. None may be empty at publication. */
const disclosureSchema = z.object({
  summary: z.object({
    activityAr: z.string().min(20),
    useOfFundsAr: z.string().min(20),
    expansionRationaleAr: z.string().min(20),
  }),
  financials: z.object({
    historicalRevenue: z.array(z.object({ period: z.string(), amount: z.number().int() })).min(3),
    assumptionsAr: z.string().min(20),
    scenarios: z.object({
      conservative: z.object({ annualCashYieldBps: z.number().int(), narrativeAr: z.string().min(10) }),
      base: z.object({ annualCashYieldBps: z.number().int(), narrativeAr: z.string().min(10) }),
      optimistic: z.object({ annualCashYieldBps: z.number().int(), narrativeAr: z.string().min(10) }),
    }),
  }),
  rights: z.object({
    instrumentAr: z.string().min(10),
    distributionPolicyAr: z.string().min(10),
    votingAr: z.string().min(5),
    restrictionsAr: z.string().min(5),
    exitMechanismAr: z.string().min(20),
    defaultHandlingAr: z.string().min(10),
  }),
  risks: z.object({
    capitalLossAr: z.string().min(20),
    liquidityAr: z.string().min(20),
    operationalAr: z.string().min(20),
    sectorAr: z.string().min(10),
    conflictsAr: z.string().min(10),
    dependenciesAr: z.string().min(10),
  }),
  fees: z.object({
    assessmentFee: z.number().int().nonnegative(),
    successFeeBps: z.number().int().nonnegative(),
    monitoringFeeBps: z.number().int().nonnegative(),
    investorFeeNoteAr: z.string().min(5),
  }),
  evidence: z.array(z.object({ label: z.string(), documentId: z.string().uuid().optional() })).default([]),
});

// ─────────────────────────── FR-203/FR-204 pool builder ───────────────────────────

poolsRouter.post('/', requireAuth, requirePermission('pool.build'), (req, res) => {
  const body = z.object({
    applicationId: z.string().uuid(),
    titleAr: z.string().min(5),
    titleEn: z.string().optional(),
    structure: z.enum(['spv_equity', 'profit_share']).default('spv_equity'),
    spvName: z.string().optional(),
    totalUnits: z.number().int().positive(),
    unitPrice: z.number().int().positive(),
    targetAmount: z.number().int().positive(),
    minAmount: z.number().int().positive(),
    maxAmount: z.number().int().positive().optional(),
    minTicket: z.number().int().positive().optional(),
    maxTicket: z.number().int().positive().optional(),
    ownerContribution: z.number().int().nonnegative(),
    tenorMonths: z.number().int().positive(),
    allocationRule: z.enum(['pro_rata', 'first_confirmed']).default('pro_rata'),
    campaignDays: z.number().int().positive().optional(),
  }).parse(req.body);

  const app = get<any>(`SELECT * FROM project_applications WHERE id = ?`, [body.applicationId]);
  if (!app) throw notFound();
  if (!['approved', 'conditional'].includes(app.status)) {
    throw conflict('application_not_approved', 'لم يعتمد الطلب من اللجنة بعد', 'The application is not committee-approved');
  }
  if (get<any>(`SELECT id FROM pools WHERE application_id = ?`, [app.id])) {
    throw conflict('pool_exists', 'توجد فرصة منشأة لهذا الطلب', 'A pool already exists for this application');
  }

  const policy = poolPolicy();
  // BR-010 — pilot pool size band.
  if (body.targetAmount < policy.minPoolSize || body.targetAmount > policy.maxPoolSize) {
    throw unprocessable('pool_size_out_of_policy', 'حجم الفرصة خارج نطاق سياسة التجربة',
      'Pool size falls outside the pilot policy band',
      { minPoolSize: policy.minPoolSize, maxPoolSize: policy.maxPoolSize });
  }
  // BR-008 — all-or-nothing: the minimum must be reachable and meaningful.
  if (body.minAmount > body.targetAmount) {
    throw unprocessable('min_above_target', 'الحد الأدنى أعلى من الهدف', 'The minimum exceeds the target');
  }
  if (body.maxAmount && body.maxAmount < body.targetAmount) {
    throw unprocessable('max_below_target', 'الحد الأقصى أقل من الهدف', 'The ceiling is below the target');
  }
  // FR-204 — ownership arithmetic must tie to the legal document.
  if (body.totalUnits * body.unitPrice !== body.targetAmount) {
    throw unprocessable('units_mismatch', 'حاصل ضرب الوحدات في سعر الوحدة لا يساوي الهدف',
      'total units × unit price must equal the target amount');
  }
  // BR-011 — owner contribution band.
  const contributionBps = Math.round((body.ownerContribution * 10_000) / (body.targetAmount + body.ownerContribution));
  if (contributionBps < policy.ownerContributionMinBps) {
    throw unprocessable('owner_contribution_low', 'مساهمة صاحب المشروع أقل من الحد الداخلي',
      'Owner contribution is below the internal policy floor',
      { requiredBps: policy.ownerContributionMinBps, actualBps: contributionBps });
  }
  if (!issuerRaiseAllowed(app.entity_id, body.targetAmount)) {
    throw unprocessable('issuer_cap', 'المبلغ يتجاوز الحد المسموح لعمر الكيان', 'The amount exceeds the issuer age ceiling');
  }

  const id = newId();
  const at = nowIso();
  run(
    `INSERT INTO pools (id, reference, application_id, entity_id, title_ar, title_en, sector, governorate,
                        structure, spv_name, total_units, unit_price, target_amount, min_amount, max_amount,
                        min_ticket, max_ticket, owner_contribution, tenor_months, allocation_rule, status,
                        closes_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft', ?,?,?,?)`,
    [id, makeReference('POOL', nextSequence('pools')), app.id, app.entity_id, body.titleAr, body.titleEn ?? null,
     app.sector, app.governorate, body.structure, body.spvName ?? null, body.totalUnits, body.unitPrice,
     body.targetAmount, body.minAmount, body.maxAmount ?? null, body.minTicket ?? policy.minTicket,
     body.maxTicket ?? null, body.ownerContribution, body.tenorMonths, body.allocationRule,
     plus(at, days(body.campaignDays ?? policy.defaultCampaignDays)), req.auth!.userId, at, at],
  );
  run(`INSERT INTO pool_state_events (id, pool_id, from_state, to_state, reason, payload, actor_id, created_at)
       VALUES (?,?,NULL,'draft',?,?,?,?)`,
      [newId(), id, 'pool created from approved application', JSON.stringify({ applicationId: app.id }), req.auth!.userId, at]);
  audit({ actorId: req.auth!.userId, action: 'pool.created', entityType: 'pool', entityId: id,
          after: { targetAmount: body.targetAmount, structure: body.structure } });

  res.status(201).json({ poolId: id, status: 'draft', ownerContributionBps: contributionBps });
});

// ─────────────────────────── FR-201/FR-202 disclosure versions ───────────────────────────

poolsRouter.post('/:id/disclosures', requireAuth, requirePermission('pool.build'), (req, res) => {
  const body = z.object({
    sections: disclosureSchema,
    changeReason: z.string().optional(),
    materialChange: z.boolean().default(false),
  }).parse(req.body);

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();
  if (['closed', 'cancelled'].includes(pool.status)) {
    throw conflict('pool_closed', 'الفرصة مغلقة', 'The pool is closed');
  }

  // BR-013 — no guarantee language anywhere in investor-facing copy.
  const banned = findBannedTerms(JSON.stringify(body.sections));
  if (banned.length) {
    throw unprocessable('banned_terms', 'يحتوي الإفصاح على عبارات ضمان غير مسموحة',
      'The disclosure contains prohibited guarantee wording', { terms: banned });
  }
  // "الشفافية قبل العائد": the conservative scenario may not exceed the base case.
  const { conservative, base, optimistic } = body.sections.financials.scenarios;
  if (conservative.annualCashYieldBps > base.annualCashYieldBps || base.annualCashYieldBps > optimistic.annualCashYieldBps) {
    throw unprocessable('scenario_order', 'ترتيب السيناريوهات غير منطقي',
      'Scenarios must be ordered conservative ≤ base ≤ optimistic');
  }

  const previous = get<{ version: number }>(
    `SELECT MAX(version) AS version FROM disclosure_versions WHERE pool_id = ?`, [pool.id]);
  const version = (previous?.version ?? 0) + 1;
  // FR-202: a live pool requires an explicit reason for every new version.
  if (version > 1 && !body.changeReason) {
    throw unprocessable('change_reason_required', 'يلزم ذكر سبب إصدار نسخة جديدة',
      'A change reason is required for a new disclosure version');
  }

  const id = newId();
  run(
    `INSERT INTO disclosure_versions (id, pool_id, version, sections, content_hash, status, change_reason,
                                      material_change, created_by, created_at)
     VALUES (?,?,?,?,?, 'draft', ?,?,?,?)`,
    [id, pool.id, version, JSON.stringify(body.sections), contentHash(body.sections),
     body.changeReason ?? null, body.materialChange ? 1 : 0, req.auth!.userId, nowIso()],
  );
  audit({ actorId: req.auth!.userId, action: 'disclosure.drafted', entityType: 'disclosure_version', entityId: id,
          after: { poolId: pool.id, version, materialChange: body.materialChange }, reason: body.changeReason });

  res.status(201).json({ disclosureId: id, version, contentHash: contentHash(body.sections), status: 'draft' });
});

poolsRouter.get('/:id/disclosures', requireAuth, requirePermission('pool.read_any'), (req, res) => {
  const rows = all<any>(
    `SELECT id, version, status, content_hash, change_reason, material_change, published_at, created_at
       FROM disclosure_versions WHERE pool_id = ? ORDER BY version DESC`, [req.params.id]);
  res.json({ items: rows });
});

/** FR-202 — version comparison, so a material change is visible rather than silent. */
poolsRouter.get('/:id/disclosures/diff', requireAuth, (req, res) => {
  const query = z.object({ from: z.coerce.number().int(), to: z.coerce.number().int() }).parse(req.query);
  const load = (version: number) => get<any>(
    `SELECT sections FROM disclosure_versions WHERE pool_id = ? AND version = ?`, [req.params.id, version]);

  const a = load(query.from), b = load(query.to);
  if (!a || !b) throw notFound();

  const flatten = (obj: any, prefix = ''): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj ?? {})) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(out, flatten(value, path));
      else out[path] = JSON.stringify(value);
    }
    return out;
  };

  const flatA = flatten(JSON.parse(a.sections));
  const flatB = flatten(JSON.parse(b.sections));
  const changes = [...new Set([...Object.keys(flatA), ...Object.keys(flatB)])]
    .filter((key) => flatA[key] !== flatB[key])
    .map((key) => ({ path: key, from: flatA[key] ?? null, to: flatB[key] ?? null }));

  res.json({ from: query.from, to: query.to, changes });
});

// ─────────────────────────── Publication (FR-201, FR-205, BR-014) ───────────────────────────

poolsRouter.post('/:id/publish', requireAuth, requirePermission('pool.publish'), (req, res) => {
  const body = z.object({
    disclosureId: z.string().uuid(),
    escrowAccountRef: z.string().min(4),
    reason: z.string().min(5).default('committee-approved opportunity published for funding'),
  }).parse(req.body);

  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();

  const disclosure = get<any>(`SELECT * FROM disclosure_versions WHERE id = ? AND pool_id = ?`, [body.disclosureId, pool.id]);
  if (!disclosure) throw notFound();
  // FR-201 — the schema itself enforces "no mandatory section left empty".
  disclosureSchema.parse(JSON.parse(disclosure.sections));

  // "Owner First": the project owner's contribution is in escrow before public money is raised.
  if (!pool.owner_contribution_received_at) {
    throw unprocessable('owner_contribution_pending', 'لم تُستلم مساهمة صاحب المشروع بعد',
      'The project owner contribution has not been received yet');
  }

  const at = nowIso();
  tx(() => {
    run(`UPDATE disclosure_versions SET status = 'superseded' WHERE pool_id = ? AND status = 'published'`, [pool.id]);
    run(`UPDATE disclosure_versions SET status = 'published', approved_by = ?, published_at = ? WHERE id = ?`,
        [req.auth!.userId, at, disclosure.id]);
    run(`UPDATE pools SET escrow_account_ref = ?, updated_at = ? WHERE id = ?`, [body.escrowAccountRef, at, pool.id]);

    if (pool.status === 'funding' || pool.status === 'paused') {
      // Re-publishing a revised disclosure on a live pool changes the document,
      // not the pool state. The version swap is still recorded on the timeline.
      run(`INSERT INTO pool_state_events (id, pool_id, from_state, to_state, reason, payload, actor_id, created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          [newId(), pool.id, pool.status, pool.status,
           `disclosure version ${disclosure.version} published: ${body.reason}`,
           JSON.stringify({ disclosureId: disclosure.id, version: disclosure.version,
                            materialChange: disclosure.material_change === 1 }),
           req.auth!.userId, at]);
      audit({ actorId: req.auth!.userId, action: 'disclosure.published', entityType: 'disclosure_version',
              entityId: disclosure.id, after: { poolId: pool.id, version: disclosure.version },
              reason: body.reason });
    } else {
      if (pool.status === 'draft') {
        transition({ poolId: pool.id, to: 'approved', reason: 'disclosure approved for publication',
                     actorId: req.auth!.userId, payload: { disclosureId: disclosure.id } });
      }
      transition({ poolId: pool.id, to: 'funding', reason: body.reason, actorId: req.auth!.userId,
                   payload: { disclosureId: disclosure.id, version: disclosure.version } });
      run(`UPDATE project_applications SET status = 'published', updated_at = ? WHERE id = ?`, [at, pool.application_id]);
    }
  });

  // BR-014 — a material change after publication notifies every existing investor.
  if (disclosure.material_change === 1) {
    const investors = all<{ investor_id: string }>(
      `SELECT DISTINCT investor_id FROM investment_orders WHERE pool_id = ? AND status IN ('pending','confirmed')`, [pool.id]);
    for (const investor of investors) {
      notify({ userId: investor.investor_id, templateCode: 'material_change',
               variables: { poolTitle: pool.title_ar, version: disclosure.version } });
    }
    run(`INSERT INTO cases (id, reference, type, subject, body, severity, status, related_type, related_id,
                            sla_due_at, created_at, updated_at)
         VALUES (?,?, 'material_change', ?, ?, 'high', 'open', 'pool', ?, ?, ?, ?)`,
        [newId(), `CASE-MC-${pool.reference}-v${disclosure.version}`,
         `تغيير جوهري — ${pool.title_ar}`, disclosure.change_reason ?? '', pool.id, plus(at, days(3)), at, at]);
  }

  res.json({
    poolId: pool.id,
    status: get<{ status: string }>(`SELECT status FROM pools WHERE id = ?`, [pool.id])!.status,
    disclosureVersion: disclosure.version,
    closesAt: pool.closes_at,
  });
});

// FR-208 — pause / extend / cancel, each with a reason and an effect on commitments.
poolsRouter.post('/:id/pause', requireAuth, requirePermission('pool.pause'), (req, res) => {
  const body = z.object({ reason: z.string().min(10) }).parse(req.body);
  transition({ poolId: req.params.id, to: 'paused', reason: body.reason, actorId: req.auth!.userId });
  res.json({ poolId: req.params.id, status: 'paused', effect: 'no new commitments accepted; existing commitments unchanged' });
});

poolsRouter.post('/:id/resume', requireAuth, requirePermission('pool.publish'), (req, res) => {
  const body = z.object({ reason: z.string().min(10) }).parse(req.body);
  transition({ poolId: req.params.id, to: 'funding', reason: body.reason, actorId: req.auth!.userId });
  res.json({ poolId: req.params.id, status: 'funding' });
});

poolsRouter.post('/:id/extend', requireAuth, requirePermission('pool.publish'), (req, res) => {
  const body = z.object({ additionalDays: z.number().int().positive().max(60), reason: z.string().min(10) }).parse(req.body);
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();
  if (pool.status !== 'funding' && pool.status !== 'paused') {
    throw conflict('not_extendable', 'لا يمكن تمديد الفرصة في حالتها الحالية', 'The pool cannot be extended in its current state');
  }

  const closesAt = plus(pool.closes_at, days(body.additionalDays));
  run(`UPDATE pools SET closes_at = ?, updated_at = ? WHERE id = ?`, [closesAt, nowIso(), pool.id]);
  run(`INSERT INTO pool_state_events (id, pool_id, from_state, to_state, reason, payload, actor_id, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [newId(), pool.id, pool.status, pool.status, `extended by ${body.additionalDays} days: ${body.reason}`,
       JSON.stringify({ previousClosesAt: pool.closes_at, closesAt }), req.auth!.userId, nowIso()]);
  audit({ actorId: req.auth!.userId, action: 'pool.extended', entityType: 'pool', entityId: pool.id,
          before: { closesAt: pool.closes_at }, after: { closesAt }, reason: body.reason });

  const investors = all<{ investor_id: string }>(
    `SELECT DISTINCT investor_id FROM investment_orders WHERE pool_id = ? AND status IN ('pending','confirmed')`, [pool.id]);
  for (const investor of investors) {
    notify({ userId: investor.investor_id, templateCode: 'pool_extended', variables: { poolTitle: pool.title_ar, closesAt } });
  }
  res.json({ poolId: pool.id, closesAt });
});

poolsRouter.post('/:id/cancel', requireAuth, requirePermission('pool.cancel'), (req, res) => {
  const body = z.object({ reason: z.string().min(10) }).parse(req.body);
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();

  const committed = committedToPool(pool.id);
  // Cancelling with money in escrow must go through refunds, never straight to cancelled.
  const target = committed > 0 ? 'refunding' : 'cancelled';
  transition({ poolId: pool.id, to: target, reason: body.reason, actorId: req.auth!.userId, payload: { committed } });

  res.json({ poolId: pool.id, status: target, committedAmount: committed,
             note: committed > 0 ? 'refund orders will be created for every confirmed commitment' : undefined });
});

/** Records the project owner's contribution into escrow (Owner First rule). */
poolsRouter.post('/:id/owner-contribution', requireAuth, requirePermission('funds.request'), (req, res) => {
  const body = z.object({ receivedAt: z.string().optional(), reference: z.string().min(3) }).parse(req.body);
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();

  const at = body.receivedAt ?? nowIso();
  run(`UPDATE pools SET owner_contribution_received_at = ?, updated_at = ? WHERE id = ?`, [at, nowIso(), pool.id]);
  audit({ actorId: req.auth!.userId, action: 'pool.owner_contribution_received', entityType: 'pool', entityId: pool.id,
          after: { receivedAt: at, reference: body.reference } });
  res.json({ poolId: pool.id, ownerContributionReceivedAt: at });
});

// ─────────────────────────── FR-205 marketplace ───────────────────────────

/** Public listing — unpublished opportunities are never exposed. */
poolsRouter.get('/', (req, res) => {
  const query = z.object({
    sector: z.string().optional(),
    governorate: z.string().optional(),
    status: z.enum(['funding', 'funded', 'operating', 'closed', 'all']).default('funding'),
    search: z.string().optional(),
    sort: z.enum(['newest', 'closing_soon', 'progress']).default('closing_soon'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);

  const visible = ['funding', 'paused', 'funded', 'disbursement', 'operating', 'closed'];
  const filters: string[] = [`status IN (${visible.map(() => '?').join(',')})`, `published_at IS NOT NULL`];
  const params: any[] = [...visible];

  if (query.status !== 'all') { filters.push('status = ?'); params.push(query.status); }
  if (query.sector) { filters.push('sector = ?'); params.push(query.sector); }
  if (query.governorate) { filters.push('governorate = ?'); params.push(query.governorate); }
  if (query.search) { filters.push('(title_ar LIKE ? OR title_en LIKE ?)'); params.push(`%${query.search}%`, `%${query.search}%`); }

  const order = { newest: 'published_at DESC', closing_soon: 'closes_at ASC', progress: 'target_amount DESC' }[query.sort];
  const rows = all<any>(
    `SELECT id, reference, title_ar, title_en, sector, governorate, structure, target_amount, min_amount,
            min_ticket, tenor_months, status, published_at, closes_at, funded_at
       FROM pools WHERE ${filters.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, query.limit, query.offset],
  );

  res.json({
    items: rows.map((pool) => {
      const raised = committedToPool(pool.id);
      return {
        ...pool,
        raisedAmount: raised,
        progressBps: Math.min(10_000, Math.round((raised * 10_000) / pool.target_amount)),
        investorCount: get<{ n: number }>(
          `SELECT COUNT(DISTINCT investor_id) AS n FROM investment_orders
            WHERE pool_id = ? AND status IN ('pending','confirmed','allocated')`, [pool.id])!.n,
        daysRemaining: pool.closes_at
          ? Math.max(0, Math.ceil((new Date(pool.closes_at).getTime() - Date.now()) / days(1))) : null,
      };
    }),
    total: get<{ n: number }>(`SELECT COUNT(*) AS n FROM pools WHERE ${filters.join(' AND ')}`, params)!.n,
  });
});

poolsRouter.get('/facets', (_req, res) => {
  res.json({
    sectors: all(`SELECT sector, COUNT(*) AS count FROM pools WHERE published_at IS NOT NULL GROUP BY sector`),
    governorates: all(`SELECT governorate, COUNT(*) AS count FROM pools
                        WHERE published_at IS NOT NULL AND governorate IS NOT NULL GROUP BY governorate`),
  });
});

/** FR-206/§6.1 — pool detail. Restricted evidence is withheld from non-eligible viewers. */
poolsRouter.get('/:id', (req, res) => {
  const pool = get<any>(`SELECT * FROM pools WHERE id = ? OR reference = ?`, [req.params.id, req.params.id]);
  if (!pool) throw notFound();

  const isStaff = req.auth?.roles.some((r) => ['compliance', 'investment_analyst', 'portfolio_ops', 'auditor', 'committee_member'].includes(r)) ?? false;
  if (!pool.published_at && !isStaff) throw notFound();

  const disclosure = get<any>(
    `SELECT * FROM disclosure_versions WHERE pool_id = ? AND status = 'published' ORDER BY version DESC LIMIT 1`, [pool.id]);
  const raised = committedToPool(pool.id);

  // A verified investor may see the full data room; the public sees the public set.
  const viewerVerified = req.auth
    ? get<any>(`SELECT 1 FROM investor_profiles WHERE user_id = ? AND kyc_status = 'approved'`, [req.auth.userId]) != null
    : false;
  const visibility = isStaff ? undefined
    : viewerVerified ? ['public', 'investor_verified'] : ['public'];

  if (req.auth) track('pool_viewed', req.auth.userId, {}, pool.id);
  else track('pool_viewed', null, {}, pool.id);

  res.json({
    pool: {
      ...pool,
      raisedAmount: raised,
      progressBps: Math.min(10_000, Math.round((raised * 10_000) / pool.target_amount)),
      investorCount: get<{ n: number }>(
        `SELECT COUNT(DISTINCT investor_id) AS n FROM investment_orders
          WHERE pool_id = ? AND status IN ('pending','confirmed','allocated')`, [pool.id])!.n,
      daysRemaining: pool.closes_at
        ? Math.max(0, Math.ceil((new Date(pool.closes_at).getTime() - Date.now()) / days(1))) : null,
    },
    disclosure: disclosure ? {
      id: disclosure.id, version: disclosure.version, contentHash: disclosure.content_hash,
      publishedAt: disclosure.published_at, sections: JSON.parse(disclosure.sections),
    } : null,
    dataRoom: listDocuments('pool', pool.id, visibility),
    // FR-207: only approved answers are public.
    questions: all(
      `SELECT id, body, answer, published_at FROM pool_questions WHERE pool_id = ? AND status = 'published'
        ORDER BY published_at DESC`, [pool.id]),
    fees: fees(),
    eligibility: req.auth ? publicVerdict(evaluateEligibility(req.auth.userId, pool.id)) : null,
    riskWarningAr: 'الاستثمار في هذه الفرصة قد يؤدي إلى خسارة كامل رأس المال. لا يوجد ضمان للعائد أو لرأس المال، ولا توجد سوق ثانوية.',
    riskWarningEn: 'Investing in this opportunity may result in the loss of your entire capital. No return or capital is guaranteed, and there is no secondary market.',
  });
});

poolsRouter.get('/:id/timeline', requireAuth, requirePermission('pool.read_any'), (req, res) => {
  res.json({
    events: all(
      `SELECT e.from_state, e.to_state, e.reason, e.created_at, u.full_name AS actor
         FROM pool_state_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.pool_id = ? ORDER BY e.created_at ASC`, [req.params.id]),
  });
});

// ─────────────────────────── FR-206 data room ───────────────────────────

poolsRouter.post('/:id/documents', requireAuth, requirePermission('pool.build'), (req, res) => {
  const body = z.object({
    category: z.string().min(2),
    fileName: z.string().min(1),
    mimeType: z.string().min(3),
    contentBase64: z.string().min(1),
    visibility: z.enum(['internal', 'investor_verified', 'public']).default('investor_verified'),
  }).parse(req.body);

  const result = attachDocument({
    ownerType: 'pool', ownerId: req.params.id, category: body.category, fileName: body.fileName,
    mimeType: body.mimeType, contentBase64: body.contentBase64, uploadedBy: req.auth!.userId,
    visibility: body.visibility,
  });
  res.status(201).json(result);
});

poolsRouter.get('/:id/documents/:documentId', requireAuth, (req, res) => {
  const doc = get<any>(`SELECT * FROM documents WHERE id = ? AND owner_type = 'pool' AND owner_id = ?`,
                       [req.params.documentId, req.params.id]);
  if (!doc) throw notFound();

  const isStaff = req.auth!.roles.some((r) => ['compliance', 'investment_analyst', 'portfolio_ops', 'auditor'].includes(r));
  const verified = get<any>(
    `SELECT 1 FROM investor_profiles WHERE user_id = ? AND kyc_status = 'approved'`, [req.auth!.userId]) != null;

  const allowed = doc.visibility === 'public' || isStaff || (doc.visibility === 'investor_verified' && verified);
  const { doc: found, data } = readDocument(doc.id, req.auth!.userId, allowed, req.ip);

  res.setHeader('content-type', found.mime_type);
  res.setHeader('content-disposition', `attachment; filename="${encodeURIComponent(found.file_name)}"`);
  res.send(data);
});

// ─────────────────────────── FR-207 Q&A ───────────────────────────

poolsRouter.post('/:id/questions', requireAuth, (req, res) => {
  const body = z.object({ body: z.string().min(10).max(1000) }).parse(req.body);
  const pool = get<any>(`SELECT id FROM pools WHERE id = ?`, [req.params.id]);
  if (!pool) throw notFound();

  const id = newId();
  run(`INSERT INTO pool_questions (id, pool_id, asked_by, body, status, created_at) VALUES (?,?,?,?, 'pending', ?)`,
      [id, pool.id, req.auth!.userId, body.body, nowIso()]);
  res.status(201).json({ questionId: id, status: 'pending', noteAr: 'سيُنشر السؤال والجواب بعد مراجعة الفريق المخول.' });
});

poolsRouter.get('/:id/questions/pending', requireAuth, requirePermission('qa.moderate'), (req, res) => {
  res.json({ items: all(`SELECT * FROM pool_questions WHERE pool_id = ? AND status <> 'published' ORDER BY created_at`,
                        [req.params.id]) });
});

/** FR-207 — an answer is never public before the authorised role approves it. */
poolsRouter.post('/questions/:questionId/answer', requireAuth, requirePermission('qa.moderate'), (req, res) => {
  const body = z.object({
    answer: z.string().min(5),
    publish: z.boolean().default(false),
    rejectReason: z.string().optional(),
  }).parse(req.body);

  const question = get<any>(`SELECT * FROM pool_questions WHERE id = ?`, [req.params.questionId]);
  if (!question) throw notFound();

  const banned = findBannedTerms(body.answer);
  if (banned.length) {
    throw unprocessable('banned_terms', 'يحتوي الجواب على عبارات ضمان غير مسموحة',
      'The answer contains prohibited guarantee wording', { terms: banned });
  }

  const at = nowIso();
  const status = body.rejectReason ? 'rejected' : body.publish ? 'published' : 'answered';
  run(`UPDATE pool_questions SET answer = ?, answered_by = ?, status = ?, published_at = ? WHERE id = ?`,
      [body.answer, req.auth!.userId, status, status === 'published' ? at : null, question.id]);
  audit({ actorId: req.auth!.userId, action: `qa.${status}`, entityType: 'pool_question', entityId: question.id,
          after: { status }, reason: body.rejectReason });

  res.json({ questionId: question.id, status });
});
