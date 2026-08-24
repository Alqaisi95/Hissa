/**
 * PRD §15.1 Definition of Done — the end-to-end journey:
 * KYC → investment → reconciliation → close → disbursement / refund,
 * plus the origination path that produces the opportunity in the first place.
 */
import './env.ts';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, partnerWebhook, makeUser, login,
  installNotificationTemplates, ACKS,
} from './helpers.ts';
import { omr } from '../lib/money.ts';
import { all, get, run } from '../db/index.ts';
import { nowIso, plus, days } from '../lib/ids.ts';

let analyst: string, analystToken: string;
let committee: string[], committeeTokens: string[];
let compliance: string, complianceToken: string;
let portfolio: string, portfolioToken: string;
let financeA: string, financeAToken: string;
let financeB: string, financeBToken: string;

const pdf = (text: string) => Buffer.from(text).toString('base64');

before(async () => {
  await startTestServer();
  analyst = makeUser({ fullName: 'محلل', email: 'j.analyst@test.om', roles: ['investment_analyst'] });
  compliance = makeUser({ fullName: 'امتثال', email: 'j.comp@test.om', roles: ['compliance'] });
  portfolio = makeUser({ fullName: 'محفظة', email: 'j.pf@test.om', roles: ['portfolio_ops'] });
  financeA = makeUser({ fullName: 'مالية أ', email: 'j.fa@test.om', roles: ['finance_ops'] });
  financeB = makeUser({ fullName: 'مالية ب', email: 'j.fb@test.om', roles: ['finance_ops'] });
  committee = ['j.c1@test.om', 'j.c2@test.om', 'j.c3@test.om'].map((email, index) =>
    makeUser({ fullName: `عضو لجنة ${index + 1}`, email, roles: ['committee_member'] }));
  installNotificationTemplates(compliance);

  analystToken = await login('j.analyst@test.om');
  complianceToken = await login('j.comp@test.om');
  portfolioToken = await login('j.pf@test.om');
  financeAToken = await login('j.fa@test.om');
  financeBToken = await login('j.fb@test.om');
  committeeTokens = [];
  for (const email of ['j.c1@test.om', 'j.c2@test.om', 'j.c3@test.om']) committeeTokens.push(await login(email));
});

after(async () => { await stopTestServer(); });

describe('investor onboarding — FR-001 … FR-006', () => {
  test('registration, OTP, consents, suitability and KYC gate investment in order', async () => {
    const registered = await api('POST', '/api/identity/register', {
      body: { fullName: 'مستثمر جديد', email: 'newbie@test.om', password: 'StrongPass#2026', locale: 'ar' },
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.status, 'pending_verification');

    // FR-001 — no sign-in before a channel is verified.
    const early = await api('POST', '/api/identity/login', {
      body: { identifier: 'newbie@test.om', password: 'StrongPass#2026' },
    });
    assert.equal(early.status, 403);

    const verified = await api('POST', '/api/identity/otp/verify', {
      body: { userId: registered.body.userId, code: registered.body.devOtp },
    });
    assert.equal(verified.body.verified, true);

    const session = await api('POST', '/api/identity/login', {
      body: { identifier: 'newbie@test.om', password: 'StrongPass#2026' },
    });
    assert.equal(session.status, 200);
    assert.equal(session.body.mfaRequired, false, 'MFA is required for staff roles, not retail investors');
    const token = session.body.token;

    const outstanding = await api('GET', '/api/identity/me', { token });
    assert.deepEqual(outstanding.body.outstanding.sort(), ['consents', 'kyc', 'suitability']);

    for (const key of ['terms', 'risk_disclosure', 'privacy']) {
      const accepted = await api('POST', '/api/identity/consents', { token, body: { documentKey: key, version: '1.0' } });
      assert.equal(accepted.status, 201);
    }
    // FR-006 — the consent stores the exact version and a hash of the text shown.
    const consent = get<any>(`SELECT * FROM consents WHERE user_id = ? AND document_key = 'terms'`,
                             [registered.body.userId]);
    assert.equal(consent.version, '1.0');
    assert.ok(consent.content_hash.length === 64);

    const suitability = await api('POST', '/api/identity/suitability', {
      token, body: { answers: { capital_loss: 'full_loss', liquidity: 'no_secondary',
                                diversification: 'small', returns: 'projection' } },
    });
    assert.equal(suitability.body.result, 'pass');

    const kyc = await api('POST', '/api/identity/kyc/start', {
      token, body: { fullName: 'مستثمر جديد', idReference: '12345678' },
    });
    assert.equal(kyc.body.status, 'approved');

    const ready = await api('GET', '/api/identity/me', { token });
    assert.deepEqual(ready.body.outstanding, [], 'every gate is now cleared');
  });

  test('a sanctions hit blocks investment and opens a critical compliance case', async () => {
    const registered = await api('POST', '/api/identity/register', {
      body: { fullName: 'Sanctioned Person', email: 'flagged@test.om', password: 'StrongPass#2026' },
    });
    await api('POST', '/api/identity/otp/verify', {
      body: { userId: registered.body.userId, code: registered.body.devOtp },
    });
    const token = (await api('POST', '/api/identity/login', {
      body: { identifier: 'flagged@test.om', password: 'StrongPass#2026' } })).body.token;

    const kyc = await api('POST', '/api/identity/kyc/start', {
      token, body: { fullName: 'Sanctioned Person', idReference: '99912345' },
    });
    assert.equal(kyc.body.status, 'rejected');
    // §11 — the reason returned to the user reveals nothing.
    assert.ok(!JSON.stringify(kyc.body).toLowerCase().includes('sanction'));

    const raised = get<any>(`SELECT * FROM cases WHERE type = 'kyc_review' AND severity = 'critical'`);
    assert.ok(raised, 'compliance receives a critical case');
  });

  test('a restricted suitability result blocks investment', async () => {
    const registered = await api('POST', '/api/identity/register', {
      body: { fullName: 'غير مدرك للمخاطر', email: 'unsuitable@test.om', password: 'StrongPass#2026' },
    });
    await api('POST', '/api/identity/otp/verify', {
      body: { userId: registered.body.userId, code: registered.body.devOtp } });
    const token = (await api('POST', '/api/identity/login', {
      body: { identifier: 'unsuitable@test.om', password: 'StrongPass#2026' } })).body.token;

    const suitability = await api('POST', '/api/identity/suitability', {
      token, body: { answers: { capital_loss: 'protected', liquidity: 'anytime',
                                diversification: 'all', returns: 'guaranteed' } },
    });
    assert.equal(suitability.body.result, 'restricted');
    assert.ok(suitability.body.messageAr.includes('مراجعة المخاطر'));
  });
});

describe('origination → committee → pool → funding → disbursement', () => {
  test('the complete lifecycle holds every gate in order', async () => {
    // ── 1. The project owner registers the company and applies (FR-004, FR-101).
    const registered = await api('POST', '/api/identity/register', {
      body: { fullName: 'صاحب مشروع', email: 'j.owner@test.om', password: 'StrongPass#2026', accountType: 'project_owner' },
    });
    await api('POST', '/api/identity/otp/verify', {
      body: { userId: registered.body.userId, code: registered.body.devOtp } });
    const ownerToken = (await api('POST', '/api/identity/login', {
      body: { identifier: 'j.owner@test.om', password: 'StrongPass#2026' } })).body.token;

    const entity = await api('POST', '/api/identity/entities', {
      token: ownerToken,
      body: { legalName: 'مؤسسة الرحلة الكاملة', crNumber: '5551234', activity: 'تجزئة',
              incorporatedOn: '2021-01-10', governorate: 'مسقط',
              people: [{ fullName: 'مالك مستفيد', role: 'ubo', ownershipBp: 10_000, idReference: '11112222' }] },
    });
    assert.equal(entity.status, 201);
    assert.equal(entity.body.kybStatus, 'approved');

    const application = await api('POST', '/api/origination/applications', {
      token: ownerToken,
      body: { entityId: entity.body.entityId, titleAr: 'فرع جديد للرحلة الكاملة', sector: 'تجزئة',
              summaryAr: 'ن'.repeat(60), requestedAmount: omr(60_000), ownerContribution: omr(20_000),
              tenorMonths: 36,
              useOfFunds: [{ item: 'تجهيزات', supplier: 'مورد أ', amount: omr(40_000), quoteReference: 'Q-1' },
                           { item: 'معدات', supplier: 'مورد ب', amount: omr(20_000), quoteReference: 'Q-2' }] },
    });
    assert.equal(application.status, 201);
    const applicationId = application.body.applicationId;

    // FR-101 — an incomplete application cannot be submitted.
    const premature = await api('POST', `/api/origination/applications/${applicationId}/submit`, { token: ownerToken });
    assert.equal(premature.status, 422);
    assert.ok(premature.body.error.details.missing.length > 0);

    for (const category of ['cr_certificate', 'bank_statement', 'quotes']) {
      const uploaded = await api('POST', `/api/origination/applications/${applicationId}/documents`, {
        token: ownerToken,
        body: { category, fileName: `${category}.pdf`, mimeType: 'application/pdf', contentBase64: pdf(category) },
      });
      assert.equal(uploaded.status, 201);
    }
    // FR-103 — twelve months of verifiable financial history.
    for (let month = 12; month >= 1; month -= 1) {
      await api('POST', `/api/origination/applications/${applicationId}/feeds`, {
        token: ownerToken,
        body: { source: 'pos_api', periodStart: plus(nowIso(), -days(month * 30)),
                periodEnd: plus(nowIso(), -days((month - 1) * 30)), grossRevenue: omr(11_000) },
      });
    }

    const submitted = await api('POST', `/api/origination/applications/${applicationId}/submit`, { token: ownerToken });
    assert.equal(submitted.status, 200);
    const caseId = submitted.body.caseId;

    // ── 2. Due diligence (FR-104 … FR-106).
    await api('POST', `/api/origination/cases/${caseId}/assign`, {
      token: analystToken, body: { analystId: analyst } });

    const request = await api('POST', `/api/origination/cases/${caseId}/requests`, {
      token: analystToken, body: { bodyAr: 'يرجى تزويدنا بعقد إيجار الموقع الجديد وصورة الترخيص البلدي.' } });
    assert.equal(request.status, 201);

    const beforeAnswer = await api('POST', `/api/origination/cases/${caseId}/to-committee`, { token: analystToken });
    assert.equal(beforeAnswer.status, 422, 'open information requests block promotion');

    const answered = await api('POST', `/api/origination/requests/${request.body.requestId}/answer`, {
      token: ownerToken, body: { answer: 'العقد والترخيص مرفقان في المستندات.' } });
    assert.equal(answered.status, 200);

    const checklist = all<any>(`SELECT id FROM dd_checklist_items WHERE case_id = ? AND mandatory = 1`, [caseId]);
    for (const item of checklist) {
      await api('PATCH', `/api/origination/cases/${caseId}/checklist/${item.id}`, {
        token: analystToken, body: { status: 'satisfied', note: 'تم التحقق من المستند' } });
    }

    const unscored = await api('POST', `/api/origination/cases/${caseId}/to-committee`, { token: analystToken });
    assert.equal(unscored.status, 422, 'FR-106: no committee without a risk score');

    const scored = await api('POST', `/api/origination/cases/${caseId}/score`, {
      token: analystToken,
      body: { monthsTrading: 40, revenueStabilityBps: 8_200, ownerContributionBps: 2_500, dataQuality: 'pos_api',
              useOfFundsSpecificity: 'itemised_quotes', sectorRisk: 'low', managementDepth: 'owner_plus',
              existingLeverageBps: 1_200, licensesComplete: true, supplierConcentrationBps: 3_500 },
    });
    assert.ok(scored.body.score > 70);

    const promoted = await api('POST', `/api/origination/cases/${caseId}/to-committee`, { token: analystToken });
    assert.equal(promoted.status, 200);
    const sessionId = promoted.body.sessionId;
    assert.ok(promoted.body.packHash, 'the committee pack is hashed for integrity');

    // ── 3. Committee (FR-107, FR-108, BR-016).
    const earlyDecision = await api('POST', `/api/origination/committee/sessions/${sessionId}/decide`, {
      token: committeeTokens[0],
      body: { decision: 'approved', reason: 'قرار مبكر قبل النصاب', conditions: [], applicantMessage: 'مقبول' } });
    assert.equal(earlyDecision.status, 422, 'quorum is enforced');

    // BR-016 — a declared conflict forces recusal regardless of the vote cast.
    const conflicted = await api('POST', `/api/origination/committee/sessions/${sessionId}/vote`, {
      token: committeeTokens[2],
      body: { vote: 'approve', rationale: 'أعرف صاحب المشروع شخصيًا وأفصح عن ذلك.', conflictDeclared: true } });
    assert.equal(conflicted.body.vote, 'recused');

    for (const index of [0, 1]) {
      await api('POST', `/api/origination/committee/sessions/${sessionId}/vote`, {
        token: committeeTokens[index],
        body: { vote: 'approve', rationale: 'السجل التشغيلي والبيانات كافية والمخاطر ضمن الحدود.' } });
    }
    const stillShort = await api('POST', `/api/origination/committee/sessions/${sessionId}/decide`, {
      token: committeeTokens[0],
      body: { decision: 'approved', reason: 'قرار قبل اكتمال النصاب', conditions: [], applicantMessage: 'مقبول' } });
    assert.equal(stillShort.status, 422, 'a recused member does not count toward quorum');

    // A fourth member restores the quorum.
    const fourth = makeUser({ fullName: 'عضو لجنة ٤', email: 'j.c4@test.om', roles: ['committee_member'] });
    const fourthToken = await login('j.c4@test.om');
    await api('POST', `/api/origination/committee/sessions/${sessionId}/vote`, {
      token: fourthToken, body: { vote: 'approve', rationale: 'أوافق على التوصية بعد مراجعة الحزمة.' } });

    const decided = await api('POST', `/api/origination/committee/sessions/${sessionId}/decide`, {
      token: committeeTokens[0],
      body: { decision: 'approved', reason: 'استيفاء معايير القبول ومخاطر مقبولة للتجربة.',
              conditions: ['استلام مساهمة صاحب المشروع قبل النشر'],
              applicantMessage: 'تمت الموافقة على مشروعك مع شروط سابقة للنشر.' } });
    assert.equal(decided.status, 200);
    assert.equal(decided.body.tally.recused, 1);
    assert.equal(decided.body.tally.approve, 3);

    // FR-108 — the applicant is told the outcome, never the internal rationale.
    const message = get<any>(
      `SELECT body FROM notifications WHERE user_id = ? AND template_code = 'application_approved'`,
      [registered.body.userId]);
    assert.ok(message.body.includes('تمت الموافقة على مشروعك'));
    assert.ok(!message.body.includes('استيفاء معايير القبول'), 'the internal reason is not disclosed');

    // ── 4. Pool construction and publication (FR-201 … FR-204).
    const undersizedPool = await api('POST', '/api/pools', {
      token: portfolioToken,
      body: { applicationId, titleAr: 'فرصة صغيرة جدًا', totalUnits: 100, unitPrice: omr(100),
              targetAmount: omr(10_000), minAmount: omr(8_000), ownerContribution: omr(5_000), tenorMonths: 36 },
    });
    assert.equal(undersizedPool.status, 422, 'BR-010: pool size must sit inside the pilot band');

    const mismatchedUnits = await api('POST', '/api/pools', {
      token: portfolioToken,
      body: { applicationId, titleAr: 'وحدات غير متطابقة', totalUnits: 500, unitPrice: omr(100),
              targetAmount: omr(60_000), minAmount: omr(50_000), ownerContribution: omr(20_000), tenorMonths: 36 },
    });
    assert.equal(mismatchedUnits.status, 422, 'FR-204: units × price must equal the target');

    const thinContribution = await api('POST', '/api/pools', {
      token: portfolioToken,
      body: { applicationId, titleAr: 'مساهمة ضعيفة', totalUnits: 600, unitPrice: omr(100),
              targetAmount: omr(60_000), minAmount: omr(50_000), ownerContribution: omr(2_000), tenorMonths: 36 },
    });
    assert.equal(thinContribution.status, 422, 'BR-011: owner contribution must meet the policy floor');

    const pool = await api('POST', '/api/pools', {
      token: portfolioToken,
      body: { applicationId, titleAr: 'فرع جديد للرحلة الكاملة — الخوض', totalUnits: 600, unitPrice: omr(100),
              targetAmount: omr(60_000), minAmount: omr(48_000), maxAmount: omr(66_000),
              ownerContribution: omr(20_000), tenorMonths: 36, campaignDays: 45 },
    });
    assert.equal(pool.status, 201);
    const poolId = pool.body.poolId;

    const sections = buildSections();

    // BR-013 — guarantee wording is refused outright.
    const guaranteed = await api('POST', `/api/pools/${poolId}/disclosures`, {
      token: portfolioToken,
      body: { sections: { ...sections, risks: { ...sections.risks, capitalLossAr: 'رأس المال مضمون بالكامل ولا توجد مخاطر.' } } },
    });
    assert.equal(guaranteed.status, 422);
    assert.equal(guaranteed.body.error.code, 'banned_terms');

    // Scenario ordering keeps the conservative case honest.
    const invertedScenarios = await api('POST', `/api/pools/${poolId}/disclosures`, {
      token: portfolioToken,
      body: { sections: { ...sections, financials: { ...sections.financials, scenarios: {
        conservative: { annualCashYieldBps: 2_000, narrativeAr: 'ن'.repeat(15) },
        base: { annualCashYieldBps: 900, narrativeAr: 'ن'.repeat(15) },
        optimistic: { annualCashYieldBps: 1_200, narrativeAr: 'ن'.repeat(15) } } } } },
    });
    assert.equal(invertedScenarios.status, 422);

    const disclosure = await api('POST', `/api/pools/${poolId}/disclosures`, {
      token: portfolioToken, body: { sections } });
    assert.equal(disclosure.status, 201);

    // "Owner First" — no public money before the owner's contribution lands.
    const prematurePublish = await api('POST', `/api/pools/${poolId}/publish`, {
      token: portfolioToken,
      body: { disclosureId: disclosure.body.disclosureId, escrowAccountRef: 'ESCROW-J-1', reason: 'نشر الفرصة للتمويل' },
    });
    assert.equal(prematurePublish.status, 422);
    assert.equal(prematurePublish.body.error.code, 'owner_contribution_pending');

    await api('POST', `/api/pools/${poolId}/owner-contribution`, {
      token: financeAToken, body: { reference: 'OWNER-DEP-001' } });

    const published = await api('POST', `/api/pools/${poolId}/publish`, {
      token: portfolioToken,
      body: { disclosureId: disclosure.body.disclosureId, escrowAccountRef: 'ESCROW-J-1', reason: 'نشر الفرصة للتمويل' },
    });
    assert.equal(published.status, 200);
    assert.equal(published.body.status, 'funding');

    // FR-205 — the pool is now publicly listed.
    const marketplace = await api('GET', '/api/pools?status=funding');
    assert.ok(marketplace.body.items.some((p: any) => p.id === poolId));

    // ── 5. Investment (FR-301 … FR-306).
    const investorIds: string[] = [];
    const investorTokens: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const email = `j.inv${index}@test.om`;
      investorIds.push(makeUser({ fullName: `مستثمر ${index}`, email, roles: ['investor'],
                                  investor: { classification: 'sophisticated' } }));
      investorTokens.push(await login(email));
    }

    const quote = await api('POST', '/api/orders/quote', {
      token: investorTokens[0], body: { poolId, amount: omr(25_000) } });
    assert.equal(quote.body.units, 250);
    assert.equal(quote.body.total, omr(25_000), 'no hidden investor fee');

    // FR-303 — partial acknowledgement is refused.
    const partial = await api('POST', '/api/orders', {
      token: investorTokens[0],
      body: { poolId, amount: omr(25_000), disclosureVersionId: disclosure.body.disclosureId,
              acknowledgements: ['capital_loss'] } });
    assert.equal(partial.status, 400);

    // Deliberately oversubscribe: 25k + 25k + 25k against a 66k ceiling.
    const orders: string[] = [];
    for (const token of investorTokens) {
      const created = await api('POST', '/api/orders', {
        token, body: { poolId, amount: omr(25_000), disclosureVersionId: disclosure.body.disclosureId,
                       acknowledgements: ACKS } });
      if (created.status === 201) {
        orders.push(created.body.orderId);
        await partnerWebhook({ id: `evt-j-${created.body.orderId}`, type: 'payment.settled',
                               providerRef: created.body.payment.providerRef, amount: omr(25_000) });
      }
    }
    assert.equal(orders.length, 2, 'the ceiling stops the third full commitment');

    const remaining = await api('GET', `/api/orders/eligibility/${poolId}`, { token: investorTokens[2] });
    assert.equal(remaining.body.availableAmount, omr(16_000), 'the headroom is exactly the ceiling remainder');

    const topUp = await api('POST', '/api/orders', {
      token: investorTokens[2],
      body: { poolId, amount: omr(16_000), disclosureVersionId: disclosure.body.disclosureId, acknowledgements: ACKS } });
    assert.equal(topUp.status, 201);
    await partnerWebhook({ id: `evt-j-topup`, type: 'payment.settled',
                           providerRef: topUp.body.payment.providerRef, amount: omr(16_000) });

    // ── 6. Reconciliation before closing (FR-402).
    const references = all<any>(
      `SELECT pr.provider_ref, pr.amount FROM payment_references pr
         JOIN investment_orders o ON o.id = pr.order_id WHERE o.pool_id = ?`, [poolId]);
    const reconciliation = await api('POST', '/api/funds/reconciliation/run', {
      token: financeAToken,
      body: { scope: 'journey', externalLines: references.map((r: any) => ({ providerRef: r.provider_ref, amount: r.amount, status: 'settled' })) },
    });
    assert.equal(reconciliation.body.breaks.length, 0, 'internal and external records agree');

    const withBreak = await api('POST', '/api/funds/reconciliation/run', {
      token: financeAToken,
      body: { scope: 'journey-break',
              externalLines: [...references.map((r: any) => ({ providerRef: r.provider_ref, amount: r.amount, status: 'settled' })),
                              { providerRef: 'PR-GHOST', amount: omr(999), status: 'settled' }] },
    });
    assert.equal(withBreak.body.breaks.length, 1);
    assert.equal(withBreak.body.breaks[0].type, 'missing_internal');

    const breakQueue = await api('GET', '/api/funds/reconciliation/breaks', { token: financeAToken });
    assert.equal(breakQueue.body.items.length, 1, 'the difference sits in a queue, not auto-closed');

    // ── 7. Close with allocation (FR-403, FR-306).
    const closed = await api('POST', `/api/funds/pools/${poolId}/close`, {
      token: financeBToken, body: { reason: 'تحقق الهدف وتمت المطابقة — إغلاق معتمد' } });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.outcome, 'funded');
    assert.equal(closed.body.allocatedTotal, omr(66_000), 'allocation ties exactly to the ceiling');
    assert.equal(closed.body.allocatedTotal + closed.body.refundTotal, closed.body.confirmedTotal);

    const holdings = all<any>(`SELECT * FROM holdings WHERE pool_id = ?`, [poolId]);
    assert.equal(holdings.length, 3);
    assert.equal(holdings.reduce((sum: number, h: any) => sum + h.invested_amount, 0), omr(66_000));

    // ── 8. Milestone disbursement under dual control (FR-404, FR-405).
    const overspend = await api('POST', `/api/funds/pools/${poolId}/disbursements`, {
      token: financeAToken,
      body: { milestoneCode: 'M0', milestoneLabel: 'صرف يتجاوز المحصل', beneficiary: 'مورد',
              amount: omr(200_000), conditionText: 'شرط اختباري لتجاوز المبلغ المحصل' } });
    assert.equal(overspend.status, 422, 'a pool cannot disburse more than it raised');

    const milestone = await api('POST', `/api/funds/pools/${poolId}/disbursements`, {
      token: financeAToken,
      body: { milestoneCode: 'M1', milestoneLabel: 'دفعة التجهيزات', beneficiary: 'مورد أ',
              amount: omr(40_000), conditionText: 'تُصرف بعد استلام الفاتورة وإثبات التوريد' } });
    assert.equal(milestone.status, 201);

    await api('POST', `/api/funds/disbursements/${milestone.body.disbursementId}/evidence`, {
      token: financeAToken,
      body: { fileName: 'invoice.pdf', mimeType: 'application/pdf', contentBase64: pdf('invoice'), conditionMet: true } });

    const selfApproved = await api('POST', `/api/funds/disbursements/${milestone.body.disbursementId}/approve`, {
      token: financeAToken, body: { reason: 'اعتماد ذاتي' } });
    assert.equal(selfApproved.status, 409);

    const approved = await api('POST', `/api/funds/disbursements/${milestone.body.disbursementId}/approve`, {
      token: financeBToken, body: { reason: 'تم التحقق من الفاتورة وإثبات التوريد' } });
    assert.equal(approved.status, 200);

    const state = get<any>(`SELECT status FROM pools WHERE id = ?`, [poolId]);
    assert.equal(state.status, 'disbursement');

    // ── 9. Operating, reporting and distribution (FR-501 … FR-503, FR-407, BR-015).
    run(`UPDATE pools SET status = 'operating' WHERE id = ?`, [poolId]);
    run(`INSERT INTO pool_state_events (id, pool_id, from_state, to_state, reason, payload, actor_id, created_at)
         VALUES (lower(hex(randomblob(16))), ?, 'disbursement', 'operating', 'assets delivered', '{}', ?, ?)`,
        [poolId, portfolio, nowIso()]);

    const schedule = await api('POST', `/api/portfolio/pools/${poolId}/report-schedule`, {
      token: portfolioToken, body: { frequency: 'monthly', startDate: plus(nowIso(), -days(60)), periods: 2 } });
    assert.equal(schedule.status, 201);

    const report = get<any>(`SELECT * FROM project_reports WHERE pool_id = ? ORDER BY period_end LIMIT 1`, [poolId]);
    const submitted2 = await api('POST', `/api/portfolio/reports/${report.id}/submit`, {
      token: ownerToken,
      body: { kpis: { monthly_revenue_omr: { actual: 11_500, forecast: 12_000 } },
              narrative: 'بدأ الفرع التشغيل وفق الجدول مع مبيعات قريبة من التوقعات.',
              evidence: { fileName: 'kpi.pdf', mimeType: 'application/pdf', contentBase64: pdf('kpi') } } });
    assert.equal(submitted2.status, 200);
    assert.equal(submitted2.body.variances[0].deviationBps, -417);

    const published2 = await api('POST', `/api/portfolio/reports/${report.id}/publish`, {
      token: portfolioToken, body: { reason: 'روجعت الأدلة واعتُمد التقرير للنشر' } });
    assert.equal(published2.status, 200);

    // BR-015 — a distribution needs realised-cash evidence and a second approver.
    const distribution = await api('POST', `/api/funds/pools/${poolId}/distributions`, {
      token: portfolioToken,
      body: { periodLabel: '2026-H2', grossAmount: omr(3_300),
              cashEvidence: { fileName: 'bank.pdf', mimeType: 'application/pdf', contentBase64: pdf('bank') } } });
    assert.equal(distribution.status, 201);
    assert.equal(distribution.body.balanced, true, 'FR-407: shares plus fees equal the approved amount');

    const distApproved = await api('POST', `/api/funds/distributions/${distribution.body.distributionId}/approve`, {
      token: financeBToken, body: { reason: 'روجع دليل النقد المحقق وجدول التوزيع' } });
    assert.equal(distApproved.status, 200);

    // ── 10. The investor sees a coherent portfolio and statement (FR-505, FR-408).
    const portfolioView = await api('GET', '/api/portfolio', { token: investorTokens[0] });
    assert.equal(portfolioView.body.holdings.length, 1);
    assert.ok(portfolioView.body.summary.distributedAmount > 0);
    assert.ok(portfolioView.body.summary.valuationNoteAr.includes('لا تقدم المنصة قيمة سوقية'));

    const statement = await api('GET', '/api/portfolio/statement', { token: investorTokens[0] });
    assert.equal(statement.status, 200);
    assert.ok(statement.body.statement.distributions.length > 0);

    // ── 11. The pool cannot be closed while money movements are outstanding (FR-509).
    const prematureClose = await api('POST', `/api/portfolio/pools/${poolId}/close`, {
      token: portfolioToken,
      body: { reason: 'محاولة إغلاق قبل تسوية الحركات المالية', finalSettlementNote: 'تسوية نهائية' } });
    assert.equal(prematureClose.status, 422);
    assert.equal(prematureClose.body.error.code, 'pending_money_movements');
  });
});

function buildSections() {
  const fill = (n: number) => 'ن'.repeat(n);
  return {
    summary: { activityAr: fill(30), useOfFundsAr: fill(30), expansionRationaleAr: fill(30) },
    financials: {
      historicalRevenue: [{ period: '2025-Q2', amount: omr(33_000) }, { period: '2025-Q3', amount: omr(34_500) },
                          { period: '2025-Q4', amount: omr(36_000) }, { period: '2026-Q1', amount: omr(35_000) }],
      assumptionsAr: fill(30),
      scenarios: {
        conservative: { annualCashYieldBps: 600, narrativeAr: fill(20) },
        base: { annualCashYieldBps: 1_100, narrativeAr: fill(20) },
        optimistic: { annualCashYieldBps: 1_500, narrativeAr: fill(20) },
      },
    },
    rights: { instrumentAr: fill(20), distributionPolicyAr: fill(20), votingAr: fill(10),
              restrictionsAr: fill(10), exitMechanismAr: fill(30), defaultHandlingAr: fill(20) },
    risks: { capitalLossAr: fill(30), liquidityAr: fill(30), operationalAr: fill(30),
             sectorAr: fill(15), conflictsAr: fill(15), dependenciesAr: fill(15) },
    fees: { assessmentFee: omr(750), successFeeBps: 300, monitoringFeeBps: 100,
            investorFeeNoteAr: 'لا توجد رسوم على المستثمر في المرحلة التجريبية.' },
    evidence: [],
  };
}
