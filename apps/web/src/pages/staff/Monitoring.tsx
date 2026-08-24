/** FR-501 … FR-504 — reports due and late, review before publication, alerts. */
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Badge, Card, Empty, ErrorNotice, Loading, StatusBadge, Stat } from '../../components/ui.tsx';

export function Monitoring() {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const monitoring = useQuery<any>('/portfolio/monitoring');
  // Compliance and audit read the monitoring picture; portfolio ops acts on it.
  const canAct = auth.has('portfolio_ops');

  const publish = useMutation((payload: { id: string; reason: string }) =>
    api.post(`/portfolio/reports/${payload.id}/publish`, { reason: payload.reason }));
  const resolveAlert = useMutation((payload: { id: string; resolution: string }) =>
    api.post(`/portfolio/alerts/${payload.id}/resolve`, { resolution: payload.resolution }));

  if (monitoring.loading) return <Loading rows={6} />;
  if (monitoring.error) return <ErrorNotice error={monitoring.error} onRetry={monitoring.reload} />;

  const data = monitoring.data;
  const ask = (message: string) => window.prompt(message) ?? '';
  const reload = () => monitoring.reload();

  return (
    <div className="stack">
      <div className="grid grid--stats">
        <Stat label={locale === 'ar' ? 'فرص قيد المتابعة' : 'Pools monitored'} value={data.pools.length} />
        <Stat label={locale === 'ar' ? 'تقارير مستحقة' : 'Reports due'} value={data.reportsDue.length} />
        <Stat label={t('queueReports')} value={data.reportsLate.length} />
        <Stat label={locale === 'ar' ? 'بانتظار المراجعة' : 'Pending review'} value={data.pendingReview.length} />
        <Stat label={locale === 'ar' ? 'إنذارات مفتوحة' : 'Open alerts'} value={data.openAlerts.length} />
      </div>

      <ErrorNotice error={publish.error ?? resolveAlert.error} />

      {/* FR-503 — investors never see a draft; publication is a reviewed, separate act. */}
      <Card title={locale === 'ar' ? 'تقارير بانتظار المراجعة' : 'Reports pending review'}>
        {data.pendingReview.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'الفرصة' : 'Pool'}</th><th>{locale === 'ar' ? 'الفترة' : 'Period'}</th>
                  <th>{locale === 'ar' ? 'المؤشرات' : 'KPIs'}</th><th>{locale === 'ar' ? 'الاستحقاق' : 'Due'}</th><th />
                </tr>
              </thead>
              <tbody>
                {data.pendingReview.map((report: any) => {
                  const kpis = JSON.parse(report.kpis || '{}');
                  const isSubmitter = report.submitted_by === auth.user?.id;
                  return (
                    <tr key={report.id}>
                      <td>{report.title_ar}</td>
                      <td>{report.period_label}</td>
                      <td className="small">
                        {Object.entries(kpis).map(([metric, values]: [string, any]) => {
                          const deviation = values.forecast ? values.actual - values.forecast : null;
                          return (
                            <div key={metric}>
                              {metric}: <span className="numeric">{values.actual}</span>
                              {deviation !== null ? (
                                <Badge tone={deviation >= 0 ? 'positive' : 'warning'}>
                                  {deviation > 0 ? '+' : ''}{deviation}
                                </Badge>
                              ) : null}
                            </div>
                          );
                        })}
                      </td>
                      <td className="small">{formatDate(report.due_at)}</td>
                      <td>
                        {!canAct ? (
                          <span className="small muted">
                            {locale === 'ar' ? 'اطلاع رقابي' : 'Oversight view'}
                          </span>
                        ) : isSubmitter ? (
                          <span className="small muted">
                            {locale === 'ar' ? 'أنت من أرسل التقرير' : 'You submitted this report'}
                          </span>
                        ) : (
                          <button type="button" className="btn btn--sm btn--primary" disabled={publish.pending}
                                  onClick={async () => {
                                    const reason = ask(locale === 'ar' ? 'مبرر النشر (5 أحرف)' : 'Publication reason (5+)');
                                    if (reason.length >= 5 && await publish.run({ id: report.id, reason })) reload();
                                  }}>
                            {locale === 'ar' ? 'اعتماد ونشر' : 'Approve & publish'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('queueReports')}>
        {data.reportsLate.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>{locale === 'ar' ? 'الفرصة' : 'Pool'}</th><th>{locale === 'ar' ? 'الفترة' : 'Period'}</th>
                    <th>{locale === 'ar' ? 'الاستحقاق' : 'Due'}</th><th>{t('status')}</th></tr>
              </thead>
              <tbody>
                {data.reportsLate.map((report: any) => (
                  <tr key={report.id}>
                    <td>{report.title_ar}</td>
                    <td>{report.period_label}</td>
                    <td className="small"><Badge tone="danger">{formatDate(report.due_at)}</Badge></td>
                    <td><StatusBadge status={report.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={locale === 'ar' ? 'الإنذارات' : 'Alerts'}>
        {data.openAlerts.length === 0 ? <Empty /> : (
          <div className="stack-sm">
            {data.openAlerts.map((alert: any) => (
              <div key={alert.id} className="panel row row--between">
                <div>
                  <Badge tone={alert.severity === 'critical' ? 'danger' : 'warning'}>{alert.type}</Badge>
                  <span style={{ marginInlineStart: '.5rem' }}>{alert.message_ar}</span>
                  <div className="small muted">{formatDate(alert.created_at, true)}</div>
                </div>
                {!canAct ? null : (
                <button type="button" className="btn btn--sm" disabled={resolveAlert.pending}
                        onClick={async () => {
                          const resolution = ask(locale === 'ar' ? 'وصف المعالجة' : 'Resolution');
                          if (resolution.length >= 5 && await resolveAlert.run({ id: alert.id, resolution })) reload();
                        }}>
                  {locale === 'ar' ? 'إغلاق' : 'Resolve'}
                </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={locale === 'ar' ? 'الفرص قيد المتابعة' : 'Pools under monitoring'}>
        {data.pools.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>{t('reference')}</th><th>{locale === 'ar' ? 'الفرصة' : 'Pool'}</th>
                    <th>{t('status')}</th><th>{locale === 'ar' ? 'تاريخ التمويل' : 'Funded'}</th>
                    <th>{t('tenor')}</th></tr>
              </thead>
              <tbody>
                {data.pools.map((pool: any) => (
                  <tr key={pool.id}>
                    <td className="mono small">{pool.reference}</td>
                    <td>{pool.title_ar}</td>
                    <td><StatusBadge status={pool.status} /></td>
                    <td className="small">{formatDate(pool.funded_at)}</td>
                    <td className="num">{pool.tenor_months}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
