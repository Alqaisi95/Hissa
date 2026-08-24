import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery } from '../../lib/useApi.ts';
import { Badge, Card, Empty, ErrorNotice, Field, Loading, Money, Progress, StatusBadge } from '../../components/ui.tsx';

export function Marketplace() {
  const { t, pick, locale } = useI18n();
  const [filters, setFilters] = useState({ sector: '', governorate: '', status: 'funding', search: '', sort: 'closing_soon' });

  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== '') as [string, string][],
  ).toString();
  const pools = useQuery<any>(`/pools?${query}`, [query]);
  const facets = useQuery<any>('/pools/facets');

  const update = (key: keyof typeof filters) => (event: { target: { value: string } }) =>
    setFilters((previous) => ({ ...previous, [key]: event.target.value }));

  return (
    <div className="stack">
      <h1>{t('marketplaceTitle')}</h1>

      <Card>
        <div className="filters">
          <Field label={t('search')} htmlFor="q">
            <input id="q" type="text" value={filters.search} onChange={update('search')}
                   placeholder={locale === 'ar' ? 'ابحث باسم الفرصة' : 'Search by title'} />
          </Field>
          <Field label={t('filterSector')} htmlFor="sector">
            <select id="sector" value={filters.sector} onChange={update('sector')}>
              <option value="">{t('all')}</option>
              {(facets.data?.sectors ?? []).map((item: any) => (
                <option key={item.sector} value={item.sector}>{item.sector} ({item.count})</option>
              ))}
            </select>
          </Field>
          <Field label={t('filterGovernorate')} htmlFor="gov">
            <select id="gov" value={filters.governorate} onChange={update('governorate')}>
              <option value="">{t('all')}</option>
              {(facets.data?.governorates ?? []).map((item: any) => (
                <option key={item.governorate} value={item.governorate}>{item.governorate} ({item.count})</option>
              ))}
            </select>
          </Field>
          <Field label={t('filterStatus')} htmlFor="status">
            <select id="status" value={filters.status} onChange={update('status')}>
              <option value="funding">{locale === 'ar' ? 'مفتوحة للتمويل' : 'Funding'}</option>
              <option value="funded">{locale === 'ar' ? 'مموّلة' : 'Funded'}</option>
              <option value="operating">{locale === 'ar' ? 'قيد التشغيل' : 'Operating'}</option>
              <option value="closed">{locale === 'ar' ? 'مغلقة' : 'Closed'}</option>
              <option value="all">{t('all')}</option>
            </select>
          </Field>
          <Field label={t('sortBy')} htmlFor="sort">
            <select id="sort" value={filters.sort} onChange={update('sort')}>
              <option value="closing_soon">{t('sortClosingSoon')}</option>
              <option value="newest">{t('sortNewest')}</option>
              <option value="progress">{t('sortProgress')}</option>
            </select>
          </Field>
        </div>
      </Card>

      {pools.loading ? <Loading rows={5} /> : pools.error ? (
        <ErrorNotice error={pools.error} onRetry={pools.reload} />
      ) : (pools.data?.items ?? []).length === 0 ? (
        <Empty>{locale === 'ar' ? 'لا توجد فرص مطابقة للفلاتر الحالية.' : 'No opportunities match the current filters.'}</Empty>
      ) : (
        <div className="grid grid--cards">
          {pools.data.items.map((pool: any) => (
            <Link key={pool.id} to={`/opportunities/${pool.id}`} className="card card--raised pool-card"
                  style={{ color: 'inherit' }}>
              <div className="pool-card__meta">
                <StatusBadge status={pool.status} />
                <Badge>{pool.sector}</Badge>
                {pool.governorate ? <Badge>{pool.governorate}</Badge> : null}
              </div>

              <div className="pool-card__title">{pick(pool.title_ar, pool.title_en)}</div>

              <Progress
                bps={pool.progressBps}
                label={<><Money baisa={pool.raisedAmount} decimals={0} /> {locale === 'ar' ? 'من' : 'of'} <Money baisa={pool.target_amount} decimals={0} /></>}
              />

              <dl className="kv small" style={{ marginBlockEnd: 0 }}>
                <dt>{t('minimumTicket')}</dt>
                <dd><Money baisa={pool.min_ticket} decimals={0} /></dd>
                <dt>{t('tenor')}</dt>
                <dd>{pool.tenor_months} {t('months')}</dd>
              </dl>

              <div className="pool-card__figures muted small">
                <span>{pool.investorCount} {t('investorCount')}</span>
                {pool.daysRemaining !== null && pool.status === 'funding'
                  ? <span>{pool.daysRemaining} {t('daysRemaining')}</span> : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
