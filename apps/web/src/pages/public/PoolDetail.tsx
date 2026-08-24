import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api, trackEvent } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import {
  Badge, Card, Empty, ErrorNotice, Field, Loading, Money, Progress, RiskNotice, StatusBadge, Tabs,
} from '../../components/ui.tsx';

type TabKey = 'overview' | 'financials' | 'rights' | 'risks' | 'dataroom' | 'qa';

export function PoolDetail() {
  const { id = '' } = useParams();
  const { t, pick, locale, formatDate, formatPercent } = useI18n();
  const auth = useAuth();
  const [tab, setTab] = useState<TabKey>('overview');
  const pool = useQuery<any>(`/pools/${id}`, [id, auth.user?.id]);

  useEffect(() => { if (pool.data?.pool?.id) trackEvent('pool_detail_viewed', {}, pool.data.pool.id); },
            [pool.data?.pool?.id]);

  if (pool.loading) return <Loading rows={8} />;
  if (pool.error) return <ErrorNotice error={pool.error} onRetry={pool.reload} />;
  if (!pool.data) return null;

  const { pool: p, disclosure, dataRoom, questions, eligibility } = pool.data;
  const sections = disclosure?.sections;

  return (
    <div className="stack">
      <div className="row row--between">
        <div className="stack-sm">
          <div className="row" style={{ gap: '.4rem' }}>
            <StatusBadge status={p.status} />
            <Badge>{p.sector}</Badge>
            {p.governorate ? <Badge>{p.governorate}</Badge> : null}
            <Badge tone="info">{p.reference}</Badge>
          </div>
          <h1 style={{ margin: 0 }}>{pick(p.title_ar, p.title_en)}</h1>
        </div>
      </div>

      <RiskNotice />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div className="stack">
          <Card>
            <Tabs<TabKey>
              active={tab} onChange={setTab}
              tabs={[
                { key: 'overview', label: t('tabOverview') },
                { key: 'financials', label: t('tabFinancials') },
                { key: 'rights', label: t('tabRights') },
                { key: 'risks', label: t('tabRisks') },
                { key: 'dataroom', label: `${t('tabDataRoom')} (${dataRoom.length})` },
                { key: 'qa', label: `${t('tabQa')} (${questions.length})` },
              ]}
            />

            <div style={{ paddingBlockStart: '1rem' }}>
              {!sections ? <Empty /> : tab === 'overview' ? (
                <div className="stack-sm">
                  <p>{sections.summary.activityAr}</p>
                  <h3>{t('useOfFunds')}</h3>
                  <p className="muted">{sections.summary.useOfFundsAr}</p>
                  <p className="muted">{sections.summary.expansionRationaleAr}</p>
                </div>
              ) : tab === 'financials' ? (
                <div className="stack">
                  <div>
                    <h3>{t('historicalRevenue')}</h3>
                    <div className="table-wrap">
                      <table className="data">
                        <thead><tr><th>{locale === 'ar' ? 'الفترة' : 'Period'}</th><th>{t('amount')}</th></tr></thead>
                        <tbody>
                          {sections.financials.historicalRevenue.map((row: any) => (
                            <tr key={row.period}>
                              <td>{row.period}</td>
                              <td className="num"><Money baisa={row.amount} decimals={0} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3>{t('scenarios')}</h3>
                    <div className="grid grid--two">
                      {(['conservative', 'base', 'optimistic'] as const).map((key) => {
                        const scenario = sections.financials.scenarios[key];
                        const label = key === 'conservative' ? t('scenarioConservative')
                          : key === 'base' ? t('scenarioBase') : t('scenarioOptimistic');
                        return (
                          <div key={key} className="panel">
                            <div className="row row--between">
                              <strong>{label}</strong>
                              <span className="numeric">{formatPercent(scenario.annualCashYieldBps)}</span>
                            </div>
                            <p className="small muted" style={{ margin: '.35rem 0 0' }}>{scenario.narrativeAr}</p>
                          </div>
                        );
                      })}
                    </div>
                    {/* "الشفافية قبل العائد" — the caveat sits with the numbers, not in a footnote. */}
                    <div className="notice notice--info small" style={{ marginBlockStart: '.85rem' }}>
                      {t('scenarioNote')}
                    </div>
                  </div>

                  <div>
                    <h3>{locale === 'ar' ? 'الافتراضات' : 'Assumptions'}</h3>
                    <p className="muted">{sections.financials.assumptionsAr}</p>
                  </div>
                </div>
              ) : tab === 'rights' ? (
                <dl className="kv">
                  {[
                    [locale === 'ar' ? 'الأداة' : 'Instrument', sections.rights.instrumentAr],
                    [locale === 'ar' ? 'سياسة التوزيع' : 'Distribution policy', sections.rights.distributionPolicyAr],
                    [locale === 'ar' ? 'التصويت' : 'Voting', sections.rights.votingAr],
                    [locale === 'ar' ? 'القيود' : 'Restrictions', sections.rights.restrictionsAr],
                    [locale === 'ar' ? 'آلية الخروج' : 'Exit mechanism', sections.rights.exitMechanismAr],
                    [locale === 'ar' ? 'معالجة التعثر' : 'Default handling', sections.rights.defaultHandlingAr],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: 'contents' }}>
                      <dt>{label}</dt><dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : tab === 'risks' ? (
                <dl className="kv">
                  {[
                    [locale === 'ar' ? 'خسارة رأس المال' : 'Capital loss', sections.risks.capitalLossAr],
                    [locale === 'ar' ? 'السيولة' : 'Liquidity', sections.risks.liquidityAr],
                    [locale === 'ar' ? 'التشغيل' : 'Operational', sections.risks.operationalAr],
                    [locale === 'ar' ? 'القطاع' : 'Sector', sections.risks.sectorAr],
                    [locale === 'ar' ? 'تعارض المصالح' : 'Conflicts', sections.risks.conflictsAr],
                    [locale === 'ar' ? 'الاعتماديات' : 'Dependencies', sections.risks.dependenciesAr],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: 'contents' }}>
                      <dt>{label}</dt><dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : tab === 'dataroom' ? (
                <DataRoom poolId={p.id} documents={dataRoom} />
              ) : (
                <QandA poolId={p.id} questions={questions} onAsked={pool.reload} />
              )}
            </div>
          </Card>
        </div>

        <aside className="stack">
          <Card>
            <div className="stack">
              <Progress
                bps={p.progressBps}
                label={<><Money baisa={p.raisedAmount} decimals={0} /> {locale === 'ar' ? 'من' : 'of'} <Money baisa={p.target_amount} decimals={0} /></>}
              />
              <dl className="kv small" style={{ marginBlockEnd: 0 }}>
                <dt>{t('target')}</dt><dd><Money baisa={p.target_amount} decimals={0} /></dd>
                <dt>{locale === 'ar' ? 'الحد الأدنى للإغلاق' : 'Minimum to close'}</dt>
                <dd><Money baisa={p.min_amount} decimals={0} /></dd>
                <dt>{t('minimumTicket')}</dt><dd><Money baisa={p.min_ticket} decimals={0} /></dd>
                <dt>{t('tenor')}</dt><dd>{p.tenor_months} {t('months')}</dd>
                <dt>{locale === 'ar' ? 'الهيكل' : 'Structure'}</dt>
                <dd>{p.structure === 'spv_equity' ? (locale === 'ar' ? 'مساهمة عبر SPV' : 'SPV equity') : (locale === 'ar' ? 'مشاركة أرباح' : 'Profit share')}</dd>
                {p.spv_name ? <><dt>SPV</dt><dd>{p.spv_name}</dd></> : null}
                <dt>{t('investorCount')}</dt><dd>{p.investorCount}</dd>
                {p.closes_at ? <><dt>{locale === 'ar' ? 'يغلق في' : 'Closes'}</dt><dd>{formatDate(p.closes_at)}</dd></> : null}
                {disclosure ? <><dt>{t('disclosureVersion')}</dt><dd>v{disclosure.version}</dd></> : null}
              </dl>

              {p.status === 'funding' ? (
                <InvestCta poolId={p.id} eligibility={eligibility} />
              ) : (
                <div className="notice notice--info small">
                  {locale === 'ar' ? 'هذه الفرصة غير مفتوحة للاستثمار حاليًا.' : 'This opportunity is not open for investment.'}
                </div>
              )}
            </div>
          </Card>

          {disclosure ? (
            <Card title={locale === 'ar' ? 'سلامة الإفصاح' : 'Disclosure integrity'}>
              <p className="small muted" style={{ marginBlockEnd: '.4rem' }}>
                {locale === 'ar'
                  ? 'كل نسخة إفصاح محفوظة ببصمة رقمية ولا تُستبدل بعد النشر.'
                  : 'Every disclosure version is stored with a digital fingerprint and is never replaced after publication.'}
              </p>
              <code className="small mono" style={{ wordBreak: 'break-all' }}>{disclosure.contentHash}</code>
              <p className="small muted" style={{ marginBlockStart: '.5rem', marginBlockEnd: 0 }}>
                {formatDate(disclosure.publishedAt, true)}
              </p>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function InvestCta({ poolId, eligibility }: { poolId: string; eligibility: any }) {
  const { t, locale } = useI18n();
  const auth = useAuth();

  if (!auth.user) {
    return (
      <Link to="/sign-in" state={{ from: `/opportunities/${poolId}` }} className="btn btn--primary btn--block">
        {t('signIn')}
      </Link>
    );
  }
  if (!eligibility) return null;

  if (!eligibility.eligible) {
    return (
      <div className="stack-sm">
        <strong className="small">{t('eligibilityTitle')}</strong>
        <ul className="small" style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
          {eligibility.blocks.map((block: any) => (
            <li key={block.code}>{locale === 'ar' ? block.messageAr : block.messageEn}</li>
          ))}
        </ul>
        <Link to="/account" className="btn btn--block">{t('navProfile')}</Link>
      </div>
    );
  }

  return (
    <div className="stack-sm">
      <Link to={`/invest/${poolId}`} className="btn btn--primary btn--block">{t('investNow')}</Link>
      <span className="small muted">
        {t('availableToYou')}: <Money baisa={eligibility.availableAmount} decimals={0} />
      </span>
    </div>
  );
}

function DataRoom({ poolId, documents }: { poolId: string; documents: any[] }) {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();

  return (
    <div className="stack-sm">
      <div className="notice notice--info small">{t('dataRoomLocked')}</div>
      {documents.length === 0 ? <Empty /> : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{locale === 'ar' ? 'الملف' : 'File'}</th>
                <th>{locale === 'ar' ? 'التصنيف' : 'Category'}</th>
                <th>{locale === 'ar' ? 'النسخة' : 'Version'}</th>
                <th>{t('date')}</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document: any) => (
                <tr key={document.id}>
                  <td>
                    {auth.user ? (
                      // FR-206 — downloads are logged server-side, including denials.
                      <a href={`/api/pools/${poolId}/documents/${document.id}`} target="_blank" rel="noreferrer">
                        {document.file_name}
                      </a>
                    ) : document.file_name}
                  </td>
                  <td>{document.category}</td>
                  <td className="num">v{document.version}</td>
                  <td>{formatDate(document.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QandA({ poolId, questions, onAsked }: { poolId: string; questions: any[]; onAsked: () => void }) {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const [body, setBody] = useState('');
  const [sent, setSent] = useState(false);
  const ask = useMutation((text: string) => api.post(`/pools/${poolId}/questions`, { body: text }));

  return (
    <div className="stack">
      {questions.length === 0 ? <Empty /> : (
        <div className="stack-sm">
          {questions.map((question: any) => (
            <div key={question.id} className="panel">
              <strong className="small">{question.body}</strong>
              <p style={{ margin: '.4rem 0 0' }}>{question.answer}</p>
              <span className="small muted">{formatDate(question.published_at)}</span>
            </div>
          ))}
        </div>
      )}

      {auth.user ? (
        <form
          className="stack-sm"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await ask.run(body);
            if (result) { setBody(''); setSent(true); onAsked(); }
          }}
        >
          <Field label={t('askQuestion')} hint={t('questionPending')} htmlFor="question">
            <textarea id="question" value={body} onChange={(event) => setBody(event.target.value)}
                      minLength={10} maxLength={1000} required />
          </Field>
          <ErrorNotice error={ask.error} />
          {sent ? <div className="notice notice--success small">{t('questionPending')}</div> : null}
          <div className="row row--end">
            <button type="submit" className="btn btn--primary btn--sm" disabled={ask.pending || body.length < 10}>
              {t('submit')}
            </button>
          </div>
        </form>
      ) : (
        <p className="small muted">
          {locale === 'ar' ? 'سجّل الدخول لطرح سؤال.' : 'Sign in to ask a question.'}
        </p>
      )}
    </div>
  );
}
