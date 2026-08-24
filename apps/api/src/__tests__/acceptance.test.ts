/**
 * PRD §15 — acceptance criteria AT-01 … AT-12, executed against the live API.
 * Each test names the criterion it proves.
 */
import './env.ts';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startTestServer, stopTestServer, api, partnerWebhook, makeUser, login, makePool,
  investAndConfirm, installNotificationTemplates, ACKS,
} from './helpers.ts';
import { omr, toOmrString } from '../lib/money.ts';
import { get, all } from '../db/index.ts';
import { nowIso, plus, days } from '../lib/ids.ts';
import { run } from '../db/index.ts';

let investor: string, investorToken: string;
let compliance: string, complianceToken: string;
let financeMaker: string, financeMakerToken: string;
let financeChecker: string, financeCheckerToken: string;
let portfolio: string, portfolioToken: string;
let owner: string;

before(async () => {
  await startTestServer();
  investor = makeUser({ fullName: 'مستثمر اختبار', email: 'inv@test.om', roles: ['investor'], investor: {} });
  compliance = makeUser({ fullName: 'امتثال', email: 'comp@test.om', roles: ['compliance'] });
  financeMaker = makeUser({ fullName: 'مالية منشئ', email: 'fm@test.om', roles: ['finance_ops'] });
  financeChecker = makeUser({ fullName: 'مالية معتمد', email: 'fc@test.om', roles: ['finance_ops'] });
  portfolio = makeUser({ fullName: 'محفظة', email: 'pf@test.om', roles: ['portfolio_ops'] });
  owner = makeUser({ fullName: 'صاحب مشروع', email: 'own@test.om', roles: ['project_owner'] });
  installNotificationTemplates(compliance);

  investorToken = await login('inv@test.om');
  complianceToken = await login('comp@test.om');
  financeMakerToken = await login('fm@test.om');
  financeCheckerToken = await login('fc@test.om');
  portfolioToken = await login('pf@test.om');
});

after(async () => { await stopTestServer(); });

describe('AT-01 — KYC-approved investor within limits commits successfully', () => {
  test('order moves pending → confirmed, with a receipt and an audit trail', async () => {
    const pool = makePool({ createdBy: portfolio, ownerUserId: owner });

    const created = await api('POST', '/api/orders', {
      token: investorToken,
      body: { poolId: pool.poolId, amount: omr(500), disclosureVersionId: pool.disclosureId, acknowledgements: ACKS },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'pending');
    // FR-302 — the total handed to the partner matches the amount quoted.
    assert.equal(created.body.totalSentToPartner, omr(500));

    const settled = await partnerWebhook({
      id: `evt-at01`, type: 'payment.settled', providerRef: created.body.payment.providerRef, amount: omr(500),
    });
    assert.equal(settled.body.applied, true);

    const order = await api('GET', `/api/orders/${created.body.orderId}`, { token: investorToken });
    assert.equal(order.body.order.status, 'confirmed');

    const receipt = await api('GET', `/api/orders/${created.body.orderId}/receipt`, { token: investorToken });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.body.receipt.amount, omr(500));
    assert.ok(receipt.body.receipt.disclosureHash, 'receipt binds to the disclosure hash');

    const audit = all(`SELECT * FROM audit_events WHERE entity_id = ? AND action = 'order.confirmed'`,
                      [created.body.orderId]);
    assert.equal(audit.length, 1, 'confirmation is audited');
  });
});

describe('AT-02 — retail per-issuer cap blocks the excess and shows what is available', () => {
  test('after OMR 2,900 with one issuer, a 200 request is blocked showing 100 available', async () => {
    const capped = makeUser({ fullName: 'مستثمر محدود', email: 'cap@test.om', roles: ['investor'], investor: {} });
    const token = await login('cap@test.om');
    const pool = makePool({ createdBy: portfolio, ownerUserId: owner, crNumber: 'CAP-1' });

    await investAndConfirm(token, pool.poolId, pool.disclosureId, omr(2_900));

    const eligibility = await api('GET', `/api/orders/eligibility/${pool.poolId}`, { token });
    assert.equal(eligibility.body.availableAmount, omr(100), 'BR-003 leaves exactly OMR 100 of headroom');

    const blocked = await api('POST', '/api/orders', {
      token, body: { poolId: pool.poolId, amount: omr(200), disclosureVersionId: pool.disclosureId, acknowledgements: ACKS },
    });
    assert.equal(blocked.status, 422);
    assert.equal(blocked.body.error.code, 'above_available');
    assert.equal(blocked.body.error.details.availableAmount, omr(100));
    // FR-301 — the response never leaks the internal cap itself.
    assert.ok(!JSON.stringify(blocked.body).includes('perIssuerCap'));

    // A second issuer is unaffected by the per-issuer cap.
    const otherPool = makePool({ createdBy: portfolio, ownerUserId: owner, crNumber: 'CAP-2' });
    const second = await api('GET', `/api/orders/eligibility/${otherPool.poolId}`, { token });
    assert.ok(second.body.availableAmount > omr(100), 'the cap is per issuer, not global');
  });

  test('BR-004 — the rolling 12-month cap limits total exposure across issuers', async () => {
    const heavy = makeUser({ fullName: 'مستثمر متكرر', email: 'roll@test.om', roles: ['investor'], investor: {} });
    const token = await login('roll@test.om');

    // Seven issuers × OMR 2,900 = 20,300 > the OMR 20,000 rolling cap.
    let committed = 0;
    for (let index = 0; index < 7; index += 1) {
      const pool = makePool({ createdBy: portfolio, ownerUserId: owner, crNumber: `ROLL-${index}` });
      const verdict = await api('GET', `/api/orders/eligibility/${pool.poolId}`, { token });
      const amount = Math.min(omr(2_900), verdict.body.availableAmount);
      if (amount < omr(100)) break;
      await investAndConfirm(token, pool.poolId, pool.disclosureId, amount);
      committed += amount;
    }
    assert.equal(committed, omr(20_000), 'rolling exposure stops exactly at the published cap');

    const final = makePool({ createdBy: portfolio, ownerUserId: owner, crNumber: 'ROLL-LAST' });
    const verdict = await api('GET', `/api/orders/eligibility/${final.poolId}`, { token });
    assert.equal(verdict.body.availableAmount, 0);
    assert.equal(verdict.body.eligible, false);
  });
});

describe('AT-03 — a pool that misses its target refunds and never disburses', () => {
  test('closing below the minimum creates refunds for every confirmed commitment', async () => {
    const pool = makePool({
      createdBy: portfolio, ownerUserId: owner,
      target: omr(50_000), minAmount: omr(40_000), crNumber: 'FAIL-1',
    });
    await investAndConfirm(investorToken, pool.poolId, pool.disclosureId, omr(2_000));

    const result = await api('POST', `/api/funds/pools/${pool.poolId}/close`, {
      token: financeCheckerToken, body: { reason: 'funding window ended below the minimum' },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.outcome, 'refunding');
    assert.equal(result.body.refundOrders, 1);
    assert.equal(result.body.refundTotal, omr(2_000));

    const refunds = all(`SELECT * FROM refunds WHERE pool_id = ?`, [pool.poolId]);
    assert.equal(refunds.length, 1);

    const disbursements = all(`SELECT * FROM disbursements WHERE pool_id = ?`, [pool.poolId]);
    assert.equal(disbursements.length, 0, 'no disbursement on a failed close');

    const status = get<any>(`SELECT status FROM pools WHERE id = ?`, [pool.poolId]);
    assert.equal(status.status, 'refunding');
  });
});

describe('AT-04 — a material change issues a new disclosure version and notifies', () => {
  test('the published version is superseded and investors are notified', async () => {
    const pool = makePool({ createdBy: portfolio, ownerUserId: owner, crNumber: 'MAT-1' });
    await investAndConfirm(investorToken, pool.poolId, pool.disclosureId, omr(500));

    const sections = {
      summary: { activityAr: 'ن'.repeat(25), useOfFundsAr: 'ن'.repeat(25), expansionRationaleAr: 'ن'.repeat(25) },
      financials: {
        historicalRevenue: [{ period: '2025-Q1', amount: 1000 }, { period: '2025-Q2', amount: 1100 }, { period: '2025-Q3', amount: 1200 }],
        assumptionsAr: 'ن'.repeat(25),
        scenarios: {
          conservative: { annualCashYieldBps: 500, narrativeAr: 'ن'.repeat(15) },
          base: { annualCashYieldBps: 900, narrativeAr: 'ن'.repeat(15) },
          optimistic: { annualCashYieldBps: 1200, narrativeAr: 'ن'.repeat(15) },
        },
      },
      rights: { instrumentAr: 'ن'.repeat(15), distributionPolicyAr: 'ن'.repeat(15), votingAr: 'ن'.repeat(10),
                restrictionsAr: 'ن'.repeat(10), exitMechanismAr: 'ن'.repeat(25), defaultHandlingAr: 'ن'.repeat(15) },
      risks: { capitalLossAr: 'ن'.repeat(25), liquidityAr: 'ن'.repeat(25), operationalAr: 'ن'.repeat(25),
               sectorAr: 'ن'.repeat(15), conflictsAr: 'ن'.repeat(15), dependenciesAr: 'ن'.repeat(15) },
      fees: { assessmentFee: omr(750), successFeeBps: 300, monitoringFeeBps: 100, investorFeeNoteAr: 'لا رسوم' },
      evidence: [],
    };

    const drafted = await api('POST', `/api/pools/${pool.poolId}/disclosures`, {
      token: portfolioToken,
      body: { sections, changeReason: 'تغير مورد المعدات الرئيسي وارتفاع التكلفة 8%', materialChange: true },
    });
    assert.equal(drafted.status, 201);
    assert.equal(drafted.body.version, 2);

    const published = await api('POST', `/api/pools/${pool.poolId}/publish`, {
      token: portfolioToken,
      body: { disclosureId: drafted.body.disclosureId, escrowAccountRef: 'ESCROW-T-MAT',
              reason: 'نشر نسخة إفصاح جديدة بعد تغيير جوهري' },
    });
    assert.equal(published.status, 200);
    assert.equal(published.body.disclosureVersion, 2);

    const versions = all<any>(`SELECT version, status FROM disclosure_versions WHERE pool_id = ? ORDER BY version`, [pool.poolId]);
    assert.deepEqual(versions.map((v) => v.status), ['superseded', 'published'], 'v1 is superseded, never overwritten');

    const notification = get<any>(
      `SELECT 1 FROM notifications WHERE user_id = ? AND template_code = 'material_change'`, [investor]);
    assert.ok(notification, 'existing investors are notified of the material change');

    const materialCase = get<any>(`SELECT 1 FROM cases WHERE type = 'material_change' AND related_id = ?`, [pool.poolId]);
    assert.ok(materialCase, 'a material-change case is opened for the approval workflow');

    // FR-303 — an order against the superseded version is refused.
    const stale = await api('POST', '/api/orders', {
      token: investorToken,
      body: { poolId: pool.poolId, amount: omr(200), disclosureVersionId: pool.disclosureId, acknowledgements: ACKS },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'disclosure_superseded');
  });
});

describe('AT-05 — the maker of a disbursement cannot approve it', () => {
  test('self-approval is refused; a second authorised user succeeds', async () => {
    const pool = makePool({ createdBy: portfolio, ownerUserId: owner, target: omr(40_000), minAmount: omr(10_000), crNumber: 'DISB-1' });
    const soph = makeUser({ fullName: 'مستثمر مؤهل', email: 'soph@test.om', roles: ['investor'],
                            investor: { classification: 'sophisticated' } });
    const sophToken = await login('soph@test.om');
    await investAndConfirm(sophToken, pool.poolId, pool.disclosureId, omr(40_000));

    await api('POST', `/api/funds/pools/${pool.poolId}/close`, {
      token: financeCheckerToken, body: { reason: 'target reached — approved close' },
    });

    const drafted = await api('POST', `/api/funds/pools/${pool.poolId}/disbursements`, {
      token: financeMakerToken,
      body: { milestoneCode: 'M1', milestoneLabel: 'دفعة المورد الأولى', beneficiary: 'مورد المعدات',
              amount: omr(20_000), conditionText: 'يُصرف بعد استلام الفاتورة وإثبات التسليم' },
    });
    assert.equal(drafted.status, 201);

    const evidence = await api('POST', `/api/funds/disbursements/${drafted.body.disbursementId}/evidence`, {
      token: financeMakerToken,
      body: { fileName: 'invoice.pdf', mimeType: 'application/pdf',
              contentBase64: Buffer.from('invoice evidence').toString('base64'), conditionMet: true },
    });
    assert.equal(evidence.status, 200);

    // FR-405 / BR-012 — Finance Ops may approve in general, but never their own request.
    const selfApproval = await api('POST', `/api/funds/disbursements/${drafted.body.disbursementId}/approve`, {
      token: financeMakerToken, body: { reason: 'محاولة اعتماد ذاتي' },
    });
    assert.equal(selfApproval.status, 409);
    assert.equal(selfApproval.body.error.code, 'dual_control_violation');

    const approved = await api('POST', `/api/funds/disbursements/${drafted.body.disbursementId}/approve`, {
      token: financeCheckerToken, body: { reason: 'تم التحقق من الفاتورة وإثبات التسليم' },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'approved');
  });

  test('approval without evidence is refused even by an authorised checker', async () => {
    const pool = makePool({ createdBy: portfolio, ownerUserId: owner, target: omr(30_000), minAmount: omr(10_000), crNumber: 'DISB-2' });
    const soph2 = makeUser({ fullName: 'مؤهل ٢', email: 'soph2@test.om', roles: ['investor'],
                             investor: { classification: 'sophisticated' } });
    const token = await login('soph2@test.om');
    await investAndConfirm(token, pool.poolId, pool.disclosureId, omr(30_000));
    await api('POST', `/api/funds/pools/${pool.poolId}/close`, { token: financeCheckerToken, body: { reason: 'approved close for evidence test' } });

    const drafted = await api('POST', `/api/funds/pools/${pool.poolId}/disbursements`, {
      token: financeMakerToken,
      body: { milestoneCode: 'M1', milestoneLabel: 'دفعة بلا دليل', beneficiary: 'مورد',
              amount: omr(5_000), conditionText: 'شرط يتطلب دليلًا موثقًا' },
    });
    run(`UPDATE disbursements SET status = 'pending_approval' WHERE id = ?`, [drafted.body.disbursementId]);

    const approved = await api('POST', `/api/funds/disbursements/${drafted.body.disbursementId}/approve`, {
      token: financeCheckerToken, body: { reason: 'اعتماد بدون دليل' },
    });
    assert.equal(approved.status, 422);
    assert.equal(approved.body.error.code, 'condition_not_met');
  });
});

describe('AT-06 — an overdue report raises an alert, a case and an escalation', () => {
  test('the monitoring job flags the late report', async () => {
    const { flagLateReports, escalateOverdueCases } = await import('../workflow/scheduler.ts');
    const pool = makePool({ createdBy: portfolio, ownerUserId: owner, crNumber: 'RPT-1' });
    const past = plus(nowIso(), -days(10));

    run(`INSERT INTO project_reports (id, pool_id, period_label, period_start, period_end, due_at, status, created_at)
         VALUES (lower(hex(randomblob(16))), ?, '2026-01', ?, ?, ?, 'scheduled', ?)`,
        [pool.poolId, plus(past, -days(30)), past, past, past]);

    const result = flagLateReports();
    assert.ok((result.flagged as number) >= 1);

    const alert = get<any>(`SELECT * FROM alerts WHERE pool_id = ? AND type = 'report_late'`, [pool.poolId]);
    assert.ok(alert, 'an alert is raised');

    const caseRow = get<any>(`SELECT * FROM cases WHERE type = 'report_late' AND related_id = ?`, [pool.poolId]);
    assert.ok(caseRow, 'a case is opened for the responsible team');

    run(`UPDATE cases SET sla_due_at = ? WHERE id = ?`, [plus(nowIso(), -days(1)), caseRow.id]);
    escalateOverdueCases();
    const escalated = get<any>(`SELECT status FROM cases WHERE id = ?`, [caseRow.id]);
    assert.equal(escalated.status, 'escalated', 'SLA breach escalates the case');
  });
});

describe('AT-07 — a user without financial permission gets 403 and the attempt is logged', () => {
  test('funds endpoints reject an investor without disclosing data', async () => {
    const response = await api('GET', '/api/funds/queue', { token: investorToken });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'forbidden');
    assert.ok(!('disbursements' in response.body), 'no protected data is returned');

    const logged = get<any>(
      `SELECT * FROM audit_events WHERE actor_id = ? AND action = 'access.denied' ORDER BY created_at DESC LIMIT 1`,
      [investor]);
    assert.ok(logged, 'the denied attempt is recorded');
    assert.equal(logged.entity_id, 'funds.read');
  });
});

describe('AT-08 — a duplicated webhook applies exactly once', () => {
  test('the second delivery is recorded as a replay and changes nothing', async () => {
    const pool = makePool({ createdBy: portfolio, ownerUserId: owner, crNumber: 'DUP-1' });
    const created = await api('POST', '/api/orders', {
      token: investorToken,
      body: { poolId: pool.poolId, amount: omr(300), disclosureVersionId: pool.disclosureId, acknowledgements: ACKS },
    });

    const event = { id: 'evt-duplicate-1', type: 'payment.settled', providerRef: created.body.payment.providerRef, amount: omr(300) };
    const first = await partnerWebhook(event);
    const second = await partnerWebhook(event);

    assert.equal(first.body.applied, true);
    assert.equal(second.body.applied, false);
    assert.equal(second.body.duplicate, true);

    const confirmations = all(
      `SELECT * FROM audit_events WHERE entity_id = ? AND action = 'order.confirmed'`, [created.body.orderId]);
    assert.equal(confirmations.length, 1, 'the transaction is applied once');

    const replay = get<any>(`SELECT * FROM webhook_events WHERE duplicate_of IS NOT NULL`);
    assert.ok(replay, 'the replay itself is recorded');
  });

  test('an invalid signature is rejected outright', async () => {
    const response = await fetch(`${(await startTestServer())}/api/webhooks/partner`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hissa-signature': 'deadbeef' },
      body: JSON.stringify({ id: 'evt-bad', type: 'payment.settled', providerRef: 'PR-X' }),
    });
    assert.equal(response.status, 401);
  });
});

describe('AT-09 — a partner timeout leaves the order Pending, never Failed', () => {
  test('status stays pending and the pending payment is raised for reconciliation', async () => {
    const { chasePendingPayments } = await import('../workflow/scheduler.ts');
    const pool = makePool({ createdBy: portfolio, ownerUserId: owner, crNumber: 'TIMEOUT-1' });

    const created = await api('POST', '/api/orders', {
      token: investorToken,
      body: { poolId: pool.poolId, amount: omr(400), disclosureVersionId: pool.disclosureId, acknowledgements: ACKS },
    });
    // No webhook arrives — the partner timed out.
    const status = await api('GET', `/api/orders/${created.body.orderId}/status`, { token: investorToken });
    assert.equal(status.body.status, 'pending');
    assert.equal(status.body.partnerStatus, 'pending');
    assert.ok(status.body.messageAr.includes('لا يعني التأخير فشل العملية'));

    run(`UPDATE payment_references SET created_at = ? WHERE order_id = ?`,
        [plus(nowIso(), -days(1)), created.body.orderId]);
    chasePendingPayments();

    const stillPending = get<any>(`SELECT status FROM investment_orders WHERE id = ?`, [created.body.orderId]);
    assert.equal(stillPending.status, 'pending', 'a timeout never flips the order to failed');

    const raised = get<any>(`SELECT * FROM cases WHERE type = 'recon_break' AND related_id LIKE 'PR-%'`);
    assert.ok(raised, 'the stale payment is raised for enquiry with the partner');
  });
});

describe('AT-10 — Arabic journey and downloadable Arabic documents', () => {
  test('errors, content and documents are served in Arabic', async () => {
    const howItWorks = await api('GET', '/api/public/how-it-works');
    assert.equal(howItWorks.status, 200);
    assert.ok(howItWorks.body.investorSteps[0].titleAr.length > 0);

    const risks = await api('GET', '/api/public/risks');
    assert.ok(risks.body.headlineAr.includes('قد تخسر كامل المبلغ'));

    const blocked = await api('POST', '/api/orders', {
      token: investorToken, body: { poolId: '00000000-0000-4000-8000-000000000000', amount: 1 },
    });
    assert.ok(blocked.body.error.messageAr, 'every error carries an Arabic message');
    assert.ok(blocked.body.error.messageEn, 'and an English one');

    const document = await api('GET', '/api/identity/legal-documents/risk_disclosure');
    assert.equal(document.status, 200);
    assert.ok(document.body.bodyAr.includes('خسارة رأس المال'));
    assert.ok(document.body.bodyEn.includes('Capital loss'));
  });

  test('money renders with the three decimals OMR requires', () => {
    assert.equal(toOmrString(omr(1_234.5)), '1,234.500');
    assert.equal(toOmrString(omr(0.001)), '0.001');
    assert.equal(toOmrString(omr(100)), '100.000');
  });
});

describe('AT-11 — a complaint yields a reference, an SLA, an owner and an acknowledgement', () => {
  test('the complaint is trackable end to end', async () => {
    const complaint = await api('POST', '/api/cases/complaints', {
      token: investorToken,
      body: { category: 'payment_refund', subject: 'تأخر استرداد مبلغ',
              body: 'لم يصلني مبلغ الاسترداد بعد مرور عشرة أيام على إشعار الاسترداد.' },
    });
    assert.equal(complaint.status, 201);
    assert.ok(complaint.body.reference.startsWith('CMP-'));
    assert.ok(complaint.body.slaDueAt, 'an SLA target is set');

    const acknowledgement = get<any>(
      `SELECT * FROM notifications WHERE user_id = ? AND template_code = 'complaint_received'`, [investor]);
    assert.ok(acknowledgement, 'the customer receives an acknowledgement');

    const assigned = await api('POST', `/api/cases/${complaint.body.caseId}/assign`, {
      token: complianceToken, body: { assigneeId: compliance },
    });
    assert.equal(assigned.status, 200);

    // FR-604 — internal notes stay internal.
    await api('POST', `/api/cases/${complaint.body.caseId}/notes`, {
      token: complianceToken, body: { body: 'ملاحظة داخلية: مراجعة سجل البنك', internal: true },
    });
    const view = await api('GET', `/api/cases/complaints/${complaint.body.reference}`, { token: investorToken });
    assert.equal(view.body.notes.length, 0, 'the customer sees no internal notes');

    const resolved = await api('POST', `/api/cases/${complaint.body.caseId}/resolve`, {
      token: complianceToken, body: { resolution: 'تم تنفيذ الاسترداد وتأكيد المرجع لدى البنك.' },
    });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.withinSla, true);
  });
});

describe('AT-12 — audit integrity under recovery conditions', () => {
  test('the audit log is functionally immutable', () => {
    const event = get<any>(`SELECT id FROM audit_events LIMIT 1`);
    assert.throws(() => run(`UPDATE audit_events SET action = 'tampered' WHERE id = ?`, [event.id]),
                  /append-only/, 'UPDATE is rejected');
    assert.throws(() => run(`DELETE FROM audit_events WHERE id = ?`, [event.id]),
                  /append-only/, 'DELETE is rejected');
  });

  test('a published disclosure cannot be silently rewritten', () => {
    const disclosure = get<any>(`SELECT id FROM disclosure_versions WHERE status = 'published' LIMIT 1`);
    assert.throws(
      () => run(`UPDATE disclosure_versions SET content_hash = 'rewritten' WHERE id = ?`, [disclosure.id]),
      /immutable/);
  });

  test('every pool state transition is reconstructable from its events', async () => {
    const pool = makePool({ createdBy: portfolio, ownerUserId: owner, crNumber: 'TRAIL-1' });
    await api('POST', `/api/pools/${pool.poolId}/pause`, {
      token: complianceToken, body: { reason: 'مراجعة امتثال على محتوى الإفصاح' },
    });
    const timeline = await api('GET', `/api/pools/${pool.poolId}/timeline`, { token: complianceToken });
    const paused = timeline.body.events.find((e: any) => e.to_state === 'paused');
    assert.ok(paused.reason.length > 0, 'each transition keeps its reason');
    assert.ok(paused.actor, 'and its actor');
    assert.ok(paused.created_at, 'and its timestamp');
  });
});
