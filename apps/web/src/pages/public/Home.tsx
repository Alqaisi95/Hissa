import { Link } from 'react-router-dom';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery } from '../../lib/useApi.ts';
import { Card, Stat, Loading, Money, Progress, StatusBadge, Badge } from '../../components/ui.tsx';

export function Home() {
  const { t, pick, formatOmr } = useI18n();
  const stats = useQuery<any>('/public/stats');
  const pools = useQuery<any>('/pools?status=funding&limit=3');

  return (
    <div className="stack" style={{ gap: '2rem' }}>
      <section className="card card--raised" style={{ padding: '2rem 1.75rem' }}>
        <div className="stack">
          <Badge tone="brand">{t('brandTagline')}</Badge>
          <h1 style={{ maxWidth: '30ch' }}>{t('heroTitle')}</h1>
          <p style={{ maxWidth: '68ch', fontSize: '1.02rem' }} className="muted">{t('heroBody')}</p>
          <div className="row">
            <Link to="/opportunities" className="btn btn--primary">{t('heroCta')}</Link>
            <Link to="/project" className="btn">{t('heroSecondary')}</Link>
          </div>
        </div>
      </section>

      <section className="grid grid--stats">
        {stats.loading ? <Loading rows={2} /> : (
          <>
            <Stat label={t('statFunded')} value={stats.data?.fundedPools ?? 0} />
            <Stat label={t('statAmount')} value={formatOmr(stats.data?.fundedAmount ?? 0, { decimals: 0 })} />
            <Stat label={t('statLive')} value={stats.data?.livePools ?? 0} />
            <Stat label={t('statInvestors')} value={stats.data?.investors ?? 0} />
          </>
        )}
      </section>
      <p className="small muted" style={{ marginBlockStart: '-1.25rem' }}>{t('statsNote')}</p>

      <section className="stack">
        <div className="row row--between">
          <h2 style={{ margin: 0 }}>{t('marketplaceTitle')}</h2>
          <Link to="/opportunities" className="btn btn--ghost btn--sm">{t('heroCta')} →</Link>
        </div>

        {pools.loading ? <Loading /> : (
          <div className="grid grid--cards">
            {(pools.data?.items ?? []).map((pool: any) => (
              <Link key={pool.id} to={`/opportunities/${pool.id}`} className="card card--raised pool-card"
                    style={{ color: 'inherit' }}>
                <div className="pool-card__meta">
                  <StatusBadge status={pool.status} />
                  <Badge>{pool.sector}</Badge>
                  {pool.governorate ? <Badge>{pool.governorate}</Badge> : null}
                </div>
                <div className="pool-card__title">{pick(pool.title_ar, pool.title_en)}</div>
                <Progress bps={pool.progressBps}
                          label={<><Money baisa={pool.raisedAmount} decimals={0} /> / <Money baisa={pool.target_amount} decimals={0} /></>} />
                <div className="pool-card__figures muted">
                  <span>{pool.investorCount} {t('investorCount')}</span>
                  {pool.daysRemaining !== null
                    ? <span>{pool.daysRemaining} {t('daysRemaining')}</span> : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Card title={t('navHowItWorks')}>
        <HowItWorksPreview />
      </Card>
    </div>
  );
}

function HowItWorksPreview() {
  const { pick } = useI18n();
  const guide = useQuery<any>('/public/how-it-works');
  if (guide.loading) return <Loading />;

  return (
    <ol className="steps">
      {(guide.data?.investorSteps ?? []).slice(0, 3).map((step: any) => (
        <li key={step.step}>
          <span className="steps__num" aria-hidden="true">{step.step}</span>
          <div>
            <strong>{pick(step.titleAr, step.titleEn)}</strong>
            <p className="muted small" style={{ margin: '.15rem 0 0' }}>{pick(step.bodyAr, step.bodyEn)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
