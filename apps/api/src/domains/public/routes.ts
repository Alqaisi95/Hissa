/** Public site content: how it works, risks, fees, FAQ, banner (PRD §6 "Public"). */
import { Router } from 'express';
import { all, get } from '../../db/index.ts';
import { nowIso } from '../../lib/ids.ts';
import { fees, poolPolicy, limits } from '../../lib/settings.ts';
import { LEGAL_DOCUMENTS } from '../../lib/legal.ts';
import { track } from '../analytics/track.ts';

export const publicRouter = Router();

publicRouter.get('/how-it-works', (_req, res) => {
  const policy = poolPolicy();
  res.json({
    // Doc §9 — the pool lifecycle as the public sees it.
    investorSteps: [
      { step: 1, titleAr: 'أنشئ حسابك وتحقق من هويتك', bodyAr: 'تسجيل بالبريد أو الهاتف مع رمز تحقق، ثم تحقق إلكتروني من الهوية عبر الشريك المرخّص.' },
      { step: 2, titleAr: 'أكمل اختبار الملاءمة', bodyAr: 'أسئلة قصيرة تتأكد من فهمك لمخاطر خسارة رأس المال والسيولة قبل أي استثمار.' },
      { step: 3, titleAr: 'اطّلع على الفرصة ومذكرة الإفصاح', bodyAr: 'استخدام محدد للأموال، بيانات تاريخية، سيناريوهات متحفظة وأساسية، حقوق وخروج ومخاطر ورسوم.' },
      { step: 4, titleAr: 'حدد مبلغك وأقرّ بالمخاطر', bodyAr: 'يفحص النظام أهليتك وحدودك تلقائيًا ويعرض المبلغ المتاح لك.' },
      { step: 5, titleAr: 'ادفع عبر حساب الضمان', bodyAr: 'تُحوَّل الأموال إلى حساب ضمان منفصل لدى الشريك أو البنك، ولا تدخل حساب حِصّة التشغيلي.' },
      { step: 6, titleAr: 'تابع مشروعك', bodyAr: 'تقارير دورية، مؤشرات فعلية مقابل التوقعات، توزيعات من نقد محقق، وإشعارات عند أي تغيير جوهري.' },
    ],
    ownerSteps: [
      { step: 1, titleAr: 'سجل شركتك', bodyAr: 'السجل التجاري، النشاط، الملاك المستفيدون والمفوضون.' },
      { step: 2, titleAr: 'قدّم مشروع التوسع', bodyAr: 'خطة استخدام الأموال ببنود وعروض أسعار، ومستندات مالية وتشغيلية.' },
      { step: 3, titleAr: 'اجتز العناية الواجبة', bodyAr: 'قائمة مراجعة موحدة، طلبات استكمال بمواعيد، ونموذج مخاطر موزون.' },
      { step: 4, titleAr: 'قرار لجنة الاستثمار', bodyAr: 'قرار مسبب: قبول أو قبول مشروط أو رفض، مع الشروط السابقة للنشر.' },
      { step: 5, titleAr: 'أودع مساهمتك ثم انشر', bodyAr: 'تودع مساهمتك أولًا، ثم تُنشر الفرصة وتُجمع الالتزامات.' },
      { step: 6, titleAr: 'استلم التمويل مرحليًا وقدّم التقارير', bodyAr: 'يُصرف للمورد أو وفق مراحل موثقة، مع تقارير دورية والتزام بالتعهدات.' },
    ],
    keyRules: {
      allOrNothing: policy.allOrNothing,
      minTicketOmr: policy.minTicket / 1000,
      poolSizeBandOmr: [policy.minPoolSize / 1000, policy.maxPoolSize / 1000],
      ownerContributionBand: [policy.ownerContributionMinBps / 100, policy.ownerContributionMaxBps / 100],
      campaignDays: policy.defaultCampaignDays,
      minTradingMonths: policy.minTradingMonths,
      secondaryMarket: false,
    },
  });
});

publicRouter.get('/risks', (_req, res) => {
  const disclosure = LEGAL_DOCUMENTS.find((d) => d.key === 'risk_disclosure')!;
  res.json({
    version: disclosure.version,
    titleAr: disclosure.titleAr, titleEn: disclosure.titleEn,
    bodyAr: disclosure.bodyAr, bodyEn: disclosure.bodyEn,
    // BR-013 — a standing, unmissable warning on every investment decision page.
    headlineAr: 'قد تخسر كامل المبلغ المستثمر. لا ضمان للعائد أو لرأس المال.',
    headlineEn: 'You may lose your entire investment. No return or capital is guaranteed.',
  });
});

publicRouter.get('/fees', (_req, res) => {
  const schedule = fees();
  const doc = LEGAL_DOCUMENTS.find((d) => d.key === 'fees')!;
  res.json({
    schedule: {
      assessmentFeeOmr: schedule.assessmentFee / 1000,
      successFeePercent: schedule.successFeeBps / 100,
      monitoringFeePercent: schedule.monitoringFeeBps / 100,
      investorFeeOmr: 0,
    },
    bodyAr: doc.bodyAr, bodyEn: doc.bodyEn, version: doc.version,
  });
});

/** BR-003..BR-006 — published investor limits, sourced from the effective-dated settings. */
publicRouter.get('/investor-limits', (_req, res) => {
  const l = limits();
  res.json({
    retail: { perIssuerOmr: l.retailPerIssuer / 1000, rolling12mOmr: l.retailRolling12m / 1000 },
    angel: { perIssuerOmr: null, rolling12mOmr: l.angelRolling12m / 1000 },
    sophisticated: { perIssuerOmr: null, rolling12mOmr: l.sophisticatedRolling12m ? l.sophisticatedRolling12m / 1000 : null },
    noteAr: 'الحدود المنشورة تُعاد المصادقة عليها مع المشغل المرخّص وهيئة الخدمات المالية قبل كل إطلاق.',
  });
});

publicRouter.get('/faq', (_req, res) => {
  res.json({
    items: [
      { q: 'هل حِصّة مرخّصة؟', a: 'تعمل حِصّة في نسختها الأولى من خلال مشغل تمويل جماعي مرخّص في سلطنة عُمان. جمع الأموال وتنفيذ الاستثمار يتم عبر الشريك المرخّص.' },
      { q: 'أين تُحفظ أموالي؟', a: 'في حساب ضمان منفصل لدى الشريك أو البنك. لا تدخل أموال المستثمرين حساب حِصّة التشغيلي.' },
      { q: 'ماذا يحدث إذا لم يكتمل التمويل؟', a: 'تعمل كل فرصة بقاعدة All-or-Nothing. إذا لم يتحقق الحد الأدنى في الموعد، لا يُصرف للمشروع وتُنشأ أوامر استرداد لكل الالتزامات المؤكدة.' },
      { q: 'هل يمكنني بيع حصتي؟', a: 'لا توجد سوق ثانوية في هذه المرحلة. الخروج يتم وفق الآلية المكتوبة في مستندات الفرصة فقط.' },
      { q: 'هل العائد مضمون؟', a: 'لا. لا تقدم حِصّة ولا الشريك أي ضمان للعائد أو لرأس المال. السيناريوهات المالية توقعات وليست وعودًا.' },
      { q: 'ما الحد الأدنى للاستثمار؟', a: `${poolPolicy().minTicket / 1000} ر.ع كحد أدنى مبدئي، وقد يختلف من فرصة لأخرى وفق مذكرة الإفصاح.` },
      { q: 'كيف تختارون المشاريع؟', a: 'مشاريع عُمانية قائمة منذ 12 شهرًا أو أكثر، ببيانات مالية قابلة للتحقق، وتوسع محدد له استخدام أموال مفصّل وعروض أسعار.' },
      { q: 'كيف تُصرف الأموال للمشروع؟', a: 'صرف مرحلي أو مباشر للموردين وفق ميزانية معتمدة ودليل على استيفاء الشرط، وبموافقة مزدوجة من شخصين مختلفين.' },
      { q: 'كيف أقدّم شكوى؟', a: 'من صفحة الشكاوى داخل حسابك. تحصل على رقم مرجعي ومدة استجابة محددة ويمكنك تتبع الحالة حتى الإغلاق.' },
      { q: 'ما الرسوم التي أدفعها كمستثمر؟', a: 'لا توجد رسوم على المستثمر في المرحلة التجريبية. رسوم الدراسة والنجاح والمتابعة يتحملها صاحب المشروع وفق مذكرة الإفصاح.' },
    ],
  });
});

/** FR-609 — the active incident/maintenance banner for the requesting audience. */
publicRouter.get('/banner', (req, res) => {
  const audience = req.auth?.roles.some((r) => !['investor', 'project_owner'].includes(r)) ? 'staff'
    : req.auth?.roles.includes('project_owner') ? 'owners' : 'investors';
  const at = nowIso();

  res.json({
    banner: get<any>(
      `SELECT id, message_ar, message_en, severity FROM banners
        WHERE starts_at <= ? AND ends_at > ? AND audience IN ('all', ?)
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END LIMIT 1`,
      [at, at, audience]) ?? null,
  });
});

/** Public trust stats — derived from real records, no marketing claims. */
publicRouter.get('/stats', (_req, res) => {
  const funded = get<any>(
    `SELECT COUNT(*) AS pools, SUM(target_amount) AS total FROM pools
      WHERE status IN ('funded','disbursement','operating','closed')`);
  track('home_viewed', null, {});
  res.json({
    fundedPools: funded?.pools ?? 0,
    fundedAmount: funded?.total ?? 0,
    livePools: get<{ n: number }>(`SELECT COUNT(*) AS n FROM pools WHERE status = 'funding'`)!.n,
    investors: get<{ n: number }>(
      `SELECT COUNT(DISTINCT investor_id) AS n FROM investment_orders WHERE status IN ('confirmed','allocated')`)!.n,
    reportsPublished: get<{ n: number }>(`SELECT COUNT(*) AS n FROM project_reports WHERE status = 'published'`)!.n,
    disclaimerAr: 'الأرقام تعكس سجلات المنصة ولا تمثل توقعًا لأداء مستقبلي.',
  });
});
