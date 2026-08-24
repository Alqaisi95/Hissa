/**
 * FR-607 / BR-020 — limits, fees and policy values are effective-dated settings
 * with an approval trail, never constants baked into the code. Reads resolve the
 * row that is active at the requested instant, so history stays reproducible.
 */
import { all, get, run } from '../db/index.ts';
import { newId, nowIso } from './ids.ts';
import { omr } from './money.ts';
import { audit } from './audit.ts';

export const SETTING_KEYS = {
  investorLimits: 'investor.limits',
  poolPolicy: 'pool.policy',
  fees: 'platform.fees',
  slas: 'ops.slas',
  coolingOff: 'investment.cooling_off',
  bannedTerms: 'content.banned_terms',
} as const;

export interface InvestorLimits {
  // BR-003..BR-007 — published caps, re-validated with the licensed operator.
  retailPerIssuer: number;      // baisa
  retailRolling12m: number;     // baisa
  angelRolling12m: number;      // baisa
  sophisticatedRolling12m: number | null;  // null = no published cap (BR-006)
  youngIssuerMaxRaise: number;  // BR-007
  youngIssuerMonths: number;
}

export interface PoolPolicy {
  minPoolSize: number;          // BR-010
  maxPoolSize: number;
  minTicket: number;
  ownerContributionMinBps: number;  // BR-011
  ownerContributionMaxBps: number;
  minTradingMonths: number;
  allOrNothing: boolean;        // BR-008
  defaultCampaignDays: number;
  maxOverfundingBps: number;
}

export interface Fees {
  assessmentFee: number;        // 750 OMR per accepted study (Doc §13.1)
  successFeeBps: number;        // 3%
  monitoringFeeBps: number;     // 1% annually
}

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  [SETTING_KEYS.investorLimits]: {
    retailPerIssuer: omr(3_000),
    retailRolling12m: omr(20_000),
    angelRolling12m: omr(100_000),
    sophisticatedRolling12m: null,
    youngIssuerMaxRaise: omr(100_000),
    youngIssuerMonths: 12,
  } satisfies InvestorLimits,

  [SETTING_KEYS.poolPolicy]: {
    minPoolSize: omr(40_000),
    maxPoolSize: omr(100_000),
    minTicket: omr(100),
    ownerContributionMinBps: 2_000,
    ownerContributionMaxBps: 3_000,
    minTradingMonths: 12,
    allOrNothing: true,
    defaultCampaignDays: 45,
    maxOverfundingBps: 12_000,
  } satisfies PoolPolicy,

  [SETTING_KEYS.fees]: {
    assessmentFee: omr(750),
    successFeeBps: 300,
    monitoringFeeBps: 100,
  } satisfies Fees,

  [SETTING_KEYS.slas]: {
    infoRequestHours: 72,
    complaintResolutionHours: 120,
    reconciliationBreakHours: 48,
    kycReviewHours: 48,
    reportGraceHours: 120,
  },

  // OD-07: disabled until legal/contractual adoption. Zero hours = not offered.
  [SETTING_KEYS.coolingOff]: { enabled: false, hours: 0 },

  // BR-013 — marketing copy may never promise return or capital protection.
  [SETTING_KEYS.bannedTerms]: {
    ar: ['رأس المال مضمون', 'ربح مضمون', 'عائد ثابت', 'بدون مخاطر', 'مضمون العائد', 'أرباح مؤكدة'],
    en: ['guaranteed return', 'capital guaranteed', 'risk free', 'risk-free', 'assured profit', 'fixed profit'],
  },
};

export function getSetting<T = any>(key: string, at: string = nowIso()): T {
  const row = get<{ value: string }>(
    `SELECT value FROM settings
      WHERE key = ? AND status = 'active' AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to > ?)
      ORDER BY effective_from DESC LIMIT 1`,
    [key, at, at],
  );
  if (row) return JSON.parse(row.value) as T;
  if (key in DEFAULT_SETTINGS) return DEFAULT_SETTINGS[key] as T;
  throw new Error(`unknown setting: ${key}`);
}

export const limits = (at?: string) => getSetting<InvestorLimits>(SETTING_KEYS.investorLimits, at);
export const poolPolicy = (at?: string) => getSetting<PoolPolicy>(SETTING_KEYS.poolPolicy, at);
export const fees = (at?: string) => getSetting<Fees>(SETTING_KEYS.fees, at);
export const slas = (at?: string) => getSetting<Record<string, number>>(SETTING_KEYS.slas, at);

/** Proposals are inert until a second authorised user approves them (FR-607). */
export function proposeSetting(params: {
  key: string; value: unknown; effectiveFrom: string; createdBy: string; note?: string;
}): string {
  const id = newId();
  if (new Date(params.effectiveFrom).getTime() < Date.now()) {
    throw new Error('retroactive_setting_not_allowed');  // BR-020
  }
  run(
    `INSERT INTO settings (id, key, value, effective_from, status, created_by, note, created_at)
     VALUES (?,?,?,?,'pending_approval',?,?,?)`,
    [id, params.key, JSON.stringify(params.value), params.effectiveFrom, params.createdBy, params.note ?? null, nowIso()],
  );
  audit({ actorId: params.createdBy, action: 'setting.proposed', entityType: 'setting', entityId: id, after: params.value });
  return id;
}

export function approveSetting(id: string, approverId: string): void {
  const row = get<any>(`SELECT * FROM settings WHERE id = ?`, [id]);
  if (!row) throw new Error('setting_not_found');
  if (row.created_by === approverId) throw new Error('dual_control_violation');
  if (row.status !== 'pending_approval') throw new Error('setting_not_pending');

  run(
    `UPDATE settings SET effective_to = ?
      WHERE key = ? AND status = 'active' AND (effective_to IS NULL OR effective_to > ?)`,
    [row.effective_from, row.key, row.effective_from],
  );
  run(`UPDATE settings SET status = 'active', approved_by = ?, approved_at = ? WHERE id = ?`,
      [approverId, nowIso(), id]);
  audit({ actorId: approverId, action: 'setting.approved', entityType: 'setting', entityId: id, after: JSON.parse(row.value) });
}

export function settingHistory(key: string) {
  return all(`SELECT * FROM settings WHERE key = ? ORDER BY effective_from DESC`, [key]);
}

/** BR-013 — screen investor-facing copy for guarantee language before publication. */
export function findBannedTerms(text: string): string[] {
  const banned = getSetting<{ ar: string[]; en: string[] }>(SETTING_KEYS.bannedTerms);
  const haystack = text.toLowerCase();
  return [...banned.ar, ...banned.en].filter((term) => haystack.includes(term.toLowerCase()));
}
