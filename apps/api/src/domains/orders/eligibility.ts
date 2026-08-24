/**
 * FR-301 / BR-003..BR-009 — the eligibility gate evaluated before any commitment
 * can be created. It returns a deterministic, explainable verdict: the investor
 * sees *what* is available, never the internal rule thresholds (AT-02, FR-301).
 */
import { all, get } from '../../db/index.ts';
import { limits, poolPolicy } from '../../lib/settings.ts';
import { nowIso, days } from '../../lib/ids.ts';
import type { Baisa } from '../../lib/money.ts';

export type BlockCode =
  | 'kyc_not_approved' | 'suitability_missing' | 'suitability_restricted'
  | 'account_restricted' | 'consents_missing' | 'pool_not_funding'
  | 'below_min_ticket' | 'above_available' | 'issuer_cap' | 'rolling_cap'
  | 'pool_capacity' | 'sanctions_hold';

export interface EligibilityVerdict {
  eligible: boolean;
  /** Largest amount this investor may still commit to this pool, in baisa. */
  availableAmount: Baisa;
  minTicket: Baisa;
  blocks: { code: BlockCode; messageAr: string; messageEn: string }[];
  /** Internal only — never serialised to an investor response. */
  internal: {
    classification: string;
    perIssuerCap: Baisa | null;
    perIssuerUsed: Baisa;
    rollingCap: Baisa | null;
    rollingUsed: Baisa;
    poolRemaining: Baisa;
  };
}

/** Committed amounts count toward caps while pending or confirmed — never after refund. */
const COUNTED_STATUSES = `('pending','confirmed','allocated')`;

/** BR-003 — per-issuer exposure, measured against the pool's issuing entity. */
export function usedPerIssuer(investorId: string, entityId: string): Baisa {
  const row = get<{ total: number | null }>(
    `SELECT SUM(o.amount) AS total
       FROM investment_orders o JOIN pools p ON p.id = o.pool_id
      WHERE o.investor_id = ? AND p.entity_id = ? AND o.status IN ${COUNTED_STATUSES}`,
    [investorId, entityId],
  );
  return row?.total ?? 0;
}

/** BR-004/BR-005 — rolling 12-month exposure across all issuers. */
export function usedRolling12m(investorId: string, at: string = nowIso()): Baisa {
  const since = new Date(new Date(at).getTime() - days(365)).toISOString();
  const row = get<{ total: number | null }>(
    `SELECT SUM(amount) AS total FROM investment_orders
      WHERE investor_id = ? AND status IN ${COUNTED_STATUSES} AND created_at >= ?`,
    [investorId, since],
  );
  return row?.total ?? 0;
}

export function capsFor(classification: string, at?: string) {
  const l = limits(at);
  switch (classification) {
    case 'sophisticated':
      // BR-006 — no published amount cap; the system never exceeds what the partner approves.
      return { perIssuer: null, rolling: l.sophisticatedRolling12m };
    case 'angel':
      return { perIssuer: null, rolling: l.angelRolling12m };
    default:
      return { perIssuer: l.retailPerIssuer, rolling: l.retailRolling12m };
  }
}

export function committedToPool(poolId: string): Baisa {
  const row = get<{ total: number | null }>(
    `SELECT SUM(amount) AS total FROM investment_orders WHERE pool_id = ? AND status IN ${COUNTED_STATUSES}`,
    [poolId],
  );
  return row?.total ?? 0;
}

export function evaluateEligibility(investorId: string, poolId: string, at: string = nowIso()): EligibilityVerdict {
  const blocks: EligibilityVerdict['blocks'] = [];
  const block = (code: BlockCode, ar: string, en: string) => blocks.push({ code, messageAr: ar, messageEn: en });

  const user = get<any>(`SELECT * FROM users WHERE id = ?`, [investorId]);
  const profile = get<any>(`SELECT * FROM investor_profiles WHERE user_id = ?`, [investorId]);
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [poolId]);

  if (!user || !pool) {
    return {
      eligible: false, availableAmount: 0, minTicket: poolPolicy(at).minTicket,
      blocks: [{ code: 'pool_not_funding', messageAr: 'الفرصة غير متاحة', messageEn: 'Pool unavailable' }],
      internal: { classification: 'unknown', perIssuerCap: null, perIssuerUsed: 0, rollingCap: null, rollingUsed: 0, poolRemaining: 0 },
    };
  }

  // BR-009 — no investment before KYC, suitability and acknowledgement.
  if (user.status === 'restricted' || user.status === 'suspended') {
    block('account_restricted', 'الحساب مقيد حاليًا. أكمل المتطلبات المطلوبة للمتابعة.', 'Your account is restricted.');
  }
  if (!profile || profile.kyc_status !== 'approved') {
    block('kyc_not_approved', 'يلزم اكتمال التحقق من الهوية قبل الاستثمار.', 'Identity verification must be approved first.');
  }
  if (profile && profile.sanctions_flag === 1) {
    // Deliberately non-revealing wording (§13.1 — logs and messages disclose nothing).
    block('sanctions_hold', 'حسابك قيد المراجعة. سيتواصل معك فريق الامتثال.', 'Your account is under review.');
  }
  if (!profile?.suitability_taken_at) {
    block('suitability_missing', 'يلزم إكمال اختبار الملاءمة وإقرار فهم المخاطر.', 'Complete the suitability assessment first.');
  } else if (profile.suitability_result === 'restricted') {
    block('suitability_restricted', 'نتيجة اختبار الملاءمة لا تسمح بهذا النوع من الاستثمار حاليًا.', 'Your suitability result restricts this investment.');
  }

  const consents = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM consents WHERE user_id = ? AND document_key IN ('terms','risk_disclosure','privacy')`,
    [investorId],
  );
  if ((consents?.n ?? 0) < 3) {
    block('consents_missing', 'يلزم الموافقة على الشروط وإفصاح المخاطر وسياسة الخصوصية.', 'Required consents are missing.');
  }

  if (pool.status !== 'funding') {
    block('pool_not_funding', 'هذه الفرصة غير مفتوحة للاستثمار حاليًا.', 'This pool is not open for investment.');
  }
  if (pool.closes_at && new Date(pool.closes_at).getTime() <= new Date(at).getTime()) {
    block('pool_not_funding', 'انتهت مدة جمع التمويل لهذه الفرصة.', 'The funding window has closed.');
  }

  const classification = profile?.classification ?? 'retail';
  const caps = capsFor(classification, at);
  const perIssuerUsed = usedPerIssuer(investorId, pool.entity_id);
  const rollingUsed = usedRolling12m(investorId, at);

  const headroomIssuer = caps.perIssuer === null ? Infinity : Math.max(0, caps.perIssuer - perIssuerUsed);
  const headroomRolling = caps.rolling === null ? Infinity : Math.max(0, caps.rolling - rollingUsed);

  // Pool capacity: overfunding is allowed only up to the declared ceiling (BR-017).
  const policy = poolPolicy(at);
  const ceiling = pool.max_amount ?? Math.round((pool.target_amount * policy.maxOverfundingBps) / 10_000);
  const poolRemaining = Math.max(0, ceiling - committedToPool(poolId));

  const perInvestorCeiling = pool.max_ticket ?? Infinity;
  const availableRaw = Math.min(headroomIssuer, headroomRolling, poolRemaining, perInvestorCeiling);
  const availableAmount = Number.isFinite(availableRaw) ? availableRaw : poolRemaining;

  if (availableAmount <= 0 && blocks.length === 0) {
    block(poolRemaining <= 0 ? 'pool_capacity' : 'rolling_cap',
      poolRemaining <= 0 ? 'اكتمل الحد الأقصى لهذه الفرصة.' : 'بلغت الحد المتاح لك خلال آخر 12 شهرًا.',
      poolRemaining <= 0 ? 'This pool has reached its ceiling.' : 'You have reached your available limit for the last 12 months.');
  }

  return {
    eligible: blocks.length === 0 && availableAmount >= Math.max(pool.min_ticket, policy.minTicket),
    availableAmount,
    minTicket: Math.max(pool.min_ticket, policy.minTicket),
    blocks,
    internal: {
      classification,
      perIssuerCap: caps.perIssuer,
      perIssuerUsed,
      rollingCap: caps.rolling,
      rollingUsed,
      poolRemaining,
    },
  };
}

/** Investor-safe projection: caps and usage stay internal (FR-301). */
export function publicVerdict(v: EligibilityVerdict) {
  return {
    eligible: v.eligible,
    availableAmount: v.availableAmount,
    minTicket: v.minTicket,
    blocks: v.blocks,
  };
}

/** BR-007 — a young issuer may not raise beyond the published ceiling. */
export function issuerRaiseAllowed(entityId: string, targetAmount: Baisa, at: string = nowIso()): boolean {
  const entity = get<{ incorporated_on: string }>(`SELECT incorporated_on FROM legal_entities WHERE id = ?`, [entityId]);
  if (!entity) return false;
  const l = limits(at);
  const monthsTrading =
    (new Date(at).getTime() - new Date(entity.incorporated_on).getTime()) / (days(365) / 12);
  if (monthsTrading >= l.youngIssuerMonths) return true;
  return targetAmount <= l.youngIssuerMaxRaise;
}

/** Total raised historically by an issuer — used in committee packs and screening. */
export function issuerHistory(entityId: string) {
  return all(
    `SELECT p.reference, p.title_ar, p.status, p.target_amount, p.funded_at
       FROM pools p WHERE p.entity_id = ? ORDER BY p.created_at DESC`,
    [entityId],
  );
}
