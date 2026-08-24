/** Static-content pages backed by the API so policy copy has a single source. */
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery } from '../../lib/useApi.ts';
import { Card, Loading, ErrorNotice, Stat, RiskNotice } from '../../components/ui.tsx';

export function HowItWorks() {
  const { t, pick, locale } = useI18n();
  const guide = useQuery<any>('/public/how-it-works');
  if (guide.loading) return <Loading rows={6} />;
  if (guide.error) return <ErrorNotice error={guide.error} onRetry={guide.reload} />;

  const rules = guide.data.keyRules;
  return (
    <div className="stack">
      <h1>{t('navHowItWorks')}</h1>

      <div className="grid grid--two">
        <Card title={locale === 'ar' ? 'للمستثمر' : 'For investors'}>
          <ol className="steps">
            {guide.data.investorSteps.map((step: any) => (
              <li key={step.step}>
                <span className="steps__num" aria-hidden="true">{step.step}</span>
                <div>
                  <strong>{pick(step.titleAr, step.titleEn)}</strong>
                  <p className="muted small" style={{ margin: '.15rem 0 0' }}>{pick(step.bodyAr, step.bodyEn)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card title={locale === 'ar' ? 'لصاحب المشروع' : 'For project owners'}>
          <ol className="steps">
            {guide.data.ownerSteps.map((step: any) => (
              <li key={step.step}>
                <span className="steps__num" aria-hidden="true">{step.step}</span>
                <div>
                  <strong>{pick(step.titleAr, step.titleEn)}</strong>
                  <p className="muted small" style={{ margin: '.15rem 0 0' }}>{pick(step.bodyAr, step.bodyEn)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card title={locale === 'ar' ? 'القواعد الحاكمة' : 'The rules that govern every pool'}>
        <div className="grid grid--stats">
          <Stat label={locale === 'ar' ? 'قاعدة التمويل' : 'Funding rule'}
                value={rules.allOrNothing ? 'All-or-Nothing' : '—'}
                sub={locale === 'ar' ? 'لا صرف قبل بلوغ الحد الأدنى' : 'No disbursement below the minimum'} />
          <Stat label={locale === 'ar' ? 'الحد الأدنى للاستثمار' : 'Minimum investment'}
                value={`${rules.minTicketOmr} ${locale === 'ar' ? 'ر.ع' : 'OMR'}`} />
          <Stat label={locale === 'ar' ? 'حجم الفرصة' : 'Pool size'}
                value={`${rules.poolSizeBandOmr[0].toLocaleString()}–${rules.poolSizeBandOmr[1].toLocaleString()}`}
                sub={locale === 'ar' ? 'ر.ع' : 'OMR'} />
          <Stat label={locale === 'ar' ? 'مساهمة صاحب المشروع' : 'Owner contribution'}
                value={`${rules.ownerContributionBand[0]}–${rules.ownerContributionBand[1]}%`} />
          <Stat label={locale === 'ar' ? 'مدة الحملة' : 'Campaign window'}
                value={`${rules.campaignDays} ${locale === 'ar' ? 'يومًا' : 'days'}`} />
          <Stat label={locale === 'ar' ? 'سجل تشغيلي مطلوب' : 'Trading history required'}
                value={`${rules.minTradingMonths} ${locale === 'ar' ? 'شهرًا' : 'months'}`} />
          <Stat label={locale === 'ar' ? 'سوق ثانوية' : 'Secondary market'}
                value={locale === 'ar' ? 'لا' : 'No'}
                sub={locale === 'ar' ? 'الخروج وفق آلية العقد فقط' : 'Exit only via the documented mechanism'} />
        </div>
      </Card>

      <Limits />
    </div>
  );
}

function Limits() {
  const { locale } = useI18n();
  const limits = useQuery<any>('/public/investor-limits');
  if (limits.loading || !limits.data) return null;

  const unit = locale === 'ar' ? 'ر.ع' : 'OMR';
  const rows = [
    ['retail', locale === 'ar' ? 'مستثمر أفراد' : 'Retail investor'],
    ['angel', locale === 'ar' ? 'مستثمر ملائكي' : 'Angel investor'],
    ['sophisticated', locale === 'ar' ? 'مستثمر متمرس' : 'Sophisticated investor'],
  ] as const;

  return (
    <Card title={locale === 'ar' ? 'حدود المستثمر المنشورة' : 'Published investor limits'}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{locale === 'ar' ? 'التصنيف' : 'Classification'}</th>
              <th>{locale === 'ar' ? 'لكل متقدم تمويل' : 'Per issuer'}</th>
              <th>{locale === 'ar' ? 'خلال 12 شهرًا' : 'Rolling 12 months'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                <td className="num">{limits.data[key].perIssuerOmr ? `${limits.data[key].perIssuerOmr.toLocaleString()} ${unit}` : '—'}</td>
                <td className="num">{limits.data[key].rolling12mOmr ? `${limits.data[key].rolling12mOmr.toLocaleString()} ${unit}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginBlockStart: '.75rem', marginBlockEnd: 0 }}>{limits.data.noteAr}</p>
    </Card>
  );
}

export function Risks() {
  const { t, pick } = useI18n();
  const risks = useQuery<any>('/public/risks');
  if (risks.loading) return <Loading rows={6} />;
  if (risks.error) return <ErrorNotice error={risks.error} onRetry={risks.reload} />;

  return (
    <div className="stack">
      <h1>{t('riskTitle')}</h1>
      <RiskNotice />
      <Card>
        <div className="stack-sm">
          {pick(risks.data.bodyAr, risks.data.bodyEn).split('\n\n').map((paragraph: string, index: number) => (
            <p key={index} style={{ margin: 0 }}>{paragraph}</p>
          ))}
        </div>
        <p className="small muted" style={{ marginBlockStart: '1rem', marginBlockEnd: 0 }}>
          {t('disclosureVersion')}: {risks.data.version}
        </p>
      </Card>
    </div>
  );
}

export function Fees() {
  const { t, pick, locale } = useI18n();
  const fees = useQuery<any>('/public/fees');
  if (fees.loading) return <Loading rows={5} />;
  if (fees.error) return <ErrorNotice error={fees.error} onRetry={fees.reload} />;

  const schedule = fees.data.schedule;
  return (
    <div className="stack">
      <h1>{t('navFees')}</h1>
      <div className="grid grid--stats">
        <Stat label={locale === 'ar' ? 'رسوم الدراسة' : 'Assessment fee'}
              value={`${schedule.assessmentFeeOmr} ${locale === 'ar' ? 'ر.ع' : 'OMR'}`}
              sub={locale === 'ar' ? 'يتحملها صاحب المشروع' : 'Borne by the project owner'} />
        <Stat label={locale === 'ar' ? 'رسوم النجاح' : 'Success fee'} value={`${schedule.successFeePercent}%`}
              sub={locale === 'ar' ? 'من المبلغ الممول' : 'Of the funded amount'} />
        <Stat label={locale === 'ar' ? 'رسوم المتابعة' : 'Monitoring fee'} value={`${schedule.monitoringFeePercent}%`}
              sub={locale === 'ar' ? 'سنويًا وفق العقد' : 'Per year, per the contract'} />
        <Stat label={t('investorFee')} value={`${schedule.investorFeeOmr} ${locale === 'ar' ? 'ر.ع' : 'OMR'}`}
              sub={locale === 'ar' ? 'في المرحلة التجريبية' : 'During the pilot'} />
      </div>
      <Card>
        <div className="stack-sm">
          {pick(fees.data.bodyAr, fees.data.bodyEn).split('\n\n').map((paragraph: string, index: number) => (
            <p key={index} style={{ margin: 0 }}>{paragraph}</p>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function Faq() {
  const { t } = useI18n();
  const faq = useQuery<any>('/public/faq');
  if (faq.loading) return <Loading rows={6} />;

  return (
    <div className="stack">
      <h1>{t('navFaq')}</h1>
      <div className="stack-sm">
        {(faq.data?.items ?? []).map((item: any, index: number) => (
          <details key={index} className="card">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{item.q}</summary>
            <p className="muted" style={{ marginBlockStart: '.6rem', marginBlockEnd: 0 }}>{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
