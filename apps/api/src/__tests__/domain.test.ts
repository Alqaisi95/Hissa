/** Unit tests for the calculation engines that money correctness depends on. */
import './env.ts';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { omr, toOmrString, parseOmr, applyBps, proRata, BAISA_PER_OMR } from '../lib/money.ts';
import { allocate, type AllocatableOrder } from '../domains/orders/allocation.ts';
import { scoreRisk } from '../domains/origination/riskModel.ts';
import { scoreSuitability, proposeClassification } from '../domains/identity/suitability.ts';
import { canTransition, POOL_TRANSITIONS, type PoolState } from '../workflow/poolState.ts';
import { permissionsFor, ROLE_PERMISSIONS, ROLES, assertDualControl, requiresMfa } from '../lib/rbac.ts';
import { computeVariances } from '../domains/portfolio/routes.ts';

describe('money — OMR with three decimals, no floats (PRD §10.1)', () => {
  test('conversion round-trips exactly', () => {
    assert.equal(omr(1), BAISA_PER_OMR);
    assert.equal(omr(0.001), 1);
    assert.equal(parseOmr('1,234.567'), 1_234_567);
    assert.equal(parseOmr('0.5'), 500);
    assert.equal(toOmrString(1_234_567), '1,234.567');
    assert.equal(toOmrString(-1_500), '-1.500');
  });

  test('invalid amounts are rejected rather than silently rounded', () => {
    assert.throws(() => parseOmr('1.2345'), /invalid OMR amount/);
    assert.throws(() => parseOmr('abc'), /invalid OMR amount/);
  });

  test('basis-point arithmetic stays integral', () => {
    assert.equal(applyBps(omr(100_000), 300), omr(3_000));   // 3% success fee
    assert.equal(applyBps(omr(4_200), 100), omr(42));        // 1% monitoring fee
    assert.equal(applyBps(1, 5_000), 1);                     // rounds half-up, never to 0.5
  });

  test('pro-rata always sums back to the total, with no rounding drift', () => {
    // A deliberately awkward split: three equal weights over an indivisible total.
    const split = proRata(1_000, [1, 1, 1]);
    assert.equal(split.reduce((a, b) => a + b, 0), 1_000);
    assert.deepEqual(split, [334, 333, 333]);

    for (const total of [7, 999, 1_000_003, omr(65_000)]) {
      for (const weights of [[1, 2, 3], [5, 5], [1, 1, 1, 1, 1, 1, 7]]) {
        const result = proRata(total, weights);
        assert.equal(result.reduce((a, b) => a + b, 0), total, `sum must equal total for ${total}/${weights}`);
        assert.ok(result.every((r) => Number.isInteger(r) && r >= 0));
      }
    }
  });

  test('a zero weight set does not divide by zero', () => {
    assert.deepEqual(proRata(1_000, [0, 0]), [0, 0]);
  });
});

describe('allocation — FR-306 / BR-017 deterministic and explainable', () => {
  const order = (id: string, amount: number, minutesAgo: number): AllocatableOrder => ({
    id, reference: `ORD-${id}`, investor_id: `inv-${id}`, amount,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 60 - minutesAgo)).toISOString(),
  });
  const pool = { target_amount: omr(50_000), max_amount: omr(50_000), unit_price: omr(100),
                 allocation_rule: 'pro_rata', min_ticket: omr(100) };

  test('an undersubscribed pool allocates every commitment in full', () => {
    const result = allocate(pool, [order('a', omr(10_000), 30), order('b', omr(5_000), 20)]);
    assert.equal(result.oversubscribed, false);
    assert.equal(result.refundTotal, 0);
    assert.equal(result.allocatedTotal, omr(15_000));
  });

  test('pro-rata never over-allocates and refunds the exact remainder', () => {
    const orders = [order('a', omr(30_000), 40), order('b', omr(30_000), 30), order('c', omr(20_000), 20)];
    const result = allocate(pool, orders);

    assert.equal(result.oversubscribed, true);
    assert.equal(result.allocatedTotal, omr(50_000), 'allocation ties exactly to the ceiling');
    assert.equal(result.allocatedTotal + result.refundTotal, result.requestedTotal, 'nothing is lost');
    // Larger commitments receive proportionally more.
    assert.ok(result.lines[0].allocated > result.lines[2].allocated);
    for (const line of result.lines) assert.ok(line.allocated <= line.requested);
  });

  test('the same inputs always produce the same output', () => {
    const orders = [order('a', omr(17_000), 40), order('b', omr(23_000), 30), order('c', omr(19_000), 20)];
    const first = allocate(pool, orders);
    const second = allocate(pool, orders);
    assert.deepEqual(first.lines, second.lines, 'allocation is reproducible for audit');
  });

  test('a share scaled below the minimum ticket is refunded, not part-issued', () => {
    const orders = [order('whale', omr(400_000), 40), order('small', omr(100), 30)];
    const result = allocate(pool, orders);
    const small = result.lines.find((l) => l.orderId === 'small')!;
    assert.equal(small.allocated, 0);
    assert.equal(small.refund, omr(100));
    assert.equal(result.allocatedTotal, omr(50_000));
  });

  test('first-confirmed fills in confirmation order and refunds the rest', () => {
    const firstConfirmed = { ...pool, allocation_rule: 'first_confirmed' };
    const orders = [order('early', omr(40_000), 40), order('mid', omr(20_000), 30), order('late', omr(10_000), 10)];
    const result = allocate(firstConfirmed, orders);

    assert.equal(result.lines[0].allocated, omr(40_000), 'the earliest is filled first');
    assert.equal(result.lines[1].allocated, omr(10_000), 'the next is filled to the ceiling');
    assert.equal(result.lines[2].allocated, 0, 'the last misses out entirely');
    assert.equal(result.allocatedTotal, omr(50_000));
  });

  test('overfunding is honoured up to the declared ceiling only', () => {
    const withCeiling = { ...pool, max_amount: omr(55_000) };
    const result = allocate(withCeiling, [order('a', omr(60_000), 30)]);
    assert.equal(result.allocatedTotal, omr(55_000));
    assert.equal(result.refundTotal, omr(5_000));
  });
});

describe('risk model — FR-106 versioned and reproducible', () => {
  const baseline = {
    monthsTrading: 36, revenueStabilityBps: 8_000, ownerContributionBps: 2_500,
    dataQuality: 'pos_api' as const, useOfFundsSpecificity: 'itemised_quotes' as const,
    sectorRisk: 'low' as const, managementDepth: 'team' as const,
    existingLeverageBps: 1_000, licensesComplete: true, supplierConcentrationBps: 3_000,
  };

  test('a strong applicant scores well and raises no flags', () => {
    const result = scoreRisk(baseline);
    assert.ok(result.score >= 85, `expected grade A, got ${result.score}`);
    assert.equal(result.grade, 'A');
    assert.deepEqual(result.flags, []);
    assert.ok(result.version);
  });

  test('policy breaches are flagged rather than quietly scored away', () => {
    const weak = scoreRisk({ ...baseline, monthsTrading: 6, ownerContributionBps: 1_000,
                             dataQuality: 'none', useOfFundsSpecificity: 'narrative', licensesComplete: false });
    assert.ok(weak.flags.includes('operating_history_below_12_months'));
    assert.ok(weak.flags.includes('owner_contribution_below_policy'));
    assert.ok(weak.flags.includes('no_verifiable_financial_data'));
    assert.ok(weak.flags.includes('licences_incomplete'));
    assert.ok(weak.flags.includes('use_of_funds_not_itemised'));
    assert.ok(weak.score < scoreRisk(baseline).score);
  });

  test('weights total 100 so the score is a true percentage', () => {
    const result = scoreRisk(baseline);
    assert.equal(result.breakdown.reduce((sum, f) => sum + f.weight, 0), 100);
  });

  test('an owner contribution above the band is flagged but not rewarded', () => {
    const above = scoreRisk({ ...baseline, ownerContributionBps: 4_000 });
    assert.ok(above.flags.includes('owner_contribution_above_policy_band'));
    assert.equal(above.score, scoreRisk(baseline).score, 'no extra credit beyond the band');
  });
});

describe('suitability — FR-005 gates on understanding, not on score alone', () => {
  const correct = { capital_loss: 'full_loss', liquidity: 'no_secondary', diversification: 'small', returns: 'projection' };

  test('all correct answers pass', () => {
    const result = scoreSuitability(correct);
    assert.equal(result.result, 'pass');
    assert.equal(result.score, 100);
  });

  test('a single misunderstood core risk restricts, whatever the total score', () => {
    const result = scoreSuitability({ ...correct, capital_loss: 'protected' });
    assert.equal(result.result, 'restricted');
    assert.ok(result.failedCodes.includes('capital_loss'));
  });

  test('believing the platform offers liquidity restricts', () => {
    assert.equal(scoreSuitability({ ...correct, liquidity: 'anytime' }).result, 'restricted');
  });

  test('missing answers are treated as failures, never as zero-weight', () => {
    assert.equal(scoreSuitability({}).result, 'restricted');
  });

  test('classification follows the declared evidence', () => {
    assert.equal(proposeClassification({}), 'retail');
    assert.equal(proposeClassification({ netWorthOmr: 300_000 }), 'angel');
    assert.equal(proposeClassification({ professionalCertification: true }), 'sophisticated');
    assert.equal(proposeClassification({ priorDeals: 12 }), 'sophisticated');
  });
});

describe('pool state machine — PRD §5', () => {
  test('closed and cancelled are terminal', () => {
    assert.deepEqual(POOL_TRANSITIONS.closed.to, []);
    assert.deepEqual(POOL_TRANSITIONS.cancelled.to, []);
  });

  test('a pool can never jump straight from funding to disbursement', () => {
    assert.equal(canTransition('funding', 'disbursement'), false);
    assert.equal(canTransition('funding', 'funded'), true);
    assert.equal(canTransition('funded', 'disbursement'), true);
  });

  test('a failed campaign routes through refunding, never to operating', () => {
    assert.equal(canTransition('funding', 'refunding'), true);
    assert.equal(canTransition('refunding', 'operating'), false);
  });

  test('every target state is itself a known state', () => {
    const states = Object.keys(POOL_TRANSITIONS) as PoolState[];
    for (const [from, rule] of Object.entries(POOL_TRANSITIONS)) {
      for (const to of rule.to) {
        assert.ok(states.includes(to), `${from} → ${to} targets an unknown state`);
      }
    }
  });
});

describe('RBAC — PRD §9 segregation of duties', () => {
  test('system admin approves neither money nor investments', () => {
    const permissions = permissionsFor(['system_admin']);
    assert.equal(permissions.has('funds.approve'), false);
    assert.equal(permissions.has('committee.decide'), false);
    assert.equal(permissions.has('order.create'), false);
  });

  test('an auditor can read but never write', () => {
    for (const permission of ROLE_PERMISSIONS.auditor) {
      assert.ok(/read|audit/.test(permission), `auditor holds a write permission: ${permission}`);
    }
  });

  test('an investor cannot reach staff functions', () => {
    const permissions = permissionsFor(['investor']);
    for (const denied of ['funds.read', 'pool.publish', 'identity.review_kyc', 'audit.read'] as const) {
      assert.equal(permissions.has(denied), false, `investor must not hold ${denied}`);
    }
  });

  test('dual control rejects a maker approving their own request', () => {
    assert.throws(() => assertDualControl('user-1', 'user-1'), /dual_control_violation/);
    assert.doesNotThrow(() => assertDualControl('user-1', 'user-2'));
  });

  test('privileged roles require MFA, investors do not', () => {
    assert.equal(requiresMfa(['compliance']), true);
    assert.equal(requiresMfa(['finance_ops']), true);
    assert.equal(requiresMfa(['investor']), false);
  });

  test('every declared role has at least one permission', () => {
    for (const role of ROLES) assert.ok(ROLE_PERMISSIONS[role].length > 0, `${role} has no permissions`);
  });
});

describe('report variance — FR-502', () => {
  test('deviation and its percentage are reported in basis points', () => {
    const variances = computeVariances({
      revenue: { actual: 9_000, forecast: 10_000 },
      utilisation: { actual: 82, forecast: 75 },
      headcount: { actual: 4 },
    });
    const revenue = variances.find((v) => v.metric === 'revenue')!;
    assert.equal(revenue.deviation, -1_000);
    assert.equal(revenue.deviationBps, -1_000);   // −10%

    const utilisation = variances.find((v) => v.metric === 'utilisation')!;
    assert.ok(utilisation.deviationBps! > 0);

    const headcount = variances.find((v) => v.metric === 'headcount')!;
    assert.equal(headcount.deviation, null, 'no forecast means no fabricated variance');
  });
});
