/**
 * FR-005 — suitability assessment and risk-understanding acknowledgement.
 * Questions are weighted; the result gates or warns per policy, and both the
 * answers and the model version are retained as evidence.
 */
export const SUITABILITY_VERSION = 'suitability-v1';

export interface Question {
  code: string;
  textAr: string;
  textEn: string;
  options: { value: string; labelAr: string; labelEn: string; score: number }[];
  /** A wrong answer here means the investor has not understood a core risk. */
  knockout?: string[];
}

export const QUESTIONS: Question[] = [
  {
    code: 'capital_loss',
    textAr: 'إذا تعثر المشروع الممول، ما الذي قد يحدث لأموالك؟',
    textEn: 'If the funded project fails, what may happen to your money?',
    options: [
      { value: 'full_loss', labelAr: 'قد أخسر كامل المبلغ المستثمر', labelEn: 'I may lose my entire investment', score: 25 },
      { value: 'partial', labelAr: 'أخسر جزءًا فقط بحد أقصى', labelEn: 'I can only lose part of it', score: 5 },
      { value: 'protected', labelAr: 'رأس المال محمي من المنصة', labelEn: 'My capital is protected by the platform', score: 0 },
    ],
    knockout: ['protected'],
  },
  {
    code: 'liquidity',
    textAr: 'متى يمكنك استرداد استثمارك؟',
    textEn: 'When can you get your investment back?',
    options: [
      { value: 'no_secondary', labelAr: 'لا توجد سوق ثانوية؛ الاسترداد وفق آلية الخروج المكتوبة فقط', labelEn: 'There is no secondary market; only via the documented exit', score: 25 },
      { value: 'anytime', labelAr: 'في أي وقت عبر بيع حصتي على المنصة', labelEn: 'Any time by selling on the platform', score: 0 },
      { value: 'monthly', labelAr: 'شهريًا عند طلب الاسترداد', labelEn: 'Monthly on request', score: 0 },
    ],
    knockout: ['anytime', 'monthly'],
  },
  {
    code: 'diversification',
    textAr: 'ما النسبة المناسبة من مدخراتك لهذا النوع من الاستثمار؟',
    textEn: 'What share of your savings suits this type of investment?',
    options: [
      { value: 'small', labelAr: 'جزء صغير يمكنني تحمل خسارته', labelEn: 'A small share I can afford to lose', score: 25 },
      { value: 'half', labelAr: 'نحو النصف', labelEn: 'About half', score: 10 },
      { value: 'all', labelAr: 'كل مدخراتي', labelEn: 'All of my savings', score: 0 },
    ],
    knockout: ['all'],
  },
  {
    code: 'returns',
    textAr: 'هل العوائد المعروضة في مذكرة الإفصاح مضمونة؟',
    textEn: 'Are the returns shown in the disclosure guaranteed?',
    options: [
      { value: 'projection', labelAr: 'لا، هي توقعات مبنية على افتراضات قد لا تتحقق', labelEn: 'No — they are projections based on assumptions', score: 25 },
      { value: 'guaranteed', labelAr: 'نعم، مضمونة تعاقديًا', labelEn: 'Yes, contractually guaranteed', score: 0 },
    ],
    knockout: ['guaranteed'],
  },
];

export interface SuitabilityOutcome {
  score: number;
  result: 'pass' | 'warn' | 'restricted';
  version: string;
  failedCodes: string[];
}

export function scoreSuitability(answers: Record<string, string>): SuitabilityOutcome {
  let score = 0;
  const failedCodes: string[] = [];

  for (const question of QUESTIONS) {
    const answer = answers[question.code];
    const option = question.options.find((o) => o.value === answer);
    score += option?.score ?? 0;
    if (!option || question.knockout?.includes(answer)) failedCodes.push(question.code);
  }

  // A knockout answer means a core risk was misunderstood → restricted, never a warning.
  const result: SuitabilityOutcome['result'] =
    failedCodes.length > 0 ? 'restricted' : score >= 90 ? 'pass' : 'warn';

  return { score, result, version: SUITABILITY_VERSION, failedCodes };
}

/** FR-002 — classification evidence rules, configurable and auditable. */
export function proposeClassification(evidence: {
  netWorthOmr?: number; annualIncomeOmr?: number; professionalCertification?: boolean; priorDeals?: number;
}): 'retail' | 'angel' | 'sophisticated' {
  if (evidence.professionalCertification || (evidence.priorDeals ?? 0) >= 10) return 'sophisticated';
  if ((evidence.netWorthOmr ?? 0) >= 250_000 || (evidence.annualIncomeOmr ?? 0) >= 60_000) return 'angel';
  return 'retail';
}
