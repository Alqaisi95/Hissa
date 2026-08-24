/** FR-107 / FR-108 / BR-016 — committee pack, quorum-aware voting, reasoned decision. */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Badge, Card, Empty, ErrorNotice, Field, Loading, Money, StatusBadge } from '../../components/ui.tsx';

export function Committee() {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const sessions = useQuery<any>('/origination/committee/sessions');
  const [selected, setSelected] = useState<string | null>(null);

  if (sessions.loading) return <Loading rows={5} />;
  if (sessions.error) return <ErrorNotice error={sessions.error} onRetry={sessions.reload} />;

  return (
    <div className="stack">
      <Card title={t('queueCommittee')}>
        {(sessions.data?.items ?? []).length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('reference')}</th><th>{locale === 'ar' ? 'المشروع' : 'Project'}</th>
                  <th>{t('amount')}</th><th>{locale === 'ar' ? 'الدرجة' : 'Score'}</th>
                  <th>{t('status')}</th><th>{t('date')}</th><th />
                </tr>
              </thead>
              <tbody>
                {sessions.data.items.map((session: any) => (
                  <tr key={session.id}>
                    <td className="mono small">{session.reference}</td>
                    <td>{session.title_ar}</td>
                    <td className="num"><Money baisa={session.requested_amount} decimals={0} /></td>
                    <td className="num">{session.risk_score} · {session.risk_grade}</td>
                    <td>
                      <StatusBadge status={session.status === 'decided' ? (session.decision ?? 'decided') : session.status} />
                    </td>
                    <td className="small">{formatDate(session.opened_at)}</td>
                    <td>
                      <button type="button" className="btn btn--sm"
                              onClick={() => setSelected(selected === session.id ? null : session.id)}>
                        {selected === session.id ? t('close') : t('viewDetails')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected ? (
        <SessionDetail
          session={sessions.data.items.find((s: any) => s.id === selected)}
          canVote={auth.has('committee_member')}
          onChanged={() => sessions.reload()}
        />
      ) : null}
    </div>
  );
}

function SessionDetail({ session, canVote, onChanged }: { session: any; canVote: boolean; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const [vote, setVote] = useState({ vote: 'approve', rationale: '', conflictDeclared: false });
  const [decision, setDecision] = useState({
    decision: 'approved', reason: '', conditions: '', applicantMessage: '',
  });
  const [tally, setTally] = useState<any>(null);

  const castVote = useMutation(() => api.post(`/origination/committee/sessions/${session.id}/vote`, vote));
  const decide = useMutation(() => api.post(`/origination/committee/sessions/${session.id}/decide`, {
    decision: decision.decision, reason: decision.reason,
    conditions: decision.conditions.split('\n').map((line) => line.trim()).filter(Boolean),
    applicantMessage: decision.applicantMessage,
  }));

  const decided = session.status === 'decided';

  return (
    <div className="stack">
      <Card title={locale === 'ar' ? 'حزمة القرار' : 'Decision pack'}>
        <dl className="kv" style={{ marginBlockEnd: '.75rem' }}>
          <dt>{locale === 'ar' ? 'بصمة الحزمة' : 'Pack hash'}</dt>
          <dd className="mono small" style={{ wordBreak: 'break-all' }}>{session.pack_hash}</dd>
          <dt>{locale === 'ar' ? 'النصاب' : 'Quorum'}</dt><dd>{session.quorum}</dd>
          <dt>{locale === 'ar' ? 'درجة المخاطر' : 'Risk score'}</dt>
          <dd>{session.risk_score} · {session.risk_grade}</dd>
        </dl>
        {decided ? (
          <div className="stack-sm">
            <div className="row">
              <StatusBadge status={session.decision} />
              <span className="small muted">{session.decision_reason}</span>
            </div>
            {(session.conditions ?? []).length > 0 ? (
              <ul className="small" style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
                {session.conditions.map((condition: string, index: number) => <li key={index}>{condition}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      {!decided && canVote ? (
        <Card title={locale === 'ar' ? 'تسجيل الصوت' : 'Cast your vote'}>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await castVote.run()) { setVote({ vote: 'approve', rationale: '', conflictDeclared: false }); onChanged(); }
            }}
          >
            {/* BR-016 — declaring a conflict converts the vote into a recusal server-side. */}
            <label className="checkbox">
              <input type="checkbox" checked={vote.conflictDeclared}
                     onChange={(e) => setVote((v) => ({ ...v, conflictDeclared: e.target.checked }))} />
              <span>
                {locale === 'ar'
                  ? 'أفصح عن تعارض مصالح — يُسجل صوتي كامتناع'
                  : 'I declare a conflict of interest — my vote is recorded as a recusal'}
              </span>
            </label>

            {!vote.conflictDeclared ? (
              <Field label={locale === 'ar' ? 'الصوت' : 'Vote'} htmlFor="vote">
                <select id="vote" value={vote.vote} onChange={(e) => setVote((v) => ({ ...v, vote: e.target.value }))}>
                  <option value="approve">{locale === 'ar' ? 'موافقة' : 'Approve'}</option>
                  <option value="conditional">{locale === 'ar' ? 'موافقة مشروطة' : 'Conditional'}</option>
                  <option value="reject">{locale === 'ar' ? 'رفض' : 'Reject'}</option>
                </select>
              </Field>
            ) : null}

            <Field label={locale === 'ar' ? 'المبرر' : 'Rationale'} htmlFor="rationale"
                   hint={locale === 'ar' ? '10 أحرف على الأقل — يُحفظ في سجل اللجنة' : 'At least 10 characters — retained in the committee record'}>
              <textarea id="rationale" rows={3} minLength={10} required value={vote.rationale}
                        onChange={(e) => setVote((v) => ({ ...v, rationale: e.target.value }))} />
            </Field>

            <ErrorNotice error={castVote.error} />
            <button type="submit" className="btn btn--primary" disabled={castVote.pending || vote.rationale.length < 10}>
              {t('submit')}
            </button>
          </form>
        </Card>
      ) : null}

      {!decided && canVote ? (
        <Card title={locale === 'ar' ? 'قرار اللجنة' : 'Committee decision'}>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await decide.run();
              if (result) { setTally(result.tally); onChanged(); }
            }}
          >
            <Field label={locale === 'ar' ? 'القرار' : 'Decision'} htmlFor="decision">
              <select id="decision" value={decision.decision}
                      onChange={(e) => setDecision((d) => ({ ...d, decision: e.target.value }))}>
                <option value="approved">{locale === 'ar' ? 'قبول' : 'Approved'}</option>
                <option value="conditional">{locale === 'ar' ? 'قبول مشروط' : 'Conditional'}</option>
                <option value="rejected">{locale === 'ar' ? 'رفض' : 'Rejected'}</option>
              </select>
            </Field>
            <Field label={locale === 'ar' ? 'المبرر الداخلي' : 'Internal rationale'} htmlFor="decision-reason"
                   hint={locale === 'ar' ? 'لا يظهر لمقدم الطلب' : 'Never shown to the applicant'}>
              <textarea id="decision-reason" rows={3} minLength={10} required value={decision.reason}
                        onChange={(e) => setDecision((d) => ({ ...d, reason: e.target.value }))} />
            </Field>
            {decision.decision === 'conditional' ? (
              <Field label={locale === 'ar' ? 'الشروط (سطر لكل شرط)' : 'Conditions (one per line)'} htmlFor="conditions">
                <textarea id="conditions" rows={3} value={decision.conditions}
                          onChange={(e) => setDecision((d) => ({ ...d, conditions: e.target.value }))} />
              </Field>
            ) : null}
            <Field label={locale === 'ar' ? 'الرسالة لمقدم الطلب' : 'Message to the applicant'} htmlFor="applicant-message"
                   hint={locale === 'ar' ? 'هذا وحده ما يصل صاحب المشروع' : 'This is the only text the applicant receives'}>
              <textarea id="applicant-message" rows={3} minLength={5} required value={decision.applicantMessage}
                        onChange={(e) => setDecision((d) => ({ ...d, applicantMessage: e.target.value }))} />
            </Field>

            <ErrorNotice error={decide.error} />
            {tally ? (
              <div className="notice notice--success small">
                {locale === 'ar' ? 'موافق' : 'Approve'}: {tally.approve} ·{' '}
                {locale === 'ar' ? 'مشروط' : 'Conditional'}: {tally.conditional} ·{' '}
                {locale === 'ar' ? 'رفض' : 'Reject'}: {tally.reject} ·{' '}
                {locale === 'ar' ? 'ممتنع' : 'Recused'}: {tally.recused}
              </div>
            ) : null}

            <button type="submit" className="btn btn--primary" disabled={decide.pending}>
              {locale === 'ar' ? 'تسجيل القرار' : 'Record decision'}
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
