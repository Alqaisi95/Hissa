/** FR-505 … FR-508 — holdings, reports, distributions, votes and statements. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import {
  Badge, Card, Empty, ErrorNotice, Loading, Money, Stat, StatusBadge, Tabs,
} from '../../components/ui.tsx';
import { PortfolioInsights } from './Insights.tsx';

export function Portfolio() {
  const { t, pick, locale, formatDate, formatPercent } = useI18n();
  const [tab, setTab] = useState<'holdings' | 'insights' | 'statements'>('holdings');
  const portfolio = useQuery<any>('/portfolio');

  if (portfolio.loading) return <Loading rows={8} />;
  if (portfolio.error) return <ErrorNotice error={portfolio.error} onRetry={portfolio.reload} />;
  if (!portfolio.data) return null;

  const { summary, holdings, pendingCommitments } = portfolio.data;

  return (
    <div className="stack">
      <h1>{t('portfolioTitle')}</h1>

      <div className="grid grid--stats">
        <Stat label={t('invested')} value={<Money baisa={summary.investedAmount} decimals={0} />} />
        <Stat label={t('distributed')} value={<Money baisa={summary.distributedAmount} decimals={0} />} />
        <Stat label={t('pendingCommitments')} value={<Money baisa={summary.committedPending} decimals={0} />} />
        <Stat label={t('activePools')} value={summary.activePools} />
      </div>

      {/* FR-505 — nominal values only; the platform states plainly that it has no market price. */}
      <div className="notice notice--info small">{summary.valuationNoteAr}</div>

      <Tabs<'holdings' | 'insights' | 'statements'>
        active={tab} onChange={setTab}
        tabs={[
          { key: 'holdings', label: t('portfolioTitle') },
          { key: 'insights', label: locale === 'ar' ? 'التحليل' : 'Insights' },
          { key: 'statements', label: t('statements') },
        ]}
      />

      {tab === 'insights' ? <PortfolioInsights /> : tab === 'statements' ? <Statement /> : (
        <div className="stack">
          {pendingCommitments.length > 0 ? (
            <Card title={t('pendingCommitments')}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>{t('reference')}</th><th>{locale === 'ar' ? 'الفرصة' : 'Opportunity'}</th>
                        <th>{t('amount')}</th><th>{t('status')}</th><th /></tr>
                  </thead>
                  <tbody>
                    {pendingCommitments.map((order: any) => (
                      <tr key={order.id}>
                        <td className="mono small">{order.reference}</td>
                        <td>{order.title_ar}</td>
                        <td className="num"><Money baisa={order.amount} /></td>
                        <td><StatusBadge status={order.status} /></td>
                        <td><Link to={`/orders/${order.id}`} className="btn btn--sm">{t('viewDetails')}</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {holdings.length === 0 ? (
            <Card>
              <Empty>{locale === 'ar' ? 'لا توجد ملكيات بعد.' : 'No holdings yet.'}</Empty>
              <Link to="/opportunities" className="btn btn--primary btn--sm">{t('heroCta')}</Link>
            </Card>
          ) : holdings.map((holding: any) => (
            <Card
              key={holding.id}
              title={<Link to={`/opportunities/${holding.pool_id}`}>{pick(holding.title_ar, null)}</Link>}
              actions={<StatusBadge status={holding.pool_status} />}
            >
              <div className="stack">
                <dl className="kv" style={{ marginBlockEnd: 0 }}>
                  <dt>{t('invested')}</dt><dd><Money baisa={holding.invested_amount} /></dd>
                  <dt>{t('units')}</dt><dd className="numeric">{holding.units}</dd>
                  <dt>{t('ownershipShare')}</dt><dd>{formatPercent(holding.ownershipBps)}</dd>
                  <dt>{t('distributed')}</dt><dd><Money baisa={holding.distributed_amount} /></dd>
                  <dt>{t('tenor')}</dt><dd>{holding.tenor_months} {t('months')}</dd>
                  {holding.funded_at ? (
                    <><dt>{locale === 'ar' ? 'تاريخ التمويل' : 'Funded'}</dt><dd>{formatDate(holding.funded_at)}</dd></>
                  ) : null}
                </dl>

                {holding.distributions?.length ? (
                  <div>
                    <h4 style={{ marginBlockEnd: '.4rem' }}>{t('distributed')}</h4>
                    <div className="table-wrap">
                      <table className="data">
                        <thead>
                          <tr><th>{locale === 'ar' ? 'الفترة' : 'Period'}</th><th>{t('amount')}</th>
                              <th>{t('status')}</th><th>{t('date')}</th></tr>
                        </thead>
                        <tbody>
                          {holding.distributions.map((distribution: any, index: number) => (
                            <tr key={index}>
                              <td>{distribution.period_label}</td>
                              <td className="num"><Money baisa={distribution.net_amount} /></td>
                              {/* FR-506 — expected is visibly separate from paid. */}
                              <td><StatusBadge status={distribution.status} /></td>
                              <td>{formatDate(distribution.paid_at ?? distribution.approved_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                <PoolReports poolId={holding.pool_id} />
                <PoolVotes poolId={holding.pool_id} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PoolReports({ poolId }: { poolId: string }) {
  const { t, locale, formatDate } = useI18n();
  const reports = useQuery<any>(`/portfolio/pools/${poolId}/reports`, [poolId]);
  if (reports.loading || !reports.data?.items?.length) return null;

  return (
    <div>
      <h4 style={{ marginBlockEnd: '.4rem' }}>{t('reports')}</h4>
      <div className="stack-sm">
        {reports.data.items.map((report: any) => (
          <details key={report.id} className="panel">
            <summary style={{ cursor: 'pointer' }}>
              <strong>{report.period_label}</strong>{' '}
              <span className="small muted">{formatDate(report.published_at)}</span>
            </summary>
            <div className="stack-sm" style={{ marginBlockStart: '.6rem' }}>
              <p style={{ margin: 0 }}>{report.narrative}</p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{locale === 'ar' ? 'المؤشر' : 'Metric'}</th>
                      <th>{locale === 'ar' ? 'الفعلي' : 'Actual'}</th>
                      <th>{locale === 'ar' ? 'المتوقع' : 'Forecast'}</th>
                      <th>{locale === 'ar' ? 'الانحراف' : 'Variance'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.kpis ?? {}).map(([metric, values]: [string, any]) => {
                      const deviation = values.forecast ? values.actual - values.forecast : null;
                      const percent = values.forecast ? Math.round(((values.actual - values.forecast) / values.forecast) * 1000) / 10 : null;
                      return (
                        <tr key={metric}>
                          <td>{metric}</td>
                          <td className="num">{values.actual}</td>
                          <td className="num">{values.forecast ?? '—'}</td>
                          <td className="num">
                            {deviation === null ? '—' : (
                              <Badge tone={deviation >= 0 ? 'positive' : 'warning'}>
                                {deviation > 0 ? '+' : ''}{deviation} ({percent}%)
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {report.variance_note ? <p className="small muted" style={{ margin: 0 }}>{report.variance_note}</p> : null}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

/** FR-507 — corporate actions. Eligibility and weight come from the record date. */
function PoolVotes({ poolId }: { poolId: string }) {
  const { t, locale, formatDate } = useI18n();
  const votes = useQuery<any>(`/portfolio/pools/${poolId}/votes`, [poolId]);
  const ballot = useMutation((payload: { voteId: string; choice: string }) =>
    api.post(`/portfolio/votes/${payload.voteId}/ballot`, { choice: payload.choice }));

  if (votes.loading || !votes.data?.items?.length) return null;

  const choices = [
    { key: 'for', label: locale === 'ar' ? 'موافق' : 'For' },
    { key: 'against', label: locale === 'ar' ? 'معارض' : 'Against' },
    { key: 'abstain', label: locale === 'ar' ? 'ممتنع' : 'Abstain' },
  ];

  return (
    <div>
      <h4 style={{ marginBlockEnd: '.4rem' }}>{t('votes')}</h4>
      <div className="stack-sm">
        {votes.data.items.map((vote: any) => {
          const closed = vote.status !== 'open' || new Date(vote.closesAt) < new Date();
          return (
            <div key={vote.id} className="panel stack-sm">
              <div className="row row--between">
                <strong>{vote.titleAr}</strong>
                <StatusBadge status={closed ? 'closed' : 'open'} />
              </div>
              <p className="small muted" style={{ margin: 0 }}>{vote.description}</p>
              <span className="small muted">
                {locale === 'ar' ? 'يغلق' : 'Closes'} {formatDate(vote.closesAt)} ·{' '}
                {locale === 'ar' ? 'وزن صوتك' : 'Your weight'}: <span className="numeric">{vote.myWeight}</span>
              </span>

              {vote.myBallot ? (
                <Badge tone="positive">
                  {locale === 'ar' ? 'صوّت' : 'Voted'}: {choices.find((c) => c.key === vote.myBallot.choice)?.label}
                </Badge>
              ) : closed ? null : (
                <div className="row" style={{ gap: '.4rem' }}>
                  {choices.map((choice) => (
                    <button
                      key={choice.key} type="button" className="btn btn--sm" disabled={ballot.pending}
                      onClick={async () => { if (await ballot.run({ voteId: vote.id, choice: choice.key })) votes.reload(); }}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ErrorNotice error={ballot.error} />
    </div>
  );
}

function Statement() {
  const { t, locale, formatDate } = useI18n();
  const [range, setRange] = useState({
    from: new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
  const statement = useQuery<any>(`/portfolio/statement?from=${range.from}&to=${range.to}`, [range.from, range.to]);

  return (
    <Card
      title={t('statements')}
      actions={
        <div className="row" style={{ gap: '.4rem' }}>
          <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          <button type="button" className="btn btn--sm" onClick={() => window.print()}>
            {locale === 'ar' ? 'طباعة' : 'Print'}
          </button>
        </div>
      }
    >
      {statement.loading ? <Loading /> : !statement.data ? <Empty /> : (
        <div className="stack">
          <div className="grid grid--stats">
            <Stat label={t('invested')} value={<Money baisa={statement.data.statement.totals.invested} decimals={0} />} />
            <Stat label={t('distributed')} value={<Money baisa={statement.data.statement.totals.distributed} decimals={0} />} />
            <Stat label={locale === 'ar' ? 'المسترد' : 'Refunded'} value={<Money baisa={statement.data.statement.totals.refunded} decimals={0} />} />
          </div>

          <div>
            <h4>{locale === 'ar' ? 'الاستثمارات' : 'Investments'}</h4>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>{t('reference')}</th><th>{locale === 'ar' ? 'الفرصة' : 'Opportunity'}</th>
                      <th>{t('amount')}</th><th>{t('status')}</th><th>{t('date')}</th></tr>
                </thead>
                <tbody>
                  {statement.data.statement.investments.map((row: any) => (
                    <tr key={row.reference}>
                      <td className="mono small">{row.reference}</td>
                      <td>{row.title_ar}</td>
                      <td className="num"><Money baisa={row.allocated} /></td>
                      <td><StatusBadge status={row.status} /></td>
                      <td>{formatDate(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="small muted" style={{ margin: 0 }}>
            {statement.data.statement.noteAr} · {formatDate(statement.data.statement.generatedAt, true)}
          </p>
        </div>
      )}
    </Card>
  );
}
