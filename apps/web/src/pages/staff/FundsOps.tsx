/**
 * FR-402 … FR-407 — the money desk: reconciliation, closings, and every movement
 * that needs a second pair of eyes. Dual control is stated on screen, not implied.
 */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Badge, Card, Empty, ErrorNotice, Loading, Money, StatusBadge, Stat, Reason, Tabs } from '../../components/ui.tsx';
import { FundsCreate } from './FundsCreate.tsx';

export function FundsOps() {
  const { locale } = useI18n();
  const [view, setView] = useState<'approvals' | 'requests'>('approvals');

  return (
    <div className="stack">
      <Tabs<'approvals' | 'requests'>
        active={view} onChange={setView}
        tabs={[
          { key: 'approvals', label: locale === 'ar' ? 'بانتظار الاعتماد' : 'Awaiting approval' },
          { key: 'requests', label: locale === 'ar' ? 'طلبات ومطابقة' : 'Requests & reconciliation' },
        ]}
      />
      {view === 'approvals' ? <FundsApprovals /> : <FundsCreate />}
    </div>
  );
}

function FundsApprovals() {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const queue = useQuery<any>('/funds/queue');

  const approveDisbursement = useMutation((payload: { id: string; reason: string }) =>
    api.post(`/funds/disbursements/${payload.id}/approve`, { reason: payload.reason }));
  const submitRefund = useMutation((id: string) => api.post(`/funds/refunds/${id}/submit`));
  const approveRefund = useMutation((id: string) => api.post(`/funds/refunds/${id}/approve`));
  const approveDistribution = useMutation((payload: { id: string; reason: string }) =>
    api.post(`/funds/distributions/${payload.id}/approve`, { reason: payload.reason }));
  const closePool = useMutation((payload: { id: string; reason: string }) =>
    api.post(`/funds/pools/${payload.id}/close`, { reason: payload.reason }));
  const resolveBreak = useMutation((payload: { id: string; resolution: string }) =>
    api.post(`/funds/reconciliation/breaks/${payload.id}/resolve`, { resolution: payload.resolution }));

  if (queue.loading) return <Loading rows={6} />;
  if (queue.error) return <ErrorNotice error={queue.error} onRetry={queue.reload} />;

  const data = queue.data;
  const reload = () => queue.reload();
  const ask = (message: string) => window.prompt(message) ?? '';

  return (
    <div className="stack">
      <div className="notice notice--info small">{t('dualControlNote')}</div>

      <div className="grid grid--stats">
        <Stat label={locale === 'ar' ? 'صرف بانتظار الاعتماد' : 'Disbursements pending'} value={data.disbursements.length} />
        <Stat label={locale === 'ar' ? 'استرداد' : 'Refunds'} value={data.refunds.length} />
        <Stat label={locale === 'ar' ? 'توزيعات' : 'Distributions'} value={data.distributions.length} />
        <Stat label={t('queueBreaks')} value={data.breaks.length} />
        <Stat label={locale === 'ar' ? 'إغلاقات مستحقة' : 'Closings due'} value={data.closingDue.length} />
      </div>

      <ErrorNotice error={approveDisbursement.error ?? submitRefund.error ?? approveRefund.error
                         ?? approveDistribution.error ?? closePool.error ?? resolveBreak.error} />

      {/* FR-403 — closing is an approved action; the outcome is shown before it is taken. */}
      <Card title={locale === 'ar' ? 'إغلاقات مستحقة' : 'Closings due'}>
        {data.closingDue.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('reference')}</th><th>{locale === 'ar' ? 'الفرصة' : 'Pool'}</th>
                  <th>{locale === 'ar' ? 'المجمّع' : 'Committed'}</th><th>{locale === 'ar' ? 'الحد الأدنى' : 'Minimum'}</th>
                  <th>{locale === 'ar' ? 'النتيجة المتوقعة' : 'Expected outcome'}</th><th />
                </tr>
              </thead>
              <tbody>
                {data.closingDue.map((pool: any) => {
                  const willFund = pool.committed >= pool.min_amount;
                  return (
                    <tr key={pool.id}>
                      <td className="mono small">{pool.reference}</td>
                      <td>{pool.title_ar}</td>
                      <td className="num"><Money baisa={pool.committed} decimals={0} /></td>
                      <td className="num"><Money baisa={pool.min_amount} decimals={0} /></td>
                      <td>
                        <Badge tone={willFund ? 'positive' : 'warning'}>
                          {willFund ? (locale === 'ar' ? 'تمويل وتخصيص' : 'Fund & allocate')
                                    : (locale === 'ar' ? 'استرداد كامل' : 'Full refund')}
                        </Badge>
                      </td>
                      <td>
                        <button
                          type="button" className="btn btn--sm btn--primary" disabled={closePool.pending}
                          onClick={async () => {
                            const reason = ask(locale === 'ar' ? 'سبب الإغلاق (10 أحرف على الأقل)' : 'Closing reason (10+ characters)');
                            if (reason.length >= 10 && await closePool.run({ id: pool.id, reason })) reload();
                          }}
                        >
                          {locale === 'ar' ? 'إغلاق معتمد' : 'Approve close'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={locale === 'ar' ? 'صرف بانتظار الاعتماد' : 'Disbursements pending approval'}>
        {data.disbursements.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'الفرصة' : 'Pool'}</th><th>{locale === 'ar' ? 'المرحلة' : 'Milestone'}</th>
                  <th>{locale === 'ar' ? 'المستفيد' : 'Beneficiary'}</th><th>{t('amount')}</th>
                  <th>{locale === 'ar' ? 'الشرط' : 'Condition'}</th><th>{locale === 'ar' ? 'المنشئ' : 'Maker'}</th><th />
                </tr>
              </thead>
              <tbody>
                {data.disbursements.map((item: any) => {
                  const isMaker = item.created_by === auth.user?.id;
                  return (
                    <tr key={item.id}>
                      <td>{item.title_ar}</td>
                      <td>{item.milestone_label}</td>
                      <td>{item.beneficiary}</td>
                      <td className="num"><Money baisa={item.amount} /></td>
                      <td className="small">
                        {item.condition_met === 1
                          ? <Badge tone="positive">{locale === 'ar' ? 'مستوفى بدليل' : 'Met, evidenced'}</Badge>
                          : <Badge tone="warning">{locale === 'ar' ? 'غير مستوفى' : 'Not met'}</Badge>}
                      </td>
                      <td className="small">{item.created_by_name}</td>
                      <td>
                        {isMaker ? (
                          // FR-405 — the maker sees why they cannot approve.
                          <span className="small muted">{locale === 'ar' ? 'أنت المنشئ' : 'You are the maker'}</span>
                        ) : (
                          <button
                            type="button" className="btn btn--sm btn--primary" disabled={approveDisbursement.pending}
                            onClick={async () => {
                              const reason = ask(locale === 'ar' ? 'مبرر الاعتماد' : 'Approval reason');
                              if (reason.length >= 5 && await approveDisbursement.run({ id: item.id, reason })) reload();
                            }}
                          >
                            {t('approve')}
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

      <Card title={locale === 'ar' ? 'الاسترداد' : 'Refunds'}>
        {data.refunds.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'الفرصة' : 'Pool'}</th><th>{t('amount')}</th>
                  <th>{t('reason')}</th><th>{t('status')}</th><th />
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((refund: any) => {
                  const isMaker = refund.created_by === auth.user?.id;
                  return (
                    <tr key={refund.id}>
                      <td>{refund.title_ar}</td>
                      <td className="num"><Money baisa={refund.amount} /></td>
                      <td className="small"><Reason code={refund.reason} /></td>
                      <td><StatusBadge status={refund.status} /></td>
                      <td>
                        {refund.status === 'requested' ? (
                          <button type="button" className="btn btn--sm" disabled={submitRefund.pending}
                                  onClick={async () => { if (await submitRefund.run(refund.id)) reload(); }}>
                            {locale === 'ar' ? 'رفع للاعتماد' : 'Submit for approval'}
                          </button>
                        ) : isMaker ? (
                          <span className="small muted">{locale === 'ar' ? 'أنت المنشئ' : 'You are the maker'}</span>
                        ) : (
                          <button type="button" className="btn btn--sm btn--primary" disabled={approveRefund.pending}
                                  onClick={async () => { if (await approveRefund.run(refund.id)) reload(); }}>
                            {t('approve')}
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

      <Card title={locale === 'ar' ? 'التوزيعات' : 'Distributions'}>
        {data.distributions.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'الفرصة' : 'Pool'}</th><th>{locale === 'ar' ? 'الفترة' : 'Period'}</th>
                  <th>{locale === 'ar' ? 'الإجمالي' : 'Gross'}</th><th>{locale === 'ar' ? 'الرسوم' : 'Fees'}</th>
                  <th>{locale === 'ar' ? 'الصافي' : 'Net'}</th><th />
                </tr>
              </thead>
              <tbody>
                {data.distributions.map((distribution: any) => {
                  const isMaker = distribution.created_by === auth.user?.id;
                  return (
                    <tr key={distribution.id}>
                      <td>{distribution.title_ar}</td>
                      <td>{distribution.period_label}</td>
                      <td className="num"><Money baisa={distribution.gross_amount} /></td>
                      <td className="num"><Money baisa={distribution.fee_amount} /></td>
                      <td className="num"><Money baisa={distribution.net_amount} /></td>
                      <td>
                        {isMaker ? <span className="small muted">{locale === 'ar' ? 'أنت المنشئ' : 'You are the maker'}</span> : (
                          <button type="button" className="btn btn--sm btn--primary" disabled={approveDistribution.pending}
                                  onClick={async () => {
                                    const reason = ask(locale === 'ar' ? 'مبرر الاعتماد' : 'Approval reason');
                                    if (reason.length >= 5 && await approveDistribution.run({ id: distribution.id, reason })) reload();
                                  }}>
                            {t('approve')}
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

      <Card title={t('queueBreaks')}>
        {data.breaks.length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{locale === 'ar' ? 'النوع' : 'Type'}</th><th>{t('reference')}</th>
                  <th>{locale === 'ar' ? 'داخلي' : 'Internal'}</th><th>{locale === 'ar' ? 'خارجي' : 'External'}</th>
                  <th>SLA</th><th />
                </tr>
              </thead>
              <tbody>
                {data.breaks.map((item: any) => (
                  <tr key={item.id}>
                    <td><Badge tone="warning">{item.break_type}</Badge></td>
                    <td className="mono small">{item.provider_ref ?? item.order_reference ?? '—'}</td>
                    <td className="num">{item.internal_amount !== null ? <Money baisa={item.internal_amount} /> : '—'}</td>
                    <td className="num">{item.external_amount !== null ? <Money baisa={item.external_amount} /> : '—'}</td>
                    <td className="small">
                      {new Date(item.sla_due_at) < new Date()
                        ? <Badge tone="danger">{formatDate(item.sla_due_at)}</Badge>
                        : formatDate(item.sla_due_at)}
                    </td>
                    <td>
                      <button type="button" className="btn btn--sm" disabled={resolveBreak.pending}
                              onClick={async () => {
                                const resolution = ask(locale === 'ar' ? 'وصف المعالجة (10 أحرف على الأقل)' : 'Resolution (10+ characters)');
                                if (resolution.length >= 10 && await resolveBreak.run({ id: item.id, resolution })) reload();
                              }}>
                        {locale === 'ar' ? 'إغلاق الفرق' : 'Resolve'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginBlockStart: '.6rem', marginBlockEnd: 0 }}>
          {locale === 'ar'
            ? 'لا تُغلق الفروقات تلقائيًا. كل إغلاق يحتاج وصف معالجة ويُسجل في سجل التدقيق.'
            : 'Breaks are never auto-closed. Every resolution needs a written explanation and is recorded in the audit log.'}
        </p>
      </Card>
    </div>
  );
}
