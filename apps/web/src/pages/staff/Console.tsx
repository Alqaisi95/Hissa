/**
 * The staff console (PRD §6 Investment Ops / Funds Ops / Compliance / Admin).
 * Every action here mirrors a server-side permission; the UI never offers a
 * button the API would refuse, and dual-control steps say so plainly.
 */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery } from '../../lib/useApi.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Card, ErrorNotice, Loading, Stat, Tabs } from '../../components/ui.tsx';
import { DueDiligence } from './DueDiligence.tsx';
import { Committee } from './Committee.tsx';
import { FundsOps } from './FundsOps.tsx';
import { ComplianceOps } from './ComplianceOps.tsx';
import { Monitoring } from './Monitoring.tsx';
import { AdminSettings } from './AdminSettings.tsx';

type TabKey = 'overview' | 'dd' | 'committee' | 'funds' | 'monitoring' | 'compliance' | 'admin';

export function Console() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const [tab, setTab] = useState<TabKey>('overview');
  const dashboard = useQuery<any>('/admin/dashboard');

  const tabs: { key: TabKey; label: string; visible: boolean }[] = [
    { key: 'overview', label: t('consoleTitle'), visible: true },
    { key: 'dd', label: t('queueDd'), visible: auth.has('investment_analyst', 'compliance', 'auditor') },
    { key: 'committee', label: t('queueCommittee'), visible: auth.has('committee_member', 'investment_analyst', 'compliance', 'auditor') },
    { key: 'funds', label: t('queueFunds'), visible: auth.has('finance_ops', 'compliance', 'auditor') },
    { key: 'monitoring', label: locale === 'ar' ? 'المتابعة' : 'Monitoring', visible: auth.has('portfolio_ops', 'compliance', 'auditor') },
    { key: 'compliance', label: locale === 'ar' ? 'الامتثال' : 'Compliance', visible: auth.has('compliance', 'auditor') },
    { key: 'admin', label: t('settingsTitle'), visible: auth.has('system_admin', 'compliance', 'auditor') },
  ];

  return (
    <div className="stack">
      <h1>{t('consoleTitle')}</h1>

      <Tabs<TabKey> active={tab} onChange={setTab}
                    tabs={tabs.filter((item) => item.visible).map(({ key, label }) => ({ key, label }))} />

      {tab === 'overview' ? (
        dashboard.loading ? <Loading rows={6} />
          : dashboard.error ? <ErrorNotice error={dashboard.error} onRetry={dashboard.reload} />
          : <Overview data={dashboard.data} />
      )
        : tab === 'dd' ? <DueDiligence />
        : tab === 'committee' ? <Committee />
        : tab === 'funds' ? <FundsOps />
        : tab === 'monitoring' ? <Monitoring />
        : tab === 'compliance' ? <ComplianceOps />
        : <AdminSettings />}
    </div>
  );
}

function Overview({ data }: { data: any }) {
  const { t, locale, formatOmr } = useI18n();
  const q = data.queues;

  return (
    <div className="stack">
      <Card title={locale === 'ar' ? 'قوائم العمل' : 'Work queues'}>
        <div className="grid grid--stats">
          <Stat label={t('queueKyc')} value={q.kycReview} />
          <Stat label={t('queueDd')} value={q.ddOpen} />
          <Stat label={t('queueCommittee')} value={q.committee} />
          <Stat label={t('queueFunds')} value={q.fundsApproval} />
          <Stat label={t('queueBreaks')} value={q.reconBreaks} />
          <Stat label={t('queueCases')} value={q.casesOverdue} />
          <Stat label={t('queueReports')} value={q.reportsLate} />
        </div>
      </Card>

      {/* §14.1 — the governing KPI definitions, computed from source-of-truth tables. */}
      <Card title={locale === 'ar' ? 'مؤشرات الأداء' : 'Key performance indicators'}>
        <div className="grid grid--stats">
          <Stat label="Funded GMV" value={formatOmr(data.kpis.fundedGmv, { decimals: 0 })} />
          <Stat label={locale === 'ar' ? 'زمن التمويل' : 'Funding time'}
                value={data.kpis.fundingTimeDaysAvg ?? '—'}
                sub={locale === 'ar' ? 'يومًا (متوسط)' : 'days (average)'} />
          <Stat label={locale === 'ar' ? 'اكتمال التحقق' : 'KYC completion'}
                value={data.kpis.kycCompletionRate === null ? '—' : `${data.kpis.kycCompletionRate}%`} />
          <Stat label={locale === 'ar' ? 'تحويل المستثمر' : 'Investor conversion'}
                value={data.kpis.investorConversionRate === null ? '—' : `${data.kpis.investorConversionRate}%`} />
          <Stat label={locale === 'ar' ? 'تقارير في موعدها' : 'On-time reports'}
                value={data.kpis.onTimeReportRate === null ? '—' : `${data.kpis.onTimeReportRate}%`} />
          <Stat label={locale === 'ar' ? 'فروقات متجاوزة SLA' : 'Breaks over SLA'}
                value={data.kpis.reconciliationBreaksOverSla} />
          <Stat label={locale === 'ar' ? 'مستثمر متكرر' : 'Repeat investor'}
                value={data.kpis.repeatInvestorRate === null ? '—' : `${data.kpis.repeatInvestorRate}%`} />
          <Stat label={locale === 'ar' ? 'شكاوى ضمن SLA' : 'Complaints in SLA'}
                value={data.kpis.complaintSlaRate === null ? '—' : `${data.kpis.complaintSlaRate}%`} />
        </div>
      </Card>

      <div className="grid grid--two">
        <Card title={locale === 'ar' ? 'مسار المشاريع' : 'Project pipeline'}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t('status')}</th><th>{locale === 'ar' ? 'العدد' : 'Count'}</th></tr></thead>
              <tbody>
                {data.pipeline.map((row: any) => (
                  <tr key={row.status}><td>{row.status}</td><td className="num">{row.count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={locale === 'ar' ? 'الفرص' : 'Pools'}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>{t('status')}</th><th>{locale === 'ar' ? 'العدد' : 'Count'}</th><th>{t('target')}</th></tr>
              </thead>
              <tbody>
                {data.pools.map((row: any) => (
                  <tr key={row.status}>
                    <td>{row.status}</td>
                    <td className="num">{row.count}</td>
                    <td className="num">{formatOmr(row.target, { decimals: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card title={locale === 'ar' ? 'قمع التحويل' : 'Conversion funnel'}>
        <div className="grid grid--stats">
          {Object.entries(data.kpis.funnel).map(([key, value]) => (
            <Stat key={key} label={key} value={String(value)} />
          ))}
        </div>
      </Card>
    </div>
  );
}
