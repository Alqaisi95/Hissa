/**
 * FR-006 / BR-019 — versioned, dated policy texts. A consent stores the version
 * and a hash of the exact text the user saw, so it can be reproduced later.
 *
 * These are pilot drafts. PRD §13.3 / OD-02: final wording must be approved by
 * Omani counsel and the licensed operator before Go-Live.
 */
export interface LegalDocument {
  key: string;
  version: string;
  effectiveFrom: string;
  titleAr: string; titleEn: string;
  bodyAr: string; bodyEn: string;
}

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    key: 'terms',
    version: '1.0',
    effectiveFrom: '2026-01-01',
    titleAr: 'شروط الاستخدام',
    titleEn: 'Terms of Use',
    bodyAr: [
      'تعمل حِصّة كواجهة رقمية لعرض فرص تمويل جماعي، ويتم جمع الأموال وتنفيذ الاستثمار من خلال مشغل تمويل جماعي مرخّص في سلطنة عُمان.',
      'لا تحتفظ حِصّة بأموال المستثمرين في حسابها التشغيلي، وتودع الأموال في حساب ضمان منفصل لدى الشريك أو البنك.',
      'كل فرصة استثمارية تخضع لمذكرة إفصاح مستقلة ذات نسخة مؤرخة، وتُعد جزءًا لا يتجزأ من علاقتك التعاقدية.',
      'يخضع الاستثمار لحدود المستثمر المنشورة ولاختبار الملاءمة، ويجوز للنظام منع أي التزام يتجاوزها.',
      'لا توجد سوق ثانوية في هذه المرحلة؛ الخروج يتم وفق الآلية المكتوبة في مستندات الفرصة فقط.',
    ].join('\n\n'),
    bodyEn: [
      'Hissa operates as a digital front end for crowdfunding opportunities. Funds are collected and investments executed through a licensed crowdfunding operator in the Sultanate of Oman.',
      'Hissa does not hold investor money in its operating account. Funds are held in a segregated escrow account at the partner or bank.',
      'Each opportunity is governed by its own dated disclosure memorandum, which forms part of your contractual relationship.',
      'Investment is subject to published investor limits and to the suitability assessment. The system may block any commitment that exceeds them.',
      'There is no secondary market at this stage. Exit occurs only through the mechanism documented in the opportunity materials.',
    ].join('\n\n'),
  },
  {
    key: 'risk_disclosure',
    version: '1.0',
    effectiveFrom: '2026-01-01',
    titleAr: 'إفصاح المخاطر',
    titleEn: 'Risk Disclosure',
    bodyAr: [
      'خسارة رأس المال: قد تخسر كامل المبلغ المستثمر. لا تقدم حِصّة ولا الشريك المرخّص أي ضمان للعائد أو لرأس المال.',
      'مخاطر السيولة: لا توجد سوق ثانوية، وقد لا تتمكن من استرداد أموالك قبل انتهاء مدة المشروع.',
      'مخاطر التشغيل: قد يتأخر تنفيذ التوسع أو تنخفض الإيرادات عن التوقعات المنشورة.',
      'مخاطر القطاع والتركز: الاستثمار في مشروع واحد يعني تركز المخاطر؛ التنويع مسؤوليتك.',
      'مخاطر التعثر: قد يتوقف المشروع عن السداد أو التوزيع، وقد تستغرق إجراءات المعالجة وقتًا طويلًا.',
      'التوقعات المالية سيناريوهات وليست وعودًا، وقد تختلف النتائج الفعلية اختلافًا جوهريًا.',
    ].join('\n\n'),
    bodyEn: [
      'Capital loss: you may lose your entire investment. Neither Hissa nor the licensed operator guarantees any return or your capital.',
      'Liquidity risk: there is no secondary market and you may not be able to recover funds before the project term ends.',
      'Operational risk: the expansion may be delayed or revenue may fall short of published projections.',
      'Sector and concentration risk: investing in a single project concentrates risk. Diversification is your responsibility.',
      'Default risk: the project may stop paying or distributing, and workout procedures can take a long time.',
      'Financial projections are scenarios, not promises. Actual results may differ materially.',
    ].join('\n\n'),
  },
  {
    key: 'privacy',
    version: '1.0',
    effectiveFrom: '2026-01-01',
    titleAr: 'سياسة الخصوصية',
    titleEn: 'Privacy Policy',
    bodyAr: [
      'تُجمع بياناتك الشخصية لأغراض التحقق من الهوية، والامتثال لمكافحة غسل الأموال، وتنفيذ الاستثمار ومتابعته.',
      'يُصمم النظام بما يتوافق مع قانون حماية البيانات الشخصية الصادر بالمرسوم السلطاني 6/2022 ولائحته التنفيذية بالقرار الوزاري 34/2024.',
      'تُشارك البيانات مع المشغل المرخّص ومزودي التحقق والبنك بالقدر اللازم لتنفيذ الخدمة فقط.',
      'يحق لك طلب الوصول إلى بياناتك أو تصحيحها أو حذفها ضمن ما تسمح به الالتزامات القانونية وفترات الاحتفاظ المعتمدة.',
      'لا تُرسل أرقام الهوية أو الحسابات البنكية أو المستندات إلى أدوات التحليلات.',
    ].join('\n\n'),
    bodyEn: [
      'Your personal data is collected for identity verification, anti-money-laundering compliance, and executing and monitoring your investment.',
      'The system is designed to align with the Personal Data Protection Law (Royal Decree 6/2022) and its executive regulation (Ministerial Decision 34/2024).',
      'Data is shared with the licensed operator, verification providers and the bank only to the extent required to deliver the service.',
      'You may request access to, correction of, or deletion of your data within the limits of legal obligations and approved retention periods.',
      'ID numbers, bank account numbers and documents are never sent to analytics tools.',
    ].join('\n\n'),
  },
  {
    key: 'fees',
    version: '1.0',
    effectiveFrom: '2026-01-01',
    titleAr: 'جدول الرسوم',
    titleEn: 'Fee Schedule',
    bodyAr: [
      'رسوم دراسة وعناية واجبة: 750 ر.ع لكل مشروع مقبول للدراسة الكاملة، يتحملها صاحب المشروع.',
      'رسوم نجاح: 3% من المبلغ الممول، تُستحق عند الإغلاق الناجح ويتحملها صاحب المشروع أو الـSPV.',
      'رسوم متابعة وإدارة: 1% سنويًا من قيمة التمويل وفق العقد ومذكرة الإفصاح.',
      'لا توجد رسوم خفية، ولا رسوم أداء تشجع على رفع التوقعات. تُعرض جميع الرسوم قبل تأكيد الالتزام.',
    ].join('\n\n'),
    bodyEn: [
      'Assessment and due diligence fee: OMR 750 per project accepted for full study, borne by the project owner.',
      'Success fee: 3% of the funded amount, due on successful closing, borne by the project owner or the SPV.',
      'Monitoring and administration fee: 1% per year of the funded amount, per the contract and disclosure memorandum.',
      'There are no hidden fees and no performance fees that would encourage inflated projections. All fees are shown before you confirm a commitment.',
    ].join('\n\n'),
  },
];

export const documentByKey = (key: string, version?: string): LegalDocument | undefined =>
  LEGAL_DOCUMENTS.find((d) => d.key === key && (!version || d.version === version));
