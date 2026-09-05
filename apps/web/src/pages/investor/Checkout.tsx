/**
 * FR-301 … FR-307 — the commitment journey: eligibility, amount with a fee and
 * rights summary, explicit acknowledgements bound to the disclosure version,
 * then a hand-off to the licensed partner. Card data never enters this app.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api, trackEvent } from '../../lib/api.ts';
import {
  Card, ErrorNotice, Field, Loading, Money, RiskNotice, Badge, Progress,
} from '../../components/ui.tsx';

export function Checkout() {
  const { poolId = '' } = useParams();
  const navigate = useNavigate();
  const { t, pick, locale, formatPercent } = useI18n();

  const pool = useQuery<any>(`/pools/${poolId}`, [poolId]);
  const acknowledgements = useQuery<any>('/orders/acknowledgements');
  const [amountText, setAmountText] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [quote, setQuote] = useState<any>(null);

  const quoteMutation = useMutation((baisa: number) => api.post('/orders/quote', { poolId, amount: baisa }));
  const orderMutation = useMutation((payload: any) => api.post('/orders', payload));

  // Amounts are entered in OMR and converted to integer baisa (PRD §10.1).
  const amountBaisa = useMemo(() => {
    const normalised = amountText.trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,3})?$/.test(normalised)) return null;
    const [whole, fraction = ''] = normalised.split('.');
    return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  }, [amountText]);

  const eligibility = pool.data?.eligibility;
  const disclosure = pool.data?.disclosure;
  const allAcknowledged = (acknowledgements.data?.acknowledgements ?? []).every((item: any) => checked[item.code]);

  useEffect(() => {
    if (amountBaisa === null) { setQuote(null); return; }
    const timer = setTimeout(async () => {
      const result = await quoteMutation.run(amountBaisa);
      if (result) setQuote(result);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountBaisa]);

  useEffect(() => { if (poolId) trackEvent('checkout_opened', {}, poolId); }, [poolId]);

  if (pool.loading || acknowledgements.loading) return <Loading rows={8} />;
  if (pool.error) return <ErrorNotice error={pool.error} onRetry={pool.reload} />;
  if (!pool.data) return null;

  const p = pool.data.pool;

  if (!eligibility?.eligible) {
    return (
      <div className="stack">
        <h1>{t('checkoutTitle')}</h1>
        <Card title={t('eligibilityTitle')}>
          <ul style={{ margin: 0, paddingInlineStart: '1.2rem' }}>
            {(eligibility?.blocks ?? []).map((block: any) => (
              <li key={block.code}>{locale === 'ar' ? block.messageAr : block.messageEn}</li>
            ))}
          </ul>
          <div className="row" style={{ marginBlockStart: '1rem' }}>
            <Link to="/account" className="btn btn--primary">{t('navProfile')}</Link>
            <Link to={`/opportunities/${poolId}`} className="btn">{t('back')}</Link>
          </div>
        </Card>
      </div>
    );
  }

  const belowMinimum = amountBaisa !== null && amountBaisa < eligibility.minTicket;
  const aboveAvailable = amountBaisa !== null && amountBaisa > eligibility.availableAmount;
  const canSubmit = amountBaisa !== null && !belowMinimum && !aboveAvailable && allAcknowledged && disclosure;

  return (
    <div className="stack">
      <h1>{t('checkoutTitle')}</h1>
      <RiskNotice />

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div className="stack">
          <Card title={pick(p.title_ar, p.title_en)}>
            <div className="stack">
              <Progress bps={p.progressBps}
                        label={<><Money baisa={p.raisedAmount} decimals={0} /> / <Money baisa={p.target_amount} decimals={0} /></>} />

              <Field
                label={t('checkoutAmount')}
                htmlFor="amount"
                hint={<>
                  {t('minimumTicket')}: <Money baisa={eligibility.minTicket} decimals={0} /> ·{' '}
                  {t('availableToYou')}: <Money baisa={eligibility.availableAmount} decimals={0} />
                </>}
                error={
                  belowMinimum ? (locale === 'ar' ? 'المبلغ أقل من الحد الأدنى للاستثمار' : 'Below the minimum investment')
                  : aboveAvailable ? (locale === 'ar' ? 'المبلغ يتجاوز الحد المتاح لك في هذه الفرصة' : 'Above your available limit for this opportunity')
                  : undefined
                }
              >
                <input
                  id="amount" type="text" inputMode="decimal" dir="ltr"
                  value={amountText} onChange={(event) => setAmountText(event.target.value)}
                  placeholder={locale === 'ar' ? 'مثال: 500.000' : 'e.g. 500.000'}
                />
              </Field>

              {quote ? (
                <div className="panel">
                  <dl className="kv" style={{ marginBlockEnd: 0 }}>
                    <dt>{t('checkoutAmount')}</dt><dd><Money baisa={quote.amount} /></dd>
                    <dt>{t('units')}</dt><dd className="numeric">{quote.units}</dd>
                    <dt>{t('ownershipShare')}</dt><dd>{formatPercent(quote.ownershipBps)}</dd>
                    <dt>{t('investorFee')}</dt><dd><Money baisa={quote.investorFee} /></dd>
                    <dt><strong>{t('totalToPay')}</strong></dt><dd><strong><Money baisa={quote.total} /></strong></dd>
                  </dl>
                  <p className="small muted" style={{ marginBlockStart: '.7rem', marginBlockEnd: 0 }}>
                    {pick(quote.feeScheduleNote.ar, quote.feeScheduleNote.en)}
                  </p>
                </div>
              ) : null}
            </div>
          </Card>

          <Card title={t('acknowledgements')}>
            <div className="stack-sm">
              {(acknowledgements.data?.acknowledgements ?? []).map((item: any) => (
                <label key={item.code} className="checkbox">
                  <input
                    type="checkbox" checked={Boolean(checked[item.code])}
                    onChange={(event) => setChecked((previous) => ({ ...previous, [item.code]: event.target.checked }))}
                  />
                  <span>{pick(item.textAr, item.textEn)}</span>
                </label>
              ))}
              {!allAcknowledged ? <p className="small muted" style={{ margin: 0 }}>{t('acknowledgeAll')}</p> : null}
              {disclosure ? (
                <p className="small muted" style={{ margin: 0 }}>
                  {t('disclosureVersion')}: v{disclosure.version} · <span className="mono">{disclosure.contentHash.slice(0, 16)}…</span>
                </p>
              ) : null}
            </div>
          </Card>

          <ErrorNotice error={orderMutation.error} />

          <div className="notice notice--info small">{t('paymentNote')}</div>

          <button
            type="button" className="btn btn--primary btn--block"
            disabled={!canSubmit || orderMutation.pending}
            onClick={async () => {
              const result = await orderMutation.run({
                poolId, amount: amountBaisa, disclosureVersionId: disclosure.id,
                acknowledgements: Object.keys(checked).filter((code) => checked[code]),
              });
              if (result) navigate(`/orders/${result.orderId}`);
            }}
          >
            {orderMutation.pending ? t('loading') : t('proceedToPayment')}
          </button>
        </div>

        <aside className="stack">
          <Card title={t('tabRisks')}>
            <ul className="small" style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
              <li>{locale === 'ar' ? 'قد تخسر كامل المبلغ المستثمر.' : 'You may lose your entire investment.'}</li>
              <li>{locale === 'ar' ? 'لا توجد سوق ثانوية ولا استرداد مبكر.' : 'There is no secondary market and no early redemption.'}</li>
              <li>{locale === 'ar' ? 'السيناريوهات توقعات وليست وعودًا.' : 'Scenarios are projections, not promises.'}</li>
            </ul>
            <Link to="/risks" className="btn btn--ghost btn--sm" style={{ marginBlockStart: '.6rem' }}>
              {t('navRisks')} →
            </Link>
          </Card>

          <Card title={t('eligibilityTitle')}>
            <div className="stack-sm small">
              <div className="row row--between">
                <span className="muted">{t('availableToYou')}</span>
                <Money baisa={eligibility.availableAmount} decimals={0} />
              </div>
              <Badge tone="positive">{locale === 'ar' ? 'مستوفٍ للمتطلبات' : 'Requirements met'}</Badge>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
