/** FR-105 … FR-106 — the analyst's case workspace: checklist, requests, scoring. */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import {
  Badge, Card, Empty, ErrorNotice, Field, Loading, Money, StatusBadge,
} from '../../components/ui.tsx';

export function DueDiligence() {
  const { t, locale, formatDate } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const cases = useQuery<any>('/origination/cases');

  if (cases.loading) return <Loading rows={6} />;
  if (cases.error) return <ErrorNotice error={cases.error} onRetry={cases.reload} />;

  return (
    <div className="stack">
      <Card title={t('queueDd')} actions={<Badge>{cases.data?.count ?? 0}</Badge>}>
        {(cases.data?.items ?? []).length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('reference')}</th><th>{locale === 'ar' ? 'المشروع' : 'Project'}</th>
                  <th>{locale === 'ar' ? 'المبلغ' : 'Amount'}</th><th>{t('status')}</th>
                  <th>{locale === 'ar' ? 'الدرجة' : 'Score'}</th><th>{locale === 'ar' ? 'المحلل' : 'Analyst'}</th>
                  <th>SLA</th><th />
                </tr>
              </thead>
              <tbody>
                {cases.data.items.map((item: any) => {
                  const overdue = new Date(item.sla_due_at) < new Date() && item.status !== 'decided';
                  return (
                    <tr key={item.id}>
                      <td className="mono small">{item.reference}</td>
                      <td>{item.title_ar}<div className="small muted">{item.legal_name}</div></td>
                      <td className="num"><Money baisa={item.requested_amount} decimals={0} /></td>
                      <td><StatusBadge status={item.status} /></td>
                      <td className="num">
                        {item.risk_score !== null
                          ? <Badge tone={item.risk_grade === 'A' || item.risk_grade === 'B' ? 'positive' : item.risk_grade === 'C' ? 'warning' : 'danger'}>
                              {item.risk_score} · {item.risk_grade}
                            </Badge>
                          : '—'}
                      </td>
                      <td className="small">{item.analyst_name ?? '—'}</td>
                      <td className="small">
                        {overdue ? <Badge tone="danger">{formatDate(item.sla_due_at)}</Badge> : formatDate(item.sla_due_at)}
                      </td>
                      <td>
                        <button type="button" className="btn btn--sm"
                                onClick={() => setSelected(selected === item.id ? null : item.id)}>
                          {selected === item.id ? t('close') : t('viewDetails')}
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

      {selected ? <CaseWorkspace caseId={selected} onChanged={() => cases.reload()} /> : null}
    </div>
  );
}

function CaseWorkspace({ caseId, onChanged }: { caseId: string; onChanged: () => void }) {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const detail = useQuery<any>(`/origination/cases/${caseId}`, [caseId]);
  // Compliance and audit see the case in full; only the analyst can work it.
  const canAct = auth.has('investment_analyst');

  const assign = useMutation(() => api.post(`/origination/cases/${caseId}/assign`, { analystId: auth.user!.id }));
  const updateItem = useMutation((payload: { itemId: string; status: string; note?: string }) =>
    api.patch(`/origination/cases/${caseId}/checklist/${payload.itemId}`, { status: payload.status, note: payload.note }));
  const request = useMutation((bodyAr: string) => api.post(`/origination/cases/${caseId}/requests`, { bodyAr }));
  const promote = useMutation(() => api.post(`/origination/cases/${caseId}/to-committee`));

  const [requestText, setRequestText] = useState('');

  if (detail.loading) return <Loading rows={6} />;
  if (!detail.data) return null;

  const { case: ddCase, application, entity, checklist, infoRequests, feeds } = detail.data;
  const reload = () => { detail.reload(); onChanged(); };
  const mandatoryOutstanding = checklist.filter((i: any) => i.mandatory === 1 && !['satisfied', 'waived'].includes(i.status));

  return (
    <div className="stack">
      <Card title={application.title_ar} actions={<StatusBadge status={ddCase.status} />}>
        <div className="grid grid--two">
          <dl className="kv" style={{ marginBlockEnd: 0 }}>
            <dt>{locale === 'ar' ? 'الشركة' : 'Company'}</dt><dd>{entity.legal_name}</dd>
            <dt>{locale === 'ar' ? 'س.ت' : 'CR'}</dt><dd dir="ltr">{entity.cr_number}</dd>
            <dt>{locale === 'ar' ? 'التأسيس' : 'Incorporated'}</dt><dd>{formatDate(entity.incorporated_on)}</dd>
            <dt>{locale === 'ar' ? 'المبلغ المطلوب' : 'Requested'}</dt>
            <dd><Money baisa={application.requested_amount} decimals={0} /></dd>
            <dt>{locale === 'ar' ? 'مساهمة المالك' : 'Owner contribution'}</dt>
            <dd><Money baisa={application.owner_contribution} decimals={0} /></dd>
          </dl>

          <div>
            <h4 style={{ marginBlockEnd: '.4rem' }}>{t('useOfFunds')}</h4>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>{locale === 'ar' ? 'البند' : 'Item'}</th><th>{locale === 'ar' ? 'المورد' : 'Supplier'}</th>
                      <th>{t('amount')}</th></tr>
                </thead>
                <tbody>
                  {(application.use_of_funds ?? []).map((item: any, index: number) => (
                    <tr key={index}>
                      <td>{item.item}</td>
                      <td className="small">{item.supplier}</td>
                      <td className="num"><Money baisa={item.amount} decimals={0} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {!ddCase.analyst_id && canAct ? (
          <div className="row" style={{ marginBlockStart: '1rem' }}>
            <button type="button" className="btn btn--primary btn--sm" disabled={assign.pending}
                    onClick={async () => { if (await assign.run()) reload(); }}>
              {locale === 'ar' ? 'إسناد الحالة لي' : 'Assign to me'}
            </button>
          </div>
        ) : null}
      </Card>

      <Card title={locale === 'ar' ? 'قائمة العناية الواجبة' : 'Due-diligence checklist'}
            actions={<Badge tone={mandatoryOutstanding.length ? 'warning' : 'positive'}>
              {checklist.filter((i: any) => i.status === 'satisfied').length}/{checklist.length}
            </Badge>}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{locale === 'ar' ? 'البند' : 'Item'}</th><th>{locale === 'ar' ? 'إلزامي' : 'Mandatory'}</th>
                <th>{t('status')}</th>{canAct ? <th>{t('actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {checklist.map((item: any) => (
                <tr key={item.id}>
                  <td>{item.label_ar}</td>
                  <td>{item.mandatory === 1 ? <Badge tone="info">{locale === 'ar' ? 'نعم' : 'Yes'}</Badge> : '—'}</td>
                  <td><StatusBadge status={item.status} /></td>
                  {!canAct ? null : (
                  <td>
                    <div className="row" style={{ gap: '.3rem' }}>
                      <button type="button" className="btn btn--sm" disabled={updateItem.pending}
                              onClick={async () => { if (await updateItem.run({ itemId: item.id, status: 'satisfied', note: 'تم التحقق' })) reload(); }}>
                        ✓
                      </button>
                      <button type="button" className="btn btn--sm" disabled={updateItem.pending}
                              onClick={async () => {
                                const note = window.prompt(locale === 'ar' ? 'سبب الاستثناء (10 أحرف على الأقل)' : 'Waiver justification (10+ characters)');
                                if (note && await updateItem.run({ itemId: item.id, status: 'waived', note })) reload();
                              }}>
                        {locale === 'ar' ? 'استثناء' : 'Waive'}
                      </button>
                    </div>
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ErrorNotice error={updateItem.error} />
      </Card>

      <Card title={t('infoRequests')}>
        <div className="stack-sm">
          {infoRequests.length === 0 ? <Empty /> : infoRequests.map((item: any) => (
            <div key={item.id} className="panel">
              <div className="row row--between">
                <strong className="small">{item.body_ar}</strong>
                <StatusBadge status={item.status} />
              </div>
              {item.answer_body ? <p className="small" style={{ margin: '.4rem 0 0' }}>{item.answer_body}</p> : null}
              <span className="small muted">{t('slaDue')}: {formatDate(item.due_at, true)}</span>
            </div>
          ))}

          {!canAct ? null : (
          <form
            className="stack-sm"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await request.run(requestText)) { setRequestText(''); reload(); }
            }}
          >
            <Field label={locale === 'ar' ? 'طلب استكمال جديد' : 'New information request'} htmlFor="req">
              <textarea id="req" value={requestText} minLength={10} rows={3}
                        onChange={(event) => setRequestText(event.target.value)} />
            </Field>
            <ErrorNotice error={request.error} />
            <div className="row row--end">
              <button type="submit" className="btn btn--sm" disabled={request.pending || requestText.length < 10}>
                {t('submit')}
              </button>
            </div>
          </form>
          )}
        </div>
      </Card>

      <ScoringForm caseId={caseId} current={ddCase} onScored={reload} feeds={feeds}
                   application={application} canAct={canAct} />

      {!canAct ? (
        <div className="notice notice--info small">
          {locale === 'ar'
            ? 'لديك صلاحية اطلاع رقابي على هذه الحالة دون تنفيذ إجراءات العناية الواجبة.'
            : 'You have oversight read access to this case; due-diligence actions belong to the assigned analyst.'}
        </div>
      ) : (
      <div className="stack-sm">
        <ErrorNotice error={promote.error} />
        <div className="row">
          <button type="button" className="btn btn--primary" disabled={promote.pending}
                  onClick={async () => { if (await promote.run()) reload(); }}>
            {locale === 'ar' ? 'رفع للجنة الاستثمار' : 'Send to investment committee'}
          </button>
          {mandatoryOutstanding.length ? (
            <span className="small muted">
              {locale === 'ar' ? 'بنود إلزامية غير مكتملة' : 'Mandatory items outstanding'}: {mandatoryOutstanding.length}
            </span>
          ) : null}
        </div>
      </div>
      )}
    </div>
  );
}

function ScoringForm({ caseId, current, onScored, feeds, application, canAct }: {
  caseId: string; current: any; onScored: () => void; feeds: any[]; application: any; canAct: boolean;
}) {
  const { t, locale } = useI18n();
  const [inputs, setInputs] = useState({
    monthsTrading: 24, revenueStabilityBps: 7_500,
    ownerContributionBps: Math.round((application.owner_contribution * 10_000) /
      Math.max(1, application.requested_amount + application.owner_contribution)),
    dataQuality: feeds.some((f: any) => f.source === 'bank_api') ? 'bank_api'
      : feeds.some((f: any) => f.source === 'pos_api') ? 'pos_api'
      : feeds.length ? 'statement_upload' : 'none',
    useOfFundsSpecificity: (application.use_of_funds ?? []).every((i: any) => i.quoteReference) && application.use_of_funds?.length
      ? 'itemised_quotes' : application.use_of_funds?.length ? 'partial' : 'narrative',
    sectorRisk: 'medium', managementDepth: 'owner_plus',
    existingLeverageBps: 1_500, licensesComplete: true, supplierConcentrationBps: 4_000,
  });
  const [outcome, setOutcome] = useState<any>(null);
  const score = useMutation(() => api.post(`/origination/cases/${caseId}/score`, inputs));

  return (
    <Card title={locale === 'ar' ? 'نموذج المخاطر' : 'Risk model'}
          actions={current.model_version ? <Badge tone="info">{current.model_version}</Badge> : null}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await score.run();
          if (result) { setOutcome(result); onScored(); }
        }}
      >
        <div className="grid grid--two">
          <Field label={locale === 'ar' ? 'أشهر التشغيل' : 'Months trading'} htmlFor="months">
            <input id="months" type="number" min={0} dir="ltr" value={inputs.monthsTrading}
                   onChange={(e) => setInputs((i) => ({ ...i, monthsTrading: Number(e.target.value) }))} />
          </Field>
          <Field label={locale === 'ar' ? 'استقرار الإيرادات (نقطة أساس)' : 'Revenue stability (bps)'} htmlFor="stability">
            <input id="stability" type="number" min={0} max={10_000} dir="ltr" value={inputs.revenueStabilityBps}
                   onChange={(e) => setInputs((i) => ({ ...i, revenueStabilityBps: Number(e.target.value) }))} />
          </Field>
          <Field label={locale === 'ar' ? 'مساهمة المالك (نقطة أساس)' : 'Owner contribution (bps)'} htmlFor="contribution-bps">
            <input id="contribution-bps" type="number" min={0} max={10_000} dir="ltr" value={inputs.ownerContributionBps}
                   onChange={(e) => setInputs((i) => ({ ...i, ownerContributionBps: Number(e.target.value) }))} />
          </Field>
          <Field label={locale === 'ar' ? 'جودة البيانات' : 'Data quality'} htmlFor="quality">
            <select id="quality" value={inputs.dataQuality}
                    onChange={(e) => setInputs((i) => ({ ...i, dataQuality: e.target.value }))}>
              <option value="bank_api">bank_api</option><option value="pos_api">pos_api</option>
              <option value="statement_upload">statement_upload</option><option value="none">none</option>
            </select>
          </Field>
          <Field label={locale === 'ar' ? 'تحديد استخدام الأموال' : 'Use of funds'} htmlFor="specificity">
            <select id="specificity" value={inputs.useOfFundsSpecificity}
                    onChange={(e) => setInputs((i) => ({ ...i, useOfFundsSpecificity: e.target.value }))}>
              <option value="itemised_quotes">itemised_quotes</option>
              <option value="partial">partial</option><option value="narrative">narrative</option>
            </select>
          </Field>
          <Field label={locale === 'ar' ? 'مخاطر القطاع' : 'Sector risk'} htmlFor="sector-risk">
            <select id="sector-risk" value={inputs.sectorRisk}
                    onChange={(e) => setInputs((i) => ({ ...i, sectorRisk: e.target.value }))}>
              <option value="low">low</option><option value="medium">medium</option><option value="high">high</option>
            </select>
          </Field>
          <Field label={locale === 'ar' ? 'عمق الإدارة' : 'Management depth'} htmlFor="management">
            <select id="management" value={inputs.managementDepth}
                    onChange={(e) => setInputs((i) => ({ ...i, managementDepth: e.target.value }))}>
              <option value="team">team</option><option value="owner_plus">owner_plus</option>
              <option value="owner_only">owner_only</option>
            </select>
          </Field>
          <Field label={locale === 'ar' ? 'الرفع المالي (نقطة أساس)' : 'Existing leverage (bps)'} htmlFor="leverage">
            <input id="leverage" type="number" min={0} max={10_000} dir="ltr" value={inputs.existingLeverageBps}
                   onChange={(e) => setInputs((i) => ({ ...i, existingLeverageBps: Number(e.target.value) }))} />
          </Field>
          <Field label={locale === 'ar' ? 'تركز الموردين (نقطة أساس)' : 'Supplier concentration (bps)'} htmlFor="concentration">
            <input id="concentration" type="number" min={0} max={10_000} dir="ltr" value={inputs.supplierConcentrationBps}
                   onChange={(e) => setInputs((i) => ({ ...i, supplierConcentrationBps: Number(e.target.value) }))} />
          </Field>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={inputs.licensesComplete}
                 onChange={(e) => setInputs((i) => ({ ...i, licensesComplete: e.target.checked }))} />
          <span>{locale === 'ar' ? 'التراخيص مكتملة وسارية' : 'Licences complete and valid'}</span>
        </label>

        <ErrorNotice error={score.error} />

        {outcome ? (
          <div className="stack-sm">
            <div className="row">
              <Badge tone={outcome.grade === 'A' || outcome.grade === 'B' ? 'positive' : outcome.grade === 'C' ? 'warning' : 'danger'}>
                {outcome.score} · {outcome.grade}
              </Badge>
              <span className="small muted">{outcome.version}</span>
            </div>
            {outcome.flags.length ? (
              <div className="notice notice--risk small">
                <strong>{locale === 'ar' ? 'تنبيهات السياسة' : 'Policy flags'}</strong>
                <ul style={{ margin: '.3rem 0 0', paddingInlineStart: '1.1rem' }}>
                  {outcome.flags.map((flag: string) => <li key={flag}>{flag}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>{locale === 'ar' ? 'العامل' : 'Factor'}</th><th>{locale === 'ar' ? 'الوزن' : 'Weight'}</th>
                      <th>{locale === 'ar' ? 'الدرجة' : 'Raw'}</th><th>{locale === 'ar' ? 'الموزون' : 'Weighted'}</th></tr>
                </thead>
                <tbody>
                  {outcome.breakdown.map((factor: any) => (
                    <tr key={factor.code}>
                      <td>{factor.labelAr}</td>
                      <td className="num">{factor.weight}</td>
                      <td className="num">{factor.raw}</td>
                      <td className="num">{factor.weighted.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {canAct ? (
          <button type="submit" className="btn btn--primary" disabled={score.pending}>
            {locale === 'ar' ? 'احتساب الدرجة' : 'Compute score'}
          </button>
        ) : null}
      </form>
    </Card>
  );
}
