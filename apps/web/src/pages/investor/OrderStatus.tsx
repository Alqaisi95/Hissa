/**
 * FR-305 / AT-09 — the commitment status view. A pending order is presented as
 * pending; the UI never guesses a failure from a delay.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { Card, ErrorNotice, Loading, Money, StatusBadge, Badge, Reason } from '../../components/ui.tsx';

export function OrderStatus() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { t, pick, locale, formatDate } = useI18n();
  const payment = (location.state as any)?.payment;

  const order = useQuery<any>(`/orders/${id}`, [id]);
  const [poll, setPoll] = useState(0);
  const status = useQuery<any>(`/orders/${id}/status`, [id, poll]);

  // While the partner settles, poll gently rather than leaving a stale screen.
  useEffect(() => {
    if (status.data?.status !== 'pending') return;
    const timer = setTimeout(() => { setPoll((n) => n + 1); order.reload(); }, 5_000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data?.status, poll]);

  if (order.loading) return <Loading rows={6} />;
  if (order.error) return <ErrorNotice error={order.error} onRetry={order.reload} />;
  if (!order.data) return null;

  const { order: o, pool, refunds } = order.data;
  const isPending = o.status === 'pending';
  const isConfirmed = o.status === 'confirmed' || o.status === 'allocated';

  return (
    <div className="stack">
      <div className="row row--between">
        <h1 style={{ margin: 0 }}>{o.reference}</h1>
        <StatusBadge status={o.status} />
      </div>

      {isPending ? (
        <div className="notice notice--info" role="status">{t('orderPending')}</div>
      ) : isConfirmed ? (
        <div className="notice notice--success" role="status">{t('orderConfirmed')}</div>
      ) : null}

      {isPending && payment?.redirectUrl ? (
        <Card title={t('proceedToPayment')}>
          <div className="stack-sm">
            <p className="small muted" style={{ margin: 0 }}>{t('paymentNote')}</p>
            <a href={payment.redirectUrl} target="_blank" rel="noreferrer" className="btn btn--primary">
              {t('proceedToPayment')} ↗
            </a>
            <span className="small mono muted">{payment.providerRef}</span>
          </div>
        </Card>
      ) : null}

      <div className="grid grid--two">
        <Card title={t('details')}>
          <dl className="kv" style={{ marginBlockEnd: 0 }}>
            <dt>{locale === 'ar' ? 'الفرصة' : 'Opportunity'}</dt>
            <dd><Link to={`/opportunities/${pool.id}`}>{pick(pool.title_ar, null)}</Link></dd>
            <dt>{t('amount')}</dt><dd><Money baisa={o.amount} /></dd>
            {o.allocated_amount !== null ? (
              <>
                <dt>{locale === 'ar' ? 'المبلغ المخصص' : 'Allocated'}</dt>
                <dd><Money baisa={o.allocated_amount} /></dd>
              </>
            ) : null}
            {o.refunded_amount > 0 ? (
              <>
                <dt>{locale === 'ar' ? 'المسترد' : 'Refunded'}</dt>
                <dd><Money baisa={o.refunded_amount} /></dd>
              </>
            ) : null}
            <dt>{t('units')}</dt><dd className="numeric">{o.units}</dd>
            <dt>{t('date')}</dt><dd>{formatDate(o.created_at, true)}</dd>
            {o.confirmed_at ? (
              <><dt>{locale === 'ar' ? 'تاريخ التأكيد' : 'Confirmed'}</dt><dd>{formatDate(o.confirmed_at, true)}</dd></>
            ) : null}
          </dl>
        </Card>

        <Card title={locale === 'ar' ? 'حالة الدفع' : 'Payment status'}>
          <div className="stack-sm">
            {order.data.payment ? (
              <dl className="kv" style={{ marginBlockEnd: 0 }}>
                <dt>{t('reference')}</dt><dd className="mono small">{order.data.payment.providerRef}</dd>
                <dt>{t('status')}</dt><dd><StatusBadge status={order.data.payment.status} /></dd>
                <dt>{t('date')}</dt><dd>{formatDate(order.data.payment.createdAt, true)}</dd>
              </dl>
            ) : <p className="muted small" style={{ margin: 0 }}>—</p>}
            <p className="small muted" style={{ margin: 0 }}>
              {locale === 'ar'
                ? 'تُحفظ الأموال لدى الشريك المرخّص في حساب ضمان منفصل.'
                : 'Funds are held by the licensed partner in a segregated escrow account.'}
            </p>
          </div>
        </Card>
      </div>

      {refunds?.length ? (
        <Card title={locale === 'ar' ? 'الاسترداد' : 'Refunds'}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>{t('amount')}</th><th>{t('status')}</th><th>{t('reason')}</th><th>{t('date')}</th></tr>
              </thead>
              <tbody>
                {refunds.map((refund: any) => (
                  <tr key={refund.id}>
                    <td className="num"><Money baisa={refund.amount} /></td>
                    <td><StatusBadge status={refund.status} /></td>
                    <td><Reason code={refund.reason} /></td>
                    <td>{formatDate(refund.settled_at ?? refund.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {isConfirmed ? <Receipt orderId={o.id} /> : null}

      {isPending ? <CancelOrder orderId={o.id} onCancelled={order.reload} /> : null}
    </div>
  );
}

function Receipt({ orderId }: { orderId: string }) {
  const { t, locale, formatDate } = useI18n();
  const receipt = useQuery<any>(`/orders/${orderId}/receipt`, [orderId]);
  if (receipt.loading || !receipt.data) return null;

  const r = receipt.data.receipt;
  return (
    <Card title={t('downloadReceipt')}>
      <dl className="kv" style={{ marginBlockEnd: '1rem' }}>
        <dt>{t('reference')}</dt><dd className="mono">{r.reference}</dd>
        <dt>{locale === 'ar' ? 'المستثمر' : 'Investor'}</dt><dd>{r.investorName}</dd>
        <dt>{locale === 'ar' ? 'الفرصة' : 'Opportunity'}</dt><dd>{r.poolTitle} ({r.poolReference})</dd>
        <dt>{t('amount')}</dt><dd><Money baisa={r.allocatedAmount} /></dd>
        <dt>{t('units')}</dt><dd className="numeric">{r.units}</dd>
        <dt>{t('disclosureVersion')}</dt><dd>v{r.disclosureVersion}</dd>
        <dt>{locale === 'ar' ? 'بصمة الإفصاح' : 'Disclosure hash'}</dt>
        <dd className="mono small" style={{ wordBreak: 'break-all' }}>{r.disclosureHash}</dd>
        <dt>{t('date')}</dt><dd>{formatDate(r.issuedAt, true)}</dd>
      </dl>
      <div className="notice notice--info small">{r.riskNoteAr}</div>
      <div className="row" style={{ marginBlockStart: '.75rem' }}>
        <button type="button" className="btn btn--sm" onClick={() => window.print()}>
          {locale === 'ar' ? 'طباعة / حفظ PDF' : 'Print / save as PDF'}
        </button>
        {(receipt.data.agreements ?? []).map((agreement: any) => (
          <Badge key={agreement.id} tone="info">{agreement.file_name}</Badge>
        ))}
      </div>
    </Card>
  );
}

function CancelOrder({ orderId, onCancelled }: { orderId: string; onCancelled: () => void }) {
  const { t, locale } = useI18n();
  const cancel = useMutation(() => api.post(`/orders/${orderId}/cancel`));

  return (
    <div className="stack-sm">
      <ErrorNotice error={cancel.error} />
      <button
        type="button" className="btn btn--sm" disabled={cancel.pending}
        onClick={async () => { if (await cancel.run()) onCancelled(); }}
      >
        {locale === 'ar' ? 'سحب الالتزام قبل التأكيد' : 'Withdraw before confirmation'}
      </button>
    </div>
  );
}
