/**
 * Operations dashboard (PRD §14). Summary before detail: what needs attention
 * reads at a glance from the health row, and the plots below explain why.
 */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery } from '../../lib/useApi.ts';
import { Card, ErrorNotice, Loading, Stat, statusLabel } from '../../components/ui.tsx';
import {
  TrendChart, BarList, FunnelChart, HealthTile, ProgressMeter, Sparkline, compactNumber,
} from '../../components/charts.tsx';

const WINDOWS = [30, 90, 180, 365];

export function Dashboard() {
  const { t, locale, formatOmr, formatDate } = useI18n();
  const [windowDays, setWindowDays] = useState(90);
  const data = useQuery<any>(`/analytics/overview?windowDays=${windowDays}`, [windowDays]);

  if (data.loading) return <Loading rows={8} />;
  if (data.error) return <ErrorNotice error={data.error} onRetry={data.reload} />;
  if (!data.data) return null;

  const d = data.data;
  const k = d.kpis;
  const omr0 = (v: number) => formatOmr(v, { decimals: 0 });
  const plain = (v: number) => new Intl.NumberFormat(locale === 'ar' ? 'ar-OM-u-nu-latn' : 'en-OM').format(Math.round(v));

  // Health states use the reserved status scale and always ship a word, not a colour alone.
  const reconState = d.health.reconciliationOverSla > 0 ? 'critical'
    : d.health.reconciliationOpen > 0 ? 'warning' : 'good';
  const caseState = d.health.casesOverSla > 2 ? 'critical'
    : d.health.casesOverSla > 0 ? 'serious' : d.health.casesOpen > 0 ? 'warning' : 'good';
  const reportState = d.health.reportsLate > 2 ? 'critical'
    : d.health.reportsLate > 0 ? 'serious' : 'good';
  const fundsState = d.health.fundsAwaitingApproval > 4 ? 'warning' : 'good';

  const commitmentSeries = d.commitments.map((c: any) => ({ label: c.date.slice(5), value: c.cumulative }));
  const dailySeries = d.commitments.map((c: any) => c.amount);

  return (
    <div className="dash">
      <div className="dash__filters">
        <div className="field" style={{ minWidth: 170 }}>
          <label htmlFor="win">{locale === 'ar' ? 'الفترة' : 'Period'}</label>
          <select id="win" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {locale === 'ar' ? `آخر ${w} يومًا` : `Last ${w} days`}
              </option>
            ))}
          </select>
        </div>
        <span className="small muted" style={{ paddingBlockEnd: '.5rem' }}>
          {formatDate(`${d.window.from}T00:00:00Z`)} — {formatDate(`${d.window.to}T00:00:00Z`)}
        </span>
      </div>

      {/* What needs attention, first. */}
      <div className="chart-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <HealthTile
          label={locale === 'ar' ? 'فروقات المطابقة' : 'Reconciliation breaks'}
          value={d.health.reconciliationOpen} state={reconState}
          hint={d.health.reconciliationOverSla > 0
            ? (locale === 'ar' ? `${d.health.reconciliationOverSla} تجاوزت SLA` : `${d.health.reconciliationOverSla} over SLA`)
            : (locale === 'ar' ? 'لا فروقات متأخرة' : 'None overdue')} />
        <HealthTile
          label={locale === 'ar' ? 'حالات مفتوحة' : 'Open cases'}
          value={d.health.casesOpen} state={caseState}
          hint={locale === 'ar' ? `${d.health.casesOverSla} تجاوزت SLA` : `${d.health.casesOverSla} over SLA`} />
        <HealthTile
          label={locale === 'ar' ? 'تقارير متأخرة' : 'Late reports'}
          value={d.health.reportsLate} state={reportState}
          hint={locale === 'ar' ? `${d.health.reportsDue} مستحقة قريبًا` : `${d.health.reportsDue} due soon`} />
        <HealthTile
          label={locale === 'ar' ? 'بانتظار اعتماد مالي' : 'Awaiting money approval'}
          value={d.health.fundsAwaitingApproval} state={fundsState}
          hint={locale === 'ar' ? 'يلزم مُعتمد ثانٍ' : 'Needs a second approver'} />
      </div>

      <div className="chart-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Stat label="Funded GMV" value={omr0(k.fundedGmv)}
              sub={<Sparkline values={dailySeries} />} />
        <Stat label={locale === 'ar' ? 'زمن التمويل' : 'Funding time'}
              value={k.fundingTimeDaysAvg ?? '—'}
              sub={locale === 'ar' ? 'يومًا (متوسط)' : 'days (average)'} />
        <Stat label={locale === 'ar' ? 'اكتمال التحقق' : 'KYC completion'}
              value={k.kycCompletionRate === null ? '—' : `${k.kycCompletionRate}%`} />
        <Stat label={locale === 'ar' ? 'تقارير في موعدها' : 'On-time reports'}
              value={k.onTimeReportRate === null ? '—' : `${k.onTimeReportRate}%`} />
        <Stat label={locale === 'ar' ? 'مستثمر متكرر' : 'Repeat investor'}
              value={k.repeatInvestorRate === null ? '—' : `${k.repeatInvestorRate}%`} />
      </div>

      <Card>
        <TrendChart
          title={locale === 'ar' ? 'الالتزامات التراكمية' : 'Cumulative commitments'}
          subtitle={locale === 'ar'
            ? 'مجموع ما التزم به المستثمرون منذ بداية الفترة'
            : 'Everything investors have committed since the period opened'}
          points={commitmentSeries}
          valueFormat={omr0}
          tickFormat={(v) => compactNumber(v / 1000)}
        />
      </Card>

      <div className="chart-grid chart-grid--wide">
        <Card>
          <FunnelChart
            title={locale === 'ar' ? 'قمع التحويل' : 'Conversion funnel'}
            subtitle={locale === 'ar'
              ? 'كل مرحلة مجموعة فرعية من التي قبلها — النسبة من المرحلة السابقة'
              : 'Each stage is a subset of the one before it — the share carried forward'}
            stages={d.funnel.map((f: any) => ({
              label: locale === 'ar' ? f.labelAr : f.labelEn, value: f.value,
            }))}
          />
        </Card>

        <Card>
          <BarList
            title={locale === 'ar' ? 'الفرص حسب الحالة' : 'Pools by status'}
            subtitle={locale === 'ar' ? 'العدد في كل حالة' : 'Count in each state'}
            items={d.poolStatus.map((p: any) => ({ label: statusLabel(p.status, locale), value: p.count }))}
            valueFormat={plain}
          />
        </Card>
      </div>

      <div className="chart-grid">
        <Card>
          <BarList
            title={locale === 'ar' ? 'التمويل حسب القطاع' : 'Funding by sector'}
            subtitle={locale === 'ar' ? 'المبالغ المخصصة فعليًا' : 'Amounts actually allocated'}
            items={d.sectors.filter((s: any) => s.funded > 0)
              .map((s: any) => ({ label: s.sector, value: s.funded }))}
            valueFormat={omr0}
          />
        </Card>

        <Card title={locale === 'ar' ? 'مسار الصرف' : 'Disbursement pipeline'}>
          <div className="stack">
            <ProgressMeter
              label={locale === 'ar' ? 'معتمد من المخطط' : 'Approved of planned'}
              value={d.disbursement.approved} target={Math.max(1, d.disbursement.planned)}
              valueFormat={omr0} />
            <ProgressMeter
              label={locale === 'ar' ? 'منفّذ من المعتمد' : 'Executed of approved'}
              value={d.disbursement.executed} target={Math.max(1, d.disbursement.approved)}
              valueFormat={omr0} tone="good" />
            <p className="small muted" style={{ margin: 0 }}>
              {locale === 'ar'
                ? 'لا يُصرف شيء قبل استيفاء شرط المرحلة بدليل، وباعتماد شخص غير من أنشأ الطلب.'
                : 'Nothing is disbursed before the milestone condition is met with evidence, and approved by someone other than the requester.'}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
