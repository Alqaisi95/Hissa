/**
 * Pilot seed data — three pools at different lifecycle stages, the full staff
 * roster from PRD §9, and approved notification templates. Runs the real domain
 * logic where practical so the seeded state is internally consistent.
 *
 * Usage: npm run seed  (add --fresh to rebuild the database from scratch)
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

if (process.argv.includes('--fresh') && config.dbFile !== ':memory:' && fs.existsSync(config.dbFile)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${config.dbFile}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  const objects = config.storageDir;
  if (fs.existsSync(objects)) fs.rmSync(objects, { recursive: true, force: true });
  console.log('• removed existing database and object store');
}

const { db, run, get, all, tx } = await import('./index.ts');
const { newId, nowIso, plus, days, hours, makeReference } = await import('../lib/ids.ts');
const { hashPassword, contentHash } = await import('../lib/crypto.ts');
const { omr } = await import('../lib/money.ts');
const { DD_CHECKLIST } = await import('../domains/origination/riskModel.ts');
const { scoreRisk } = await import('../domains/origination/riskModel.ts');
const { LEGAL_DOCUMENTS } = await import('../lib/legal.ts');

db();
const at = nowIso();

// ─────────────────────────── users ───────────────────────────

const PASSWORD = process.env.SEED_PASSWORD ?? 'HissaPilot#2026';

function createUser(params: {
  fullName: string; email: string; phone?: string; roles: string[]; locale?: 'ar' | 'en';
}): string {
  const existing = get<{ id: string }>(`SELECT id FROM users WHERE email = ?`, [params.email]);
  if (existing) return existing.id;

  const { hash, salt } = hashPassword(PASSWORD);
  const id = newId();
  run(`INSERT INTO users (id, email, phone, full_name, password_hash, password_salt, locale, status,
                          email_verified_at, phone_verified_at, mfa_enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, 'active', ?,?,0,?,?)`,
      [id, params.email, params.phone ?? null, params.fullName, hash, salt, params.locale ?? 'ar', at, at, at, at]);
  for (const role of params.roles) {
    run(`INSERT INTO user_roles (user_id, role, granted_at) VALUES (?,?,?)`, [id, role, at]);
  }
  return id;
}

function createInvestor(params: {
  fullName: string; email: string; phone: string;
  classification: 'retail' | 'angel' | 'sophisticated';
  kyc?: 'approved' | 'in_review';
}): string {
  const userId = createUser({ fullName: params.fullName, email: params.email, phone: params.phone, roles: ['investor'] });
  if (!get(`SELECT 1 FROM investor_profiles WHERE user_id = ?`, [userId])) {
    run(`INSERT INTO investor_profiles (id, user_id, classification, classification_effective_from,
                                        suitability_score, suitability_result, suitability_taken_at,
                                        kyc_status, kyc_reference, kyc_approved_at, kyc_expires_at,
                                        risk_rating, created_at, updated_at)
         VALUES (?,?,?,?,100,'pass',?,?,?,?,?, 'low', ?, ?)`,
        [newId(), userId, params.classification, at, at, params.kyc ?? 'approved',
         `KYC-SEED-${userId.slice(0, 8).toUpperCase()}`,
         params.kyc === 'in_review' ? null : at,
         params.kyc === 'in_review' ? null : plus(at, days(365)), at, at]);
  }
  for (const doc of LEGAL_DOCUMENTS.filter((d) => ['terms', 'risk_disclosure', 'privacy'].includes(d.key))) {
    if (!get(`SELECT 1 FROM consents WHERE user_id = ? AND document_key = ?`, [userId, doc.key])) {
      run(`INSERT INTO consents (id, user_id, document_key, version, content_hash, accepted_at) VALUES (?,?,?,?,?,?)`,
          [newId(), userId, doc.key, doc.version, contentHash(doc.bodyAr + doc.bodyEn), at]);
    }
  }
  return userId;
}

const staff = {
  analyst:   createUser({ fullName: 'سالم بن ناصر الحارثي', email: 'analyst@hissa.om', roles: ['investment_analyst'] }),
  committee1: createUser({ fullName: 'د. مريم بنت حمد البلوشية', email: 'committee1@hissa.om', roles: ['committee_member'] }),
  committee2: createUser({ fullName: 'خالد بن سيف الرواحي', email: 'committee2@hissa.om', roles: ['committee_member'] }),
  committee3: createUser({ fullName: 'هدى بنت علي الزدجالية', email: 'committee3@hissa.om', roles: ['committee_member'] }),
  compliance: createUser({ fullName: 'أحمد بن راشد المعمري', email: 'compliance@hissa.om', roles: ['compliance'] }),
  financeMaker: createUser({ fullName: 'نورة بنت سالم الكندية', email: 'finance.maker@hissa.om', roles: ['finance_ops'] }),
  // FR-405 — a second Finance Ops user. Dual control is per transaction: the same
  // person can never approve a request they created.
  financeChecker: createUser({ fullName: 'يوسف بن محمد اللواتي', email: 'finance.checker@hissa.om', roles: ['finance_ops'] }),
  portfolio: createUser({ fullName: 'فاطمة بنت خميس الشكيلية', email: 'portfolio@hissa.om', roles: ['portfolio_ops'] }),
  admin:     createUser({ fullName: 'مسؤول النظام', email: 'admin@hissa.om', roles: ['system_admin'] }),
  auditor:   createUser({ fullName: 'المدقق الداخلي', email: 'auditor@hissa.om', roles: ['auditor'] }),
};

const investors = {
  retail1: createInvestor({ fullName: 'عبدالله بن سعيد الغافري', email: 'investor1@example.om', phone: '+96891234501', classification: 'retail' }),
  retail2: createInvestor({ fullName: 'شيخة بنت ناصر الهنائية', email: 'investor2@example.om', phone: '+96891234502', classification: 'retail' }),
  retail3: createInvestor({ fullName: 'ماجد بن علي البوسعيدي', email: 'investor3@example.om', phone: '+96891234503', classification: 'retail' }),
  angel:   createInvestor({ fullName: 'سعيد بن حمود الشحي', email: 'angel@example.om', phone: '+96891234504', classification: 'angel' }),
  soph:    createInvestor({ fullName: 'أمل بنت طالب المحروقية', email: 'sophisticated@example.om', phone: '+96891234505', classification: 'sophisticated' }),
  pending: createInvestor({ fullName: 'مستثمر قيد التحقق', email: 'pending@example.om', phone: '+96891234506', classification: 'retail', kyc: 'in_review' }),
};

const owners = {
  cafe:      createUser({ fullName: 'مازن بن يوسف البرواني', email: 'owner.cafe@example.om', phone: '+96892345601', roles: ['project_owner'] }),
  logistics: createUser({ fullName: 'ريم بنت خالد السيابية', email: 'owner.logistics@example.om', phone: '+96892345602', roles: ['project_owner'] }),
  bakery:    createUser({ fullName: 'طلال بن عامر الحجري', email: 'owner.bakery@example.om', phone: '+96892345603', roles: ['project_owner'] }),
};

// ─────────────────────────── notification templates (FR-608) ───────────────────────────

const { installTemplates } = await import('../lib/notificationTemplates.ts');
installTemplates(staff.compliance);

// ─────────────────────────── entities and applications ───────────────────────────

function createEntity(params: {
  legalName: string; cr: string; activity: string; incorporatedOn: string; governorate: string; repUserId: string; repName: string;
}): string {
  const existing = get<{ id: string }>(`SELECT id FROM legal_entities WHERE cr_number = ?`, [params.cr]);
  if (existing) return existing.id;

  const id = newId();
  run(`INSERT INTO legal_entities (id, legal_name, cr_number, activity, incorporated_on, governorate,
                                   kyb_status, kyb_reference, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'approved', ?, ?, ?, ?)`,
      [id, params.legalName, params.cr, params.activity, params.incorporatedOn, params.governorate,
       `KYB-SEED-${params.cr}`, params.repUserId, at, at]);
  run(`INSERT INTO entity_people (id, entity_id, user_id, full_name, role, ownership_bp, screened_at, screening_result, created_at)
       VALUES (?,?,?,?, 'authorised_rep', NULL, ?, 'clear', ?)`,
      [newId(), id, params.repUserId, params.repName, at, at]);
  run(`INSERT INTO entity_people (id, entity_id, full_name, role, ownership_bp, screened_at, screening_result, created_at)
       VALUES (?,?,?, 'ubo', 10000, ?, 'clear', ?)`,
      [newId(), id, params.repName, at, at]);
  return id;
}

const entities = {
  cafe: createEntity({ legalName: 'شركة نسائم القهوة ش.م.م', cr: '1234567', activity: 'مقاهي ومطاعم',
                       incorporatedOn: '2021-03-15', governorate: 'مسقط', repUserId: owners.cafe, repName: 'مازن بن يوسف البرواني' }),
  logistics: createEntity({ legalName: 'مؤسسة الطريق السريع للنقل', cr: '2345678', activity: 'نقل وخدمات لوجستية',
                            incorporatedOn: '2020-09-01', governorate: 'صحار', repUserId: owners.logistics, repName: 'ريم بنت خالد السيابية' }),
  bakery: createEntity({ legalName: 'مخابز الواحة الحديثة ش.م.م', cr: '3456789', activity: 'إنتاج غذائي',
                         incorporatedOn: '2019-06-20', governorate: 'نزوى', repUserId: owners.bakery, repName: 'طلال بن عامر الحجري' }),
};

interface PoolSpec {
  key: string;
  entityId: string; ownerId: string;
  titleAr: string; sector: string; governorate: string; summaryAr: string;
  target: number; ownerContribution: number; tenorMonths: number;
  useOfFunds: { item: string; supplier: string; amount: number; quoteReference: string }[];
  stage: 'funding' | 'operating' | 'failed';
}

const SPECS: PoolSpec[] = [
  {
    key: 'cafe', entityId: entities.cafe, ownerId: owners.cafe,
    titleAr: 'فرع جديد لمقهى نسائم — الموج، مسقط', sector: 'تجزئة وفروع', governorate: 'مسقط',
    summaryAr: 'افتتاح فرع ثالث لمقهى قائم منذ 2021 بمبيعات نقاط بيع موثقة، في موقع تجاري بمنطقة الموج بمسقط، بتمويل موجه للتجهيزات والمعدات والتشغيل الأولي.',
    target: omr(65_000), ownerContribution: omr(22_000), tenorMonths: 36,
    useOfFunds: [
      { item: 'تجهيزات وديكور الفرع', supplier: 'شركة التصاميم الحديثة', amount: omr(28_000), quoteReference: 'Q-2026-118' },
      { item: 'معدات تحضير القهوة والمشروبات', supplier: 'الخليج لمعدات المقاهي', amount: omr(19_500), quoteReference: 'Q-2026-119' },
      { item: 'أثاث وتكييف', supplier: 'مؤسسة الأثاث المكتبي', amount: omr(9_500), quoteReference: 'Q-2026-120' },
      { item: 'رأس مال تشغيلي أولي وثلاثة أشهر إيجار', supplier: 'مالك العقار', amount: omr(8_000), quoteReference: 'LEASE-2026-07' },
    ],
    stage: 'funding',
  },
  {
    key: 'logistics', entityId: entities.logistics, ownerId: owners.logistics,
    titleAr: 'توسعة أسطول شاحنات التوزيع — صحار', sector: 'لوجستيات ومركبات', governorate: 'صحار',
    summaryAr: 'شراء ثلاث شاحنات توزيع مبردة لتغطية عقود توريد قائمة مع ثلاث سلاسل تجزئة، لمؤسسة نقل قائمة منذ 2020 بعقود قابلة للتحقق.',
    target: omr(85_000), ownerContribution: omr(30_000), tenorMonths: 48,
    useOfFunds: [
      { item: 'ثلاث شاحنات مبردة', supplier: 'الوكيل المعتمد للشاحنات', amount: omr(72_000), quoteReference: 'Q-2026-201' },
      { item: 'تأمين شامل وترخيص لمدة سنة', supplier: 'شركة التأمين الوطنية', amount: omr(7_500), quoteReference: 'INS-2026-44' },
      { item: 'أنظمة تتبع وتبريد', supplier: 'تقنيات التتبع', amount: omr(5_500), quoteReference: 'Q-2026-202' },
    ],
    stage: 'operating',
  },
  {
    key: 'bakery', entityId: entities.bakery, ownerId: owners.bakery,
    titleAr: 'خط إنتاج المخبوزات المجمدة — نزوى', sector: 'معدات إنتاج غذائي', governorate: 'نزوى',
    summaryAr: 'إضافة خط إنتاج للمخبوزات المجمدة لمخبز قائم منذ 2019، لتلبية طلب متزايد من متاجر التجزئة في الداخلية.',
    target: omr(48_000), ownerContribution: omr(16_000), tenorMonths: 36,
    useOfFunds: [
      { item: 'خط إنتاج وتجميد', supplier: 'مورد معدات الأغذية', amount: omr(38_000), quoteReference: 'Q-2026-301' },
      { item: 'غرفة تبريد', supplier: 'أنظمة التبريد المتقدمة', amount: omr(7_000), quoteReference: 'Q-2026-302' },
      { item: 'تدريب وتشغيل تجريبي', supplier: 'مورد معدات الأغذية', amount: omr(3_000), quoteReference: 'Q-2026-303' },
    ],
    stage: 'failed',
  },
];

function buildDisclosure(spec: PoolSpec, monthlyRevenue: number) {
  return {
    summary: {
      activityAr: spec.summaryAr,
      useOfFundsAr: spec.useOfFunds.map((u) => `${u.item} — ${u.supplier} — ${(u.amount / 1000).toLocaleString('en-US')} ر.ع (عرض سعر ${u.quoteReference})`).join('؛ '),
      expansionRationaleAr: 'يستند التوسع إلى طلب موثق ببيانات تشغيلية تاريخية، مع ربط الصرف بالموردين مباشرة وفق ميزانية معتمدة ومراحل قابلة للتحقق.',
    },
    financials: {
      historicalRevenue: [
        { period: '2025-Q2', amount: monthlyRevenue * 3 },
        { period: '2025-Q3', amount: Math.round(monthlyRevenue * 3.15) },
        { period: '2025-Q4', amount: Math.round(monthlyRevenue * 3.4) },
        { period: '2026-Q1', amount: Math.round(monthlyRevenue * 3.3) },
      ],
      assumptionsAr: 'تفترض التوقعات استقرار هامش المساهمة الحالي، وبدء التشغيل الكامل خلال أربعة أشهر من الصرف، دون افتراض نمو استثنائي في الأسعار.',
      scenarios: {
        conservative: { annualCashYieldBps: 600, narrativeAr: 'تأخر التشغيل شهرين وانخفاض المبيعات 20% عن الأساس، مع استمرار التكاليف الثابتة.' },
        base: { annualCashYieldBps: 1_100, narrativeAr: 'تشغيل وفق الجدول وأداء مبيعات مقارب لأداء الفروع القائمة.' },
        optimistic: { annualCashYieldBps: 1_500, narrativeAr: 'تشغيل مبكر وأداء أعلى من الفروع القائمة بنسبة 15%، مع ثبات التكاليف.' },
      },
    },
    rights: {
      instrumentAr: `حصص مساهمة في شركة غرض خاص تملك أصول المشروع، بواقع وحدة لكل ${(omr(100) / 1000)} ر.ع.`,
      distributionPolicyAr: 'توزيعات نصف سنوية من النقد المحقق والمعتمد فقط، بعد التكاليف التشغيلية ورسوم المتابعة، ولا توزيع من أرباح محاسبية غير محصلة.',
      votingAr: 'حق تصويت بوزن الوحدات في القرارات الجوهرية المحددة في العقد، مثل بيع الأصل أو تغيير استخدام الأموال.',
      restrictionsAr: 'لا يجوز نقل الحصص إلا وفق العقد وبموافقة مدير الـSPV. لا توجد سوق ثانوية.',
      exitMechanismAr: `الخروج عند نهاية المدة (${spec.tenorMonths} شهرًا) عبر بيع الأصل أو إعادة شراء الحصص من صاحب المشروع بتقييم مستقل، وفق الآلية والجدول الزمني المحددين في العقد.`,
      defaultHandlingAr: 'عند التعثر تُفعّل خطة معالجة موثقة تشمل الإفصاح الفوري، وتقييم الأصل، وحق المستثمرين في التصويت على مسار المعالجة.',
    },
    risks: {
      capitalLossAr: 'قد تخسر كامل المبلغ المستثمر. لا ضمان لرأس المال ولا للعائد، ولا يقدم أي طرف تعويضًا عن خسائر الاستثمار.',
      liquidityAr: 'لا توجد سوق ثانوية ولا إمكانية للاسترداد المبكر. أموالك مرتبطة بالمشروع حتى نهاية المدة أو حدث الخروج.',
      operationalAr: 'قد يتأخر التنفيذ أو ترتفع تكاليف الموردين أو ينخفض الأداء التشغيلي عن التوقعات المنشورة.',
      sectorAr: 'يتأثر القطاع بتذبذب الطلب وتغير سلوك المستهلك والمنافسة الموقعية.',
      conflictsAr: 'صاحب المشروع طرف ذو مصلحة في الشركة الأم؛ تُدار المعاملات مع الأطراف ذات العلاقة بإفصاح مسبق وموافقة.',
      dependenciesAr: 'يعتمد التنفيذ على التراخيص البلدية والموردين المحددين وتوافر العمالة المدربة.',
    },
    fees: {
      assessmentFee: omr(750), successFeeBps: 300, monitoringFeeBps: 100,
      investorFeeNoteAr: 'لا توجد رسوم على المستثمر في المرحلة التجريبية. يتحمل صاحب المشروع رسوم الدراسة والنجاح والمتابعة.',
    },
    evidence: spec.useOfFunds.map((u) => ({ label: `عرض سعر ${u.quoteReference} — ${u.supplier}` })),
  };
}

let applicationSeq = 0;
let poolSeq = 0;
let orderSeq = 0;

const created: Record<string, { poolId: string; applicationId: string }> = {};

for (const spec of SPECS) {
  if (get(`SELECT 1 FROM project_applications WHERE title_ar = ?`, [spec.titleAr])) continue;

  const applicationId = newId();
  const poolId = newId();
  applicationSeq += 1; poolSeq += 1;

  const monthlyRevenue = Math.round(spec.target / 6);
  const contributionBps = Math.round((spec.ownerContribution * 10_000) / (spec.target + spec.ownerContribution));

  tx(() => {
    run(`INSERT INTO project_applications (id, reference, entity_id, owner_user_id, title_ar, sector, governorate,
                                           summary_ar, requested_amount, owner_contribution, tenor_months,
                                           use_of_funds, status, submitted_at, decided_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'published', ?, ?, ?, ?)`,
        [applicationId, makeReference('APP', applicationSeq), spec.entityId, spec.ownerId, spec.titleAr,
         spec.sector, spec.governorate, spec.summaryAr, spec.target, spec.ownerContribution, spec.tenorMonths,
         JSON.stringify(spec.useOfFunds), plus(at, -days(60)), plus(at, -days(40)), plus(at, -days(70)), at]);

    // Financial history covering the required 12 months.
    for (let month = 12; month >= 1; month -= 1) {
      run(`INSERT INTO financial_feeds (id, application_id, source, period_start, period_end, gross_revenue, net_cash, quality, created_at)
           VALUES (?,?, 'pos_api', ?, ?, ?, ?, 'verified', ?)`,
          [newId(), applicationId, plus(at, -days(month * 30)), plus(at, -days((month - 1) * 30)),
           monthlyRevenue + ((month % 3) * Math.round(monthlyRevenue * 0.05)),
           Math.round(monthlyRevenue * 0.18), at]);
    }

    // Due diligence, scoring and committee record.
    const caseId = newId();
    run(`INSERT INTO dd_cases (id, application_id, analyst_id, status, opened_at, closed_at, sla_due_at)
         VALUES (?,?,?, 'decided', ?, ?, ?)`,
        [caseId, applicationId, staff.analyst, plus(at, -days(58)), plus(at, -days(41)), plus(at, -days(45))]);

    for (const item of DD_CHECKLIST) {
      run(`INSERT INTO dd_checklist_items (id, case_id, code, label_ar, mandatory, status, updated_by, updated_at)
           VALUES (?,?,?,?,?, 'satisfied', ?, ?)`,
          [newId(), caseId, item.code, item.labelAr, item.mandatory ? 1 : 0, staff.analyst, plus(at, -days(45))]);
    }

    const risk = scoreRisk({
      monthsTrading: 36, revenueStabilityBps: 7_800, ownerContributionBps: contributionBps,
      dataQuality: 'pos_api', useOfFundsSpecificity: 'itemised_quotes',
      sectorRisk: spec.sector.includes('لوجستيات') ? 'medium' : 'low',
      managementDepth: 'owner_plus', existingLeverageBps: 1_500,
      licensesComplete: true, supplierConcentrationBps: 4_000,
    });
    run(`UPDATE dd_cases SET risk_score = ?, risk_grade = ?, model_version = ?, score_inputs = ? WHERE id = ?`,
        [risk.score, risk.grade, risk.version, JSON.stringify({ seeded: true }), caseId]);

    const sessionId = newId();
    run(`INSERT INTO committee_sessions (id, case_id, quorum, pack_hash, status, decision, decision_reason, conditions, opened_at, decided_at)
         VALUES (?,?,3,?, 'decided', 'approved', ?, ?, ?, ?)`,
        [sessionId, caseId, contentHash({ applicationId, risk }),
         'سجل تشغيلي مثبت، استخدام أموال مفصل بعروض أسعار، ومساهمة صاحب المشروع ضمن السياسة.',
         JSON.stringify(['استلام مساهمة صاحب المشروع قبل النشر', 'توقيع اتفاقية الإدراج والمراقبة']),
         plus(at, -days(42)), plus(at, -days(41))]);
    for (const [member, vote] of [[staff.committee1, 'approve'], [staff.committee2, 'approve'], [staff.committee3, 'conditional']] as const) {
      run(`INSERT INTO committee_votes (id, session_id, member_id, vote, rationale, created_at) VALUES (?,?,?,?,?,?)`,
          [newId(), sessionId, member, vote, 'بيانات تشغيلية كافية ومخاطر ضمن الحدود المقبولة للتجربة.', plus(at, -days(41))]);
    }

    // The pool itself.
    const unitPrice = omr(100);
    const totalUnits = spec.target / unitPrice;
    const closesAt = spec.stage === 'funding' ? plus(at, days(22)) : plus(at, -days(5));

    run(`INSERT INTO pools (id, reference, application_id, entity_id, title_ar, sector, governorate, structure,
                            spv_name, total_units, unit_price, target_amount, min_amount, max_amount, min_ticket,
                            owner_contribution, owner_contribution_received_at, tenor_months, allocation_rule,
                            status, published_at, closes_at, escrow_account_ref, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?, 'spv_equity', ?,?,?,?,?,?,?,?,?,?, 'pro_rata', 'funding', ?, ?, ?, ?, ?, ?)`,
        [poolId, makeReference('POOL', poolSeq), applicationId, spec.entityId, spec.titleAr, spec.sector,
         spec.governorate, `${spec.titleAr.split('—')[0].trim()} — شركة غرض خاص`, totalUnits, unitPrice,
         spec.target, Math.round(spec.target * 0.8), Math.round(spec.target * 1.1), omr(100),
         spec.ownerContribution, plus(at, -days(36)), spec.tenorMonths,
         plus(at, -days(35)), closesAt, `ESCROW-OM-${makeReference('POOL', poolSeq)}`, staff.portfolio,
         plus(at, -days(38)), at]);

    run(`INSERT INTO pool_state_events (id, pool_id, from_state, to_state, reason, payload, actor_id, created_at)
         VALUES (?,?,NULL,'draft','seeded pilot pool','{}',?,?)`, [newId(), poolId, staff.portfolio, plus(at, -days(38))]);
    run(`INSERT INTO pool_state_events (id, pool_id, from_state, to_state, reason, payload, actor_id, created_at)
         VALUES (?,?,'approved','funding','disclosure approved and published','{}',?,?)`,
        [newId(), poolId, staff.portfolio, plus(at, -days(35))]);

    const sections = buildDisclosure(spec, monthlyRevenue);
    run(`INSERT INTO disclosure_versions (id, pool_id, version, sections, content_hash, status, created_by, approved_by, published_at, created_at)
         VALUES (?,?,1,?,?, 'published', ?, ?, ?, ?)`,
        [newId(), poolId, JSON.stringify(sections), contentHash(sections), staff.portfolio, staff.compliance,
         plus(at, -days(35)), plus(at, -days(36))]);
  });

  created[spec.key] = { poolId, applicationId };
}

// ─────────────────────────── commitments and lifecycle states ───────────────────────────

function placeOrder(poolId: string, investorId: string, amount: number, status: 'pending' | 'confirmed', ageDays: number) {
  const disclosure = get<any>(`SELECT id FROM disclosure_versions WHERE pool_id = ? AND status = 'published'`, [poolId]);
  const pool = get<any>(`SELECT unit_price, escrow_account_ref FROM pools WHERE id = ?`, [poolId]);
  const orderId = newId();
  orderSeq += 1;
  const createdAt = plus(at, -days(ageDays));

  run(`INSERT INTO investment_orders (id, reference, pool_id, investor_id, amount, units, status,
                                      disclosure_version_id, acknowledgements, confirmed_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderId, makeReference('ORD', orderSeq), poolId, investorId, amount, Math.floor(amount / pool.unit_price),
       status, disclosure.id,
       JSON.stringify(['capital_loss', 'no_guarantee', 'illiquidity', 'disclosure_read', 'projections']),
       status === 'confirmed' ? createdAt : null, createdAt, createdAt]);

  run(`INSERT INTO payment_references (id, order_id, provider, provider_ref, idempotency_key, direction, amount,
                                       status, escrow_account_ref, created_at, updated_at)
       VALUES (?,?, 'sandbox-licensed-operator', ?, ?, 'collection', ?, ?, ?, ?, ?)`,
      [newId(), orderId, `PR-SEED-${orderSeq.toString().padStart(4, '0')}`, `order-seed-${orderId}`,
       amount, status === 'confirmed' ? 'settled' : 'pending', pool.escrow_account_ref, createdAt, createdAt]);
  return orderId;
}

// Pool 1 — live campaign, partially funded.
if (created.cafe && !get(`SELECT 1 FROM investment_orders WHERE pool_id = ?`, [created.cafe.poolId])) {
  placeOrder(created.cafe.poolId, investors.retail1, omr(1_500), 'confirmed', 20);
  placeOrder(created.cafe.poolId, investors.retail2, omr(2_900), 'confirmed', 18);   // AT-02 fixture: 100 OMR headroom left
  placeOrder(created.cafe.poolId, investors.retail3, omr(800), 'confirmed', 15);
  placeOrder(created.cafe.poolId, investors.angel, omr(12_000), 'confirmed', 12);
  placeOrder(created.cafe.poolId, investors.soph, omr(20_000), 'confirmed', 9);
  placeOrder(created.cafe.poolId, investors.retail1, omr(600), 'pending', 1);
}

// Pool 2 — funded, disbursed and operating, with reports and a distribution.
if (created.logistics && !get(`SELECT 1 FROM holdings WHERE pool_id = ?`, [created.logistics.poolId])) {
  const poolId = created.logistics.poolId;
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [poolId]);

  const allocations: [string, number][] = [
    [investors.soph, omr(40_000)], [investors.angel, omr(25_000)],
    [investors.retail1, omr(3_000)], [investors.retail2, omr(2_500)], [investors.retail3, omr(3_000)],
  ];
  tx(() => {
    for (const [investorId, amount] of allocations) {
      const orderId = placeOrder(poolId, investorId, amount, 'confirmed', 50);
      run(`UPDATE investment_orders SET status = 'allocated', allocated_amount = ? WHERE id = ?`, [amount, orderId]);
      run(`INSERT INTO holdings (id, pool_id, investor_id, units, invested_amount, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(pool_id, investor_id) DO UPDATE SET units = units + excluded.units,
             invested_amount = invested_amount + excluded.invested_amount`,
          [newId(), poolId, investorId, Math.floor(amount / pool.unit_price), amount, plus(at, -days(45)), at]);
    }
    run(`UPDATE pools SET status = 'operating', funded_at = ? WHERE id = ?`, [plus(at, -days(45)), poolId]);
    for (const [from, to, reason, ago] of [
      ['funding', 'funded', 'target reached and reconciled', 45],
      ['funded', 'disbursement', 'first milestone approved', 42],
      ['disbursement', 'operating', 'assets delivered and project operating', 30],
    ] as const) {
      run(`INSERT INTO pool_state_events (id, pool_id, from_state, to_state, reason, payload, actor_id, created_at)
           VALUES (?,?,?,?,?,'{}',?,?)`, [newId(), poolId, from, to, reason, staff.financeChecker, plus(at, -days(ago))]);
    }

    // Milestone disbursements with maker/checker separation.
    for (const [code, label, beneficiary, amount, ago] of [
      ['M1', 'دفعة الشاحنات — 60%', 'الوكيل المعتمد للشاحنات', omr(43_200), 42],
      ['M2', 'دفعة الشاحنات — 40% عند التسليم', 'الوكيل المعتمد للشاحنات', omr(28_800), 34],
      ['M3', 'التأمين وأنظمة التتبع', 'شركة التأمين الوطنية', omr(13_000), 32],
    ] as const) {
      run(`INSERT INTO disbursements (id, pool_id, milestone_code, milestone_label, beneficiary, amount,
                                      condition_text, condition_met, status, created_by, approved_by,
                                      created_at, approved_at, executed_at)
           VALUES (?,?,?,?,?,?,?,1, 'executed', ?, ?, ?, ?, ?)`,
          [newId(), poolId, code, label, beneficiary, amount,
           'يُصرف للمورد مباشرة بعد استلام الفاتورة وإثبات التسليم', staff.financeMaker, staff.financeChecker,
           plus(at, -days(ago + 1)), plus(at, -days(ago)), plus(at, -days(ago))]);
    }

    // Covenants and published reports.
    run(`INSERT INTO covenants (id, pool_id, code, label_ar, metric, operator, threshold, breach_action, created_at)
         VALUES (?,?, 'MIN_UTILISATION', 'نسبة تشغيل الأسطول لا تقل عن 70%', 'fleet_utilisation_pct', 'gte', 70, 'alert', ?)`,
        [newId(), poolId, at]);
    run(`INSERT INTO covenants (id, pool_id, code, label_ar, metric, operator, threshold, breach_action, created_at)
         VALUES (?,?, 'MIN_REVENUE', 'إيراد شهري لا يقل عن 9,000 ر.ع', 'monthly_revenue_omr', 'gte', 9000, 'escalate', ?)`,
        [newId(), poolId, at]);

    for (const [label, ago, utilisation, revenue] of [['2026-05', 90, 74, 9_800], ['2026-06', 60, 78, 10_400], ['2026-07', 30, 81, 11_200]] as const) {
      const reportId = newId();
      const end = plus(at, -days(ago));
      run(`INSERT INTO project_reports (id, pool_id, period_label, period_start, period_end, due_at, kpis, narrative,
                                        status, submitted_by, approved_by, published_at, created_at)
           VALUES (?,?,?,?,?,?,?,?, 'published', ?, ?, ?, ?)`,
          [reportId, poolId, label, plus(end, -days(30)), end, plus(end, days(15)),
           JSON.stringify({
             fleet_utilisation_pct: { actual: utilisation, forecast: 75 },
             monthly_revenue_omr: { actual: revenue, forecast: 10_000 },
             active_contracts: { actual: 3, forecast: 3 },
           }),
           'تشغيل الشاحنات وفق الجدول مع أداء إيرادات قريب من التوقعات وعقود توريد مستقرة.',
           owners.logistics, staff.portfolio, plus(end, days(10)), plus(end, days(5))]);
    }

    // An approved distribution from realised cash (BR-015).
    const distributionId = newId();
    const gross = omr(4_200);
    const fee = Math.round((gross * 100) / 10_000);
    const net = gross - fee;
    run(`INSERT INTO distributions (id, pool_id, period_label, gross_amount, fee_amount, net_amount, status,
                                    created_by, approved_by, created_at, approved_at)
         VALUES (?,?, '2026-H1', ?,?,?, 'approved', ?, ?, ?, ?)`,
        [distributionId, poolId, gross, fee, net, staff.portfolio, staff.financeChecker,
         plus(at, -days(20)), plus(at, -days(18))]);

    const holdings = all<any>(`SELECT investor_id, units FROM holdings WHERE pool_id = ? ORDER BY investor_id`, [poolId]);
    const totalUnits = holdings.reduce((sum, h) => sum + h.units, 0);
    let distributed = 0;
    holdings.forEach((holding, index) => {
      const share = index === holdings.length - 1
        ? net - distributed
        : Math.floor((net * holding.units) / totalUnits);
      distributed += share;
      run(`INSERT INTO distribution_lines (id, distribution_id, investor_id, units, gross_amount, fee_amount, net_amount, status)
           VALUES (?,?,?,?,?,0,?, 'paid')`,
          [newId(), distributionId, holding.investor_id, holding.units, share, share]);
      run(`UPDATE holdings SET distributed_amount = distributed_amount + ? WHERE pool_id = ? AND investor_id = ?`,
          [share, poolId, holding.investor_id]);
    });
  });
}

// Pool 3 — window closed below the minimum: refunds, no disbursement (AT-03).
if (created.bakery && !get(`SELECT 1 FROM refunds WHERE pool_id = ?`, [created.bakery.poolId])) {
  const poolId = created.bakery.poolId;
  tx(() => {
    const orders = [
      placeOrder(poolId, investors.retail1, omr(1_000), 'confirmed', 40),
      placeOrder(poolId, investors.retail3, omr(2_000), 'confirmed', 35),
      placeOrder(poolId, investors.angel, omr(9_000), 'confirmed', 30),
    ];
    run(`UPDATE pools SET status = 'refunding' WHERE id = ?`, [poolId]);
    run(`INSERT INTO pool_state_events (id, pool_id, from_state, to_state, reason, payload, actor_id, created_at)
         VALUES (?,?, 'funding', 'refunding', 'all-or-nothing: minimum not reached at window close', '{}', ?, ?)`,
        [newId(), poolId, staff.financeChecker, plus(at, -days(5))]);

    for (const orderId of orders) {
      const order = get<any>(`SELECT amount FROM investment_orders WHERE id = ?`, [orderId]);
      run(`INSERT INTO refunds (id, pool_id, order_id, amount, reason, status, created_by, created_at)
           VALUES (?,?,?,?, 'all-or-nothing: funding target not reached', 'requested', ?, ?)`,
          [newId(), poolId, orderId, order.amount, staff.financeMaker, plus(at, -days(5))]);
    }
  });
}

// ─────────────────────────── report schedule for the live pool ───────────────────────────

if (created.cafe) {
  const poolId = created.cafe.poolId;
  for (let index = 0; index < 3; index += 1) {
    const start = new Date(at);
    start.setUTCMonth(start.getUTCMonth() + index);
    const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(end.getUTCDate() - 1);
    run(`INSERT INTO project_reports (id, pool_id, period_label, period_start, period_end, due_at, status, created_at)
         VALUES (?,?,?,?,?,?, 'scheduled', ?)
         ON CONFLICT(pool_id, period_label) DO NOTHING`,
        [newId(), poolId, label, start.toISOString(), end.toISOString(), plus(end.toISOString(), days(15)), at]);
  }
}

// ─────────────────────────── summary ───────────────────────────

const summary = {
  users: get<{ n: number }>(`SELECT COUNT(*) AS n FROM users`)!.n,
  entities: get<{ n: number }>(`SELECT COUNT(*) AS n FROM legal_entities`)!.n,
  applications: get<{ n: number }>(`SELECT COUNT(*) AS n FROM project_applications`)!.n,
  pools: all<any>(`SELECT reference, title_ar, status FROM pools`),
  orders: get<{ n: number }>(`SELECT COUNT(*) AS n FROM investment_orders`)!.n,
  holdings: get<{ n: number }>(`SELECT COUNT(*) AS n FROM holdings`)!.n,
  refunds: get<{ n: number }>(`SELECT COUNT(*) AS n FROM refunds`)!.n,
};

console.log('\n✓ حِصّة | Hissa Pools — seeded pilot dataset\n');
console.table(summary.pools);
console.log(`users=${summary.users} entities=${summary.entities} applications=${summary.applications} ` +
            `orders=${summary.orders} holdings=${summary.holdings} refunds=${summary.refunds}`);
console.log(`\nAll seeded accounts use the password: ${PASSWORD}`);
console.log('Investor: investor1@example.om   Owner: owner.cafe@example.om');
console.log('Analyst: analyst@hissa.om   Compliance: compliance@hissa.om');
console.log('Finance (maker): finance.maker@hissa.om   Finance (checker): finance.checker@hissa.om');
console.log('Portfolio: portfolio@hissa.om   Admin: admin@hissa.om\n');
