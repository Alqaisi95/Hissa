/**
 * FR-505 — the investor's own composition. Nominal amounts and realised
 * distributions only: the platform has no market price for a holding and does
 * not imply one.
 */
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery } from '../../lib/useApi.ts';
import { Card, Empty, ErrorNotice, Loading, statusLabel } from '../../components/ui.tsx';
import { BarList, TrendChart, compactNumber } from '../../components/charts.tsx';

export function PortfolioInsights() {
  const { locale, formatOmr } = useI18n();
  const insights = useQuery<any>('/analytics/me');

  if (insights.loading) return <Loading rows={5} />;
  if (insights.error) return <ErrorNotice error={insights.error} onRetry={insights.reload} />;
  if (!insights.data) return null;

  const d = insights.data;
  const omr0 = (v: number) => formatOmr(v, { decimals: 0 });

  const hasAnything = d.bySector.length > 0 || d.distributionTimeline.length > 0;
  if (!hasAnything) {
    return <Card><Empty>{locale === 'ar' ? 'لا توجد ملكيات بعد لعرض تحليلها.' : 'No holdings yet to analyse.'}</Empty></Card>;
  }

  // Cumulative so the reader sees total received, not a per-period sawtooth.
  let running = 0;
  const distributions = d.distributionTimeline.map((row: any) => {
    running += row.amount;
    return { label: row.period, value: running };
  });

  return (
    <div className="dash">
      <div className="chart-grid">
        {d.bySector.length > 0 ? (
          <Card>
            <BarList
              title={locale === 'ar' ? 'التوزيع حسب القطاع' : 'Allocation by sector'}
              subtitle={locale === 'ar' ? 'المبلغ الاسمي المستثمر' : 'Nominal amount invested'}
              items={d.bySector.map((s: any) => ({ label: s.sector, value: s.amount }))}
              valueFormat={omr0}
            />
          </Card>
        ) : null}

        {d.byStatus.length > 0 ? (
          <Card>
            <BarList
              title={locale === 'ar' ? 'التوزيع حسب حالة الفرصة' : 'Allocation by pool state'}
              subtitle={locale === 'ar' ? 'أين تقف أموالك الآن' : 'Where your money stands now'}
              items={d.byStatus.map((s: any) => ({ label: statusLabel(s.status, locale), value: s.amount }))}
              valueFormat={omr0}
            />
          </Card>
        ) : null}
      </div>

      {distributions.length > 0 ? (
        <Card>
          <TrendChart
            title={locale === 'ar' ? 'التوزيعات المستلمة تراكميًا' : 'Cumulative distributions received'}
            subtitle={locale === 'ar'
              ? 'من نقد محقق ومعتمد فقط — لا يشمل أي توقع'
              : 'From realised, approved cash only — nothing projected'}
            points={distributions}
            valueFormat={omr0}
            tickFormat={(v) => compactNumber(v / 1000)}
            area={false}
          />
        </Card>
      ) : null}
    </div>
  );
}
