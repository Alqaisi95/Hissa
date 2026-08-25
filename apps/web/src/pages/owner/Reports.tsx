/**
 * FR-501 / FR-502 — the project owner's reporting duty.
 *
 * A report is not free text: it carries KPI actuals against the forecast the
 * disclosure published, and evidence. The variance is computed as you type, so
 * the owner sees what the investor will see before submitting.
 */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import {
  Badge, Card, Empty, ErrorNotice, Field, Loading, StatusBadge,
} from '../../components/ui.tsx';

export function OwnerReports({ poolId, poolTitle }: { poolId: string; poolTitle: string }) {
  const { t, locale, formatDate } = useI18n();
  const reports = useQuery<any>(`/portfolio/pools/${poolId}/reports`, [poolId]);
  const [openId, setOpenId] = useState<string | null>(null);

  if (reports.loading) return <Loading rows={3} />;
  if (reports.error) return <ErrorNotice error={reports.error} onRetry={reports.reload} />;

  const items = reports.data?.items ?? [];
  const due = items.filter((r: any) => ['scheduled', 'draft', 'late'].includes(r.status));

  return (
    <Card title={`${locale === 'ar' ? 'تقارير' : 'Reports'} — ${poolTitle}`}
          actions={due.length ? <Badge tone="warning">{due.length} {locale === 'ar' ? 'مستحق' : 'due'}</Badge> : null}>
      {items.length === 0 ? (
        <Empty>{locale === 'ar' ? 'لا يوجد جدول تقارير بعد.' : 'No report schedule yet.'}</Empty>
      ) : (
        <div className="stack">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'الفترة' : 'Period'}</th><th>{locale === 'ar' ? 'الاستحقاق' : 'Due'}</th>
                  <th>{t('status')}</th><th />
                </tr>
              </thead>
              <tbody>
                {items.map((r: any) => {
                  const overdue = ['scheduled', 'draft', 'late'].includes(r.status) && new Date(r.due_at) < new Date();
                  return (
                    <tr key={r.id}>
                      <td>{r.period_label}</td>
                      <td className="small">
                        {overdue ? <Badge tone="danger">{formatDate(r.due_at)}</Badge> : formatDate(r.due_at)}
                      </td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>
                        {['scheduled', 'draft', 'late'].includes(r.status) ? (
                          <button type="button" className="btn btn--sm btn--primary"
                                  onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                            {openId === r.id ? t('close') : (locale === 'ar' ? 'تقديم' : 'Submit')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {openId ? (
            <ReportForm
              report={items.find((r: any) => r.id === openId)}
              onSubmitted={() => { setOpenId(null); reports.reload(); }}
            />
          ) : null}
        </div>
      )}
    </Card>
  );
}

interface KpiRow { metric: string; actual: string; forecast: string }

function ReportForm({ report, onSubmitted }: { report: any; onSubmitted: () => void }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<KpiRow[]>([{ metric: '', actual: '', forecast: '' }]);
  const [narrative, setNarrative] = useState('');
  const [varianceNote, setVarianceNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);

  const submit = useMutation(async () => {
    const kpis: Record<string, { actual: number; forecast?: number }> = {};
    for (const row of rows) {
      if (!row.metric.trim() || row.actual === '') continue;
      kpis[row.metric.trim()] = {
        actual: Number(row.actual),
        ...(row.forecast === '' ? {} : { forecast: Number(row.forecast) }),
      };
    }

    let evidence;
    if (file) {
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      evidence = { fileName: file.name, mimeType: file.type || 'application/pdf', contentBase64: btoa(binary) };
    }

    return api.post(`/portfolio/reports/${report.id}/submit`, {
      kpis, narrative, varianceNote: varianceNote || undefined, evidence,
    });
  });

  const updateRow = (i: number, key: keyof KpiRow, value: string) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  return (
    <form
      className="stack panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await submit.run();
        if (r) { setResult(r); onSubmitted(); }
      }}
    >
      <h4 style={{ margin: 0 }}>
        {locale === 'ar' ? `تقرير الفترة ${report.period_label}` : `Report for ${report.period_label}`}
      </h4>

      <div className="notice notice--info small">
        {locale === 'ar'
          ? 'لا يرى المستثمر هذا التقرير قبل مراجعته واعتماده من فريق المتابعة. الدليل المرفق شرط للنشر.'
          : 'Investors do not see this report until the monitoring team reviews and approves it. The attached evidence is required before publication.'}
      </div>

      <div>
        <div className="row row--between" style={{ marginBlockEnd: '.4rem' }}>
          <strong className="small">{locale === 'ar' ? 'المؤشرات' : 'KPIs'}</strong>
          <button type="button" className="btn btn--sm"
                  onClick={() => setRows((p) => [...p, { metric: '', actual: '', forecast: '' }])}>
            + {locale === 'ar' ? 'مؤشر' : 'Metric'}
          </button>
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{locale === 'ar' ? 'المؤشر' : 'Metric'}</th>
                <th>{locale === 'ar' ? 'الفعلي' : 'Actual'}</th>
                <th>{locale === 'ar' ? 'المتوقع' : 'Forecast'}</th>
                <th>{locale === 'ar' ? 'الانحراف' : 'Variance'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const actual = Number(row.actual), forecast = Number(row.forecast);
                const has = row.actual !== '' && row.forecast !== '' && forecast !== 0;
                const deviation = has ? actual - forecast : null;
                const pct = has ? Math.round(((actual - forecast) / forecast) * 1000) / 10 : null;
                return (
                  <tr key={i}>
                    <td>
                      <input type="text" dir="ltr" value={row.metric}
                             placeholder="monthly_revenue_omr"
                             onChange={(e) => updateRow(i, 'metric', e.target.value)} />
                    </td>
                    <td>
                      <input type="number" step="any" dir="ltr" value={row.actual}
                             onChange={(e) => updateRow(i, 'actual', e.target.value)} />
                    </td>
                    <td>
                      <input type="number" step="any" dir="ltr" value={row.forecast}
                             onChange={(e) => updateRow(i, 'forecast', e.target.value)} />
                    </td>
                    <td className="num">
                      {deviation === null ? '—' : (
                        <Badge tone={deviation >= 0 ? 'positive' : 'warning'}>
                          {deviation > 0 ? '+' : ''}{deviation} ({pct}%)
                        </Badge>
                      )}
                    </td>
                    <td>
                      {rows.length > 1 ? (
                        <button type="button" className="btn btn--sm"
                                onClick={() => setRows((p) => p.filter((_, j) => j !== i))}>×</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Field label={locale === 'ar' ? 'السرد' : 'Narrative'} htmlFor="narr"
             hint={locale === 'ar' ? '20 حرفًا على الأقل — يُفحص من عبارات الضمان' : 'At least 20 characters — screened for guarantee wording'}>
        <textarea id="narr" rows={3} required minLength={20} value={narrative}
                  onChange={(e) => setNarrative(e.target.value)} />
      </Field>

      <Field label={locale === 'ar' ? 'تفسير الانحراف' : 'Variance explanation'} htmlFor="vnote">
        <textarea id="vnote" rows={2} value={varianceNote} onChange={(e) => setVarianceNote(e.target.value)} />
      </Field>

      <Field label={locale === 'ar' ? 'دليل التقرير' : 'Supporting evidence'} htmlFor="rev">
        <input id="rev" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx"
               onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>

      <ErrorNotice error={submit.error} />
      {result?.late ? (
        <div className="notice notice--risk small">
          {locale === 'ar' ? 'سُجل التقرير كمتأخر عن موعد الاستحقاق.' : 'This report is recorded as late against its due date.'}
        </div>
      ) : null}

      <button type="submit" className="btn btn--primary" disabled={submit.pending}>{t('submit')}</button>
    </form>
  );
}
