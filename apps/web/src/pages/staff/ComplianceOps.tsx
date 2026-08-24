/** FR-601 … FR-605 — KYC review queue, cases and complaints with SLA. */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Badge, Card, Empty, ErrorNotice, Loading, StatusBadge, Tabs } from '../../components/ui.tsx';

export function ComplianceOps() {
  const { locale } = useI18n();
  const [tab, setTab] = useState<'kyc' | 'cases'>('kyc');

  return (
    <div className="stack">
      <Tabs<'kyc' | 'cases'>
        active={tab} onChange={setTab}
        tabs={[
          { key: 'kyc', label: locale === 'ar' ? 'مراجعة الهوية' : 'Identity review' },
          { key: 'cases', label: locale === 'ar' ? 'الحالات والشكاوى' : 'Cases & complaints' },
        ]}
      />
      {tab === 'kyc' ? <KycQueue /> : <CaseQueue />}
    </div>
  );
}

function KycQueue() {
  const { t, locale, formatDate } = useI18n();
  const queue = useQuery<any>('/identity/admin/kyc/queue');
  const decide = useMutation((payload: { profileId: string; decision: string; reason: string }) =>
    api.post(`/identity/admin/kyc/${payload.profileId}/decision`,
             { decision: payload.decision, reason: payload.reason }));
  const restrict = useMutation((payload: { userId: string; status: string; reason: string }) =>
    api.post(`/identity/admin/users/${payload.userId}/restrict`,
             { status: payload.status, reason: payload.reason }));

  if (queue.loading) return <Loading rows={5} />;
  if (queue.error) return <ErrorNotice error={queue.error} onRetry={queue.reload} />;

  const ask = (message: string) => window.prompt(message) ?? '';

  return (
    <Card title={t('queueKyc')} actions={<Badge>{queue.data?.count ?? 0}</Badge>}>
      <ErrorNotice error={decide.error ?? restrict.error} />
      {(queue.data?.items ?? []).length === 0 ? <Empty /> : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('fullName')}</th><th>{t('email')}</th><th>{t('kycStatus')}</th>
                <th>{locale === 'ar' ? 'المخاطر' : 'Risk'}</th><th>{locale === 'ar' ? 'إشارات' : 'Flags'}</th>
                <th>{t('date')}</th><th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {queue.data.items.map((item: any) => (
                <tr key={item.profile_id}>
                  <td>{item.full_name}</td>
                  <td className="small" dir="ltr">{item.email}</td>
                  <td><StatusBadge status={item.kyc_status} /></td>
                  <td>
                    <Badge tone={item.risk_rating === 'high' ? 'danger' : item.risk_rating === 'medium' ? 'warning' : 'positive'}>
                      {item.risk_rating ?? '—'}
                    </Badge>
                  </td>
                  <td>
                    <div className="row" style={{ gap: '.25rem' }}>
                      {item.sanctions_flag === 1 ? <Badge tone="danger">Sanctions</Badge> : null}
                      {item.pep_flag === 1 ? <Badge tone="warning">PEP</Badge> : null}
                    </div>
                  </td>
                  <td className="small">{formatDate(item.updated_at)}</td>
                  <td>
                    <div className="row" style={{ gap: '.3rem' }}>
                      <button type="button" className="btn btn--sm btn--primary" disabled={decide.pending}
                              onClick={async () => {
                                const reason = ask(locale === 'ar' ? 'مبرر الاعتماد (5 أحرف على الأقل)' : 'Approval reason (5+ characters)');
                                if (reason.length >= 5 && await decide.run({ profileId: item.profile_id, decision: 'approved', reason })) queue.reload();
                              }}>
                        {t('approve')}
                      </button>
                      <button type="button" className="btn btn--sm btn--danger" disabled={decide.pending}
                              onClick={async () => {
                                const reason = ask(locale === 'ar' ? 'مبرر الرفض (5 أحرف على الأقل)' : 'Rejection reason (5+ characters)');
                                if (reason.length >= 5 && await decide.run({ profileId: item.profile_id, decision: 'rejected', reason })) queue.reload();
                              }}>
                        {t('reject')}
                      </button>
                      <button type="button" className="btn btn--sm" disabled={restrict.pending}
                              onClick={async () => {
                                const reason = ask(locale === 'ar' ? 'مبرر التقييد' : 'Restriction reason');
                                if (reason.length >= 5 && await restrict.run({ userId: item.user_id, status: 'restricted', reason })) queue.reload();
                              }}>
                        {locale === 'ar' ? 'تقييد' : 'Restrict'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CaseQueue() {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const [filters, setFilters] = useState({ type: '', status: '', overdue: false });

  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value !== '' && value !== false)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
  const cases = useQuery<any>(`/cases?${query}`, [query]);

  const assign = useMutation((id: string) => api.post(`/cases/${id}/assign`, { assigneeId: auth.user!.id }));
  const note = useMutation((payload: { id: string; body: string; internal: boolean }) =>
    api.post(`/cases/${payload.id}/notes`, { body: payload.body, internal: payload.internal }));
  const escalate = useMutation((payload: { id: string; reason: string }) =>
    api.post(`/cases/${payload.id}/escalate`, { reason: payload.reason }));
  const resolve = useMutation((payload: { id: string; resolution: string }) =>
    api.post(`/cases/${payload.id}/resolve`, { resolution: payload.resolution }));

  const ask = (message: string) => window.prompt(message) ?? '';
  const reload = () => cases.reload();

  return (
    <Card
      title={locale === 'ar' ? 'الحالات والشكاوى' : 'Cases & complaints'}
      actions={cases.data ? (
        <div className="row" style={{ gap: '.4rem' }}>
          <Badge>{cases.data.counts.total}</Badge>
          {cases.data.counts.overdue > 0 ? <Badge tone="danger">SLA {cases.data.counts.overdue}</Badge> : null}
          {cases.data.counts.unassigned > 0 ? <Badge tone="warning">{cases.data.counts.unassigned}</Badge> : null}
        </div>
      ) : null}
    >
      <div className="filters" style={{ marginBlockEnd: '1rem' }}>
        <div className="field">
          <label htmlFor="case-type">{locale === 'ar' ? 'النوع' : 'Type'}</label>
          <select id="case-type" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
            <option value="">{t('all')}</option>
            {['complaint', 'kyc_review', 'recon_break', 'report_late', 'default', 'dsar', 'material_change'].map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="case-status">{t('status')}</label>
          <select id="case-status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">{t('all')}</option>
            {['open', 'in_progress', 'escalated', 'closed'].map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
        <label className="checkbox" style={{ alignItems: 'center' }}>
          <input type="checkbox" checked={filters.overdue}
                 onChange={(e) => setFilters((f) => ({ ...f, overdue: e.target.checked }))} />
          <span>{locale === 'ar' ? 'متجاوز SLA فقط' : 'Over SLA only'}</span>
        </label>
      </div>

      <ErrorNotice error={assign.error ?? note.error ?? escalate.error ?? resolve.error} />

      {cases.loading ? <Loading /> : (cases.data?.items ?? []).length === 0 ? <Empty /> : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('reference')}</th><th>{locale === 'ar' ? 'النوع' : 'Type'}</th>
                <th>{t('complaintSubject')}</th><th>{locale === 'ar' ? 'الأولوية' : 'Severity'}</th>
                <th>{t('status')}</th><th>SLA</th><th>{locale === 'ar' ? 'المسؤول' : 'Owner'}</th><th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {cases.data.items.map((item: any) => {
                const overdue = !item.closed_at && new Date(item.sla_due_at) < new Date();
                return (
                  <tr key={item.id}>
                    <td className="mono small">{item.reference}</td>
                    <td className="small">{item.type}</td>
                    <td>{item.subject}</td>
                    <td>
                      <Badge tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'warning' : 'neutral'}>
                        {item.severity}
                      </Badge>
                    </td>
                    <td><StatusBadge status={item.status} /></td>
                    <td className="small">
                      {overdue ? <Badge tone="danger">{formatDate(item.sla_due_at)}</Badge> : formatDate(item.sla_due_at)}
                    </td>
                    <td className="small">{item.assignee_name ?? '—'}</td>
                    <td>
                      <div className="row" style={{ gap: '.3rem' }}>
                        {!item.assignee_id ? (
                          <button type="button" className="btn btn--sm" disabled={assign.pending}
                                  onClick={async () => { if (await assign.run(item.id)) reload(); }}>
                            {locale === 'ar' ? 'إسناد لي' : 'Take'}
                          </button>
                        ) : null}
                        {item.status !== 'closed' ? (
                          <>
                            <button type="button" className="btn btn--sm"
                                    onClick={async () => {
                                      const body = ask(locale === 'ar' ? 'ملاحظة داخلية' : 'Internal note');
                                      if (body && await note.run({ id: item.id, body, internal: true })) reload();
                                    }}>
                              {locale === 'ar' ? 'ملاحظة' : 'Note'}
                            </button>
                            <button type="button" className="btn btn--sm"
                                    onClick={async () => {
                                      const reason = ask(locale === 'ar' ? 'سبب التصعيد (10 أحرف)' : 'Escalation reason (10+)');
                                      if (reason.length >= 10 && await escalate.run({ id: item.id, reason })) reload();
                                    }}>
                              {locale === 'ar' ? 'تصعيد' : 'Escalate'}
                            </button>
                            <button type="button" className="btn btn--sm btn--primary"
                                    onClick={async () => {
                                      const resolution = ask(locale === 'ar' ? 'ملخص المعالجة (10 أحرف)' : 'Resolution summary (10+)');
                                      if (resolution.length >= 10 && await resolve.run({ id: item.id, resolution })) reload();
                                    }}>
                              {locale === 'ar' ? 'إغلاق' : 'Resolve'}
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
