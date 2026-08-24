/**
 * FR-106 — versioned weighted risk model. The score, its inputs and the model
 * version are all stored, so any past decision can be reproduced exactly.
 */
export const RISK_MODEL_VERSION = 'risk-model-v1';

export interface RiskInputs {
  monthsTrading: number;            // operating history (Doc §7.3: ≥12 months)
  revenueStabilityBps: number;      // 0..10000 — inverse of revenue volatility
  ownerContributionBps: number;     // BR-011: 2000..3000 target band
  dataQuality: 'bank_api' | 'pos_api' | 'statement_upload' | 'none';
  useOfFundsSpecificity: 'itemised_quotes' | 'partial' | 'narrative';
  sectorRisk: 'low' | 'medium' | 'high';
  managementDepth: 'team' | 'owner_plus' | 'owner_only';
  existingLeverageBps: number;      // debt / annual revenue
  licensesComplete: boolean;
  supplierConcentrationBps: number; // share from the largest supplier
}

interface Factor { code: string; labelAr: string; weight: number; score: (i: RiskInputs) => number }

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v));

export const FACTORS: Factor[] = [
  {
    code: 'track_record', labelAr: 'السجل التشغيلي', weight: 20,
    score: (i) => clamp(Math.round((Math.min(i.monthsTrading, 36) / 36) * 100)),
  },
  {
    code: 'revenue_stability', labelAr: 'استقرار الإيرادات', weight: 18,
    score: (i) => clamp(Math.round(i.revenueStabilityBps / 100)),
  },
  {
    code: 'data_quality', labelAr: 'جودة البيانات', weight: 15,
    score: (i) => ({ bank_api: 100, pos_api: 95, statement_upload: 60, none: 0 })[i.dataQuality],
  },
  {
    code: 'owner_alignment', labelAr: 'مواءمة حوافز صاحب المشروع', weight: 15,
    // Full marks inside the 20–30% band; partial credit below, no extra above.
    score: (i) => i.ownerContributionBps >= 2000 ? 100 : clamp(Math.round((i.ownerContributionBps / 2000) * 100)),
  },
  {
    code: 'use_of_funds', labelAr: 'تحديد استخدام الأموال', weight: 12,
    score: (i) => ({ itemised_quotes: 100, partial: 55, narrative: 15 })[i.useOfFundsSpecificity],
  },
  {
    code: 'sector', labelAr: 'مخاطر القطاع', weight: 8,
    score: (i) => ({ low: 100, medium: 65, high: 30 })[i.sectorRisk],
  },
  {
    code: 'management', labelAr: 'عمق الإدارة', weight: 5,
    score: (i) => ({ team: 100, owner_plus: 65, owner_only: 35 })[i.managementDepth],
  },
  {
    code: 'leverage', labelAr: 'الرفع المالي القائم', weight: 4,
    score: (i) => clamp(100 - Math.round(i.existingLeverageBps / 100)),
  },
  {
    code: 'compliance', labelAr: 'اكتمال التراخيص', weight: 2,
    score: (i) => (i.licensesComplete ? 100 : 0),
  },
  {
    code: 'concentration', labelAr: 'تركز الموردين', weight: 1,
    score: (i) => clamp(100 - Math.round(i.supplierConcentrationBps / 100)),
  },
];

export interface RiskOutcome {
  version: string;
  score: number;                     // 0..100, higher = lower risk
  grade: 'A' | 'B' | 'C' | 'D' | 'E';
  breakdown: { code: string; labelAr: string; weight: number; raw: number; weighted: number }[];
  flags: string[];
}

export function scoreRisk(inputs: RiskInputs): RiskOutcome {
  const breakdown = FACTORS.map((factor) => {
    const raw = factor.score(inputs);
    return { code: factor.code, labelAr: factor.labelAr, weight: factor.weight, raw, weighted: (raw * factor.weight) / 100 };
  });

  const score = Math.round(breakdown.reduce((sum, f) => sum + f.weighted, 0));
  const grade: RiskOutcome['grade'] =
    score >= 85 ? 'A' : score >= 72 ? 'B' : score >= 58 ? 'C' : score >= 45 ? 'D' : 'E';

  const flags: string[] = [];
  // Doc §7.3 / BR-011 — hard eligibility screens surfaced to the committee.
  if (inputs.monthsTrading < 12) flags.push('operating_history_below_12_months');
  if (inputs.ownerContributionBps < 2000) flags.push('owner_contribution_below_policy');
  if (inputs.ownerContributionBps > 3000) flags.push('owner_contribution_above_policy_band');
  if (inputs.dataQuality === 'none') flags.push('no_verifiable_financial_data');
  if (!inputs.licensesComplete) flags.push('licences_incomplete');
  if (inputs.useOfFundsSpecificity === 'narrative') flags.push('use_of_funds_not_itemised');

  return { version: RISK_MODEL_VERSION, score, grade, breakdown, flags };
}

/** Standard due-diligence checklist instantiated per case (FR-105). */
export const DD_CHECKLIST: { code: string; labelAr: string; mandatory: boolean }[] = [
  { code: 'cr_valid', labelAr: 'سجل تجاري ساري ونشاط مطابق', mandatory: true },
  { code: 'licences', labelAr: 'التراخيص البلدية والقطاعية', mandatory: true },
  { code: 'ubo_screened', labelAr: 'فحص المالك المستفيد والعقوبات وPEP', mandatory: true },
  { code: 'bank_12m', labelAr: 'كشف بنكي 12 شهرًا أو ربط API', mandatory: true },
  { code: 'pos_data', labelAr: 'بيانات نقاط البيع أو المبيعات', mandatory: true },
  { code: 'financials', labelAr: 'قوائم مالية أو ملخص مالي موثق', mandatory: true },
  { code: 'use_of_funds_quotes', labelAr: 'عروض أسعار للموردين تغطي استخدام الأموال', mandatory: true },
  { code: 'lease_or_site', labelAr: 'عقد الموقع أو دراسة الموقع للفرع الجديد', mandatory: true },
  { code: 'owner_contribution_proof', labelAr: 'إثبات قدرة صاحب المشروع على المساهمة', mandatory: true },
  { code: 'existing_debt', labelAr: 'إفصاح الالتزامات والقروض القائمة', mandatory: true },
  { code: 'insurance', labelAr: 'التأمين على الأصول التشغيلية', mandatory: false },
  { code: 'site_visit', labelAr: 'زيارة ميدانية موثقة', mandatory: false },
  { code: 'reference_checks', labelAr: 'مراجع الموردين والعملاء', mandatory: false },
  { code: 'legal_opinion', labelAr: 'مراجعة قانونية للهيكل والعقود', mandatory: true },
];
