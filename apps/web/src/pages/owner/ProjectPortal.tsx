/**
 * FR-101 … FR-104 — the project owner's workspace: entity registration, a
 * draft-capable application, documents, financial history, the completeness
 * gate, and the two-way information requests that due diligence raises.
 */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import {
  Badge, Card, Empty, ErrorNotice, Field, Loading, Money, StatusBadge,
} from '../../components/ui.tsx';
import { OwnerReports } from './Reports.tsx';

export function ProjectPortal() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const applications = useQuery<any>('/origination/applications/mine');
  const [selected, setSelected] = useState<string | null>(null);

  if (auth.loading) return <Loading rows={6} />;

  return (
    <div className="stack">
      <h1>{t('ownerPortalTitle')}</h1>

      {auth.entities.length === 0 ? <RegisterEntity onDone={() => void auth.refresh()} /> : (
        <Card title={locale === 'ar' ? 'الشركة' : 'Company'}>
          {auth.entities.map((entity: any) => (
            <div key={entity.id} className="row row--between" style={{ paddingBlock: '.3rem' }}>
              <div>
                <strong>{entity.legal_name}</strong>
                <span className="small muted"> · {locale === 'ar' ? 'س.ت' : 'CR'} {entity.cr_number}</span>
              </div>
              <StatusBadge status={entity.kyb_status} />
            </div>
          ))}
        </Card>
      )}

      {auth.entities.length > 0 ? (
        <NewApplication entities={auth.entities} onCreated={() => applications.reload()} />
      ) : null}

      {applications.loading ? <Loading /> : (applications.data?.items ?? []).length === 0 ? (
        <Card><Empty>{locale === 'ar' ? 'لا توجد طلبات بعد.' : 'No applications yet.'}</Empty></Card>
      ) : (
        <div className="stack">
          {applications.data.items.map((application: any) => (
            <Card
              key={application.id}
              title={application.title_ar}
              actions={
                <div className="row" style={{ gap: '.4rem' }}>
                  <Badge>{application.reference}</Badge>
                  <StatusBadge status={application.status} />
                  <button type="button" className="btn btn--sm"
                          onClick={() => setSelected(selected === application.id ? null : application.id)}>
                    {selected === application.id ? t('close') : t('viewDetails')}
                  </button>
                </div>
              }
            >
              <dl className="kv" style={{ marginBlockEnd: 0 }}>
                <dt>{locale === 'ar' ? 'المبلغ المطلوب' : 'Requested'}</dt>
                <dd><Money baisa={application.requested_amount} decimals={0} /></dd>
                <dt>{locale === 'ar' ? 'مساهمة صاحب المشروع' : 'Owner contribution'}</dt>
                <dd><Money baisa={application.owner_contribution} decimals={0} /></dd>
                <dt>{t('filterSector')}</dt><dd>{application.sector}</dd>
              </dl>

              {application.pool_id ? (
                <div className="row" style={{ marginBlockStart: '.75rem' }}>
                  <Badge tone="brand">{application.pool_reference}</Badge>
                  <StatusBadge status={application.pool_status} />
                </div>
              ) : null}

              {selected === application.id ? (
                <div className="stack" style={{ marginBlockStart: '1rem' }}>
                  {/* FR-501 — once the application is a funded pool, reporting is the owner's duty. */}
                  {application.pool_id ? (
                    <OwnerReports poolId={application.pool_id} poolTitle={application.pool_title ?? application.title_ar} />
                  ) : null}
                  <ApplicationDetail applicationId={application.id} onChanged={() => applications.reload()} />
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RegisterEntity({ onDone }: { onDone: () => void }) {
  const { t, locale } = useI18n();
  const [form, setForm] = useState({
    legalName: '', crNumber: '', activity: '', incorporatedOn: '', governorate: '',
    uboName: '', uboId: '',
  });
  const create = useMutation(() => api.post('/identity/entities', {
    legalName: form.legalName, crNumber: form.crNumber, activity: form.activity,
    incorporatedOn: form.incorporatedOn, governorate: form.governorate || undefined,
    people: [{ fullName: form.uboName, role: 'ubo', ownershipBp: 10_000, idReference: form.uboId || undefined }],
  }));

  return (
    <Card title={locale === 'ar' ? 'تسجيل الشركة' : 'Register your company'}>
      <form
        className="stack"
        onSubmit={async (event) => { event.preventDefault(); if (await create.run()) onDone(); }}
      >
        <p className="small muted" style={{ margin: 0 }}>
          {locale === 'ar'
            ? 'يلزم تسجيل المالك المستفيد النهائي ليخضع لفحص العقوبات والأشخاص المعرضين سياسيًا.'
            : 'The ultimate beneficial owner must be registered so they can be screened for sanctions and PEP exposure.'}
        </p>
        <div className="grid grid--two">
          <Field label={locale === 'ar' ? 'الاسم القانوني' : 'Legal name'} htmlFor="legal-name">
            <input id="legal-name" type="text" required minLength={3} value={form.legalName}
                   onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'رقم السجل التجاري' : 'CR number'} htmlFor="cr">
            <input id="cr" type="text" dir="ltr" required minLength={4} value={form.crNumber}
                   onChange={(e) => setForm((f) => ({ ...f, crNumber: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'النشاط' : 'Activity'} htmlFor="activity">
            <input id="activity" type="text" required value={form.activity}
                   onChange={(e) => setForm((f) => ({ ...f, activity: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'تاريخ التأسيس' : 'Incorporated on'} htmlFor="incorporated">
            <input id="incorporated" type="date" required value={form.incorporatedOn}
                   onChange={(e) => setForm((f) => ({ ...f, incorporatedOn: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'المحافظة' : 'Governorate'} htmlFor="governorate">
            <input id="governorate" type="text" value={form.governorate}
                   onChange={(e) => setForm((f) => ({ ...f, governorate: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'اسم المالك المستفيد' : 'UBO full name'} htmlFor="ubo">
            <input id="ubo" type="text" required minLength={3} value={form.uboName}
                   onChange={(e) => setForm((f) => ({ ...f, uboName: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'رقم هوية المالك المستفيد' : 'UBO ID number'} htmlFor="ubo-id">
            <input id="ubo-id" type="text" dir="ltr" value={form.uboId}
                   onChange={(e) => setForm((f) => ({ ...f, uboId: e.target.value }))} />
          </Field>
        </div>
        <ErrorNotice error={create.error} />
        <button type="submit" className="btn btn--primary" disabled={create.pending}>{t('submit')}</button>
      </form>
    </Card>
  );
}

function NewApplication({ entities, onCreated }: { entities: any[]; onCreated: () => void }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    entityId: entities[0]?.id ?? '', titleAr: '', sector: '', governorate: '', summaryAr: '',
    requestedAmount: '', ownerContribution: '', tenorMonths: '36',
  });
  const create = useMutation(() => api.post('/origination/applications', {
    entityId: form.entityId, titleAr: form.titleAr, sector: form.sector,
    governorate: form.governorate || undefined, summaryAr: form.summaryAr || undefined,
    requestedAmount: Math.round(Number(form.requestedAmount) * 1000),
    ownerContribution: Math.round(Number(form.ownerContribution || 0) * 1000),
    tenorMonths: Number(form.tenorMonths), useOfFunds: [],
  }));

  if (!open) {
    return (
      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>{t('newApplication')}</button>
      </div>
    );
  }

  return (
    <Card title={t('newApplication')} actions={
      <button type="button" className="btn btn--sm" onClick={() => setOpen(false)}>{t('cancel')}</button>
    }>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (await create.run()) { setOpen(false); onCreated(); }
        }}
      >
        <Field label={locale === 'ar' ? 'الشركة' : 'Company'} htmlFor="entity">
          <select id="entity" value={form.entityId}
                  onChange={(e) => setForm((f) => ({ ...f, entityId: e.target.value }))}>
            {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.legal_name}</option>)}
          </select>
        </Field>
        <Field label={locale === 'ar' ? 'عنوان المشروع' : 'Project title'} htmlFor="title">
          <input id="title" type="text" required minLength={5} value={form.titleAr}
                 onChange={(e) => setForm((f) => ({ ...f, titleAr: e.target.value }))} />
        </Field>
        <div className="grid grid--two">
          <Field label={t('filterSector')} htmlFor="sector-input">
            <input id="sector-input" type="text" required value={form.sector}
                   onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))} />
          </Field>
          <Field label={t('filterGovernorate')} htmlFor="gov-input">
            <input id="gov-input" type="text" value={form.governorate}
                   onChange={(e) => setForm((f) => ({ ...f, governorate: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'المبلغ المطلوب (ر.ع)' : 'Requested amount (OMR)'} htmlFor="requested">
            <input id="requested" type="number" min={1} step="0.001" dir="ltr" required value={form.requestedAmount}
                   onChange={(e) => setForm((f) => ({ ...f, requestedAmount: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'مساهمتك (ر.ع)' : 'Your contribution (OMR)'} htmlFor="contribution"
                 hint={locale === 'ar' ? 'القاعدة الداخلية 20–30% من إجمالي المشروع' : 'Internal policy: 20–30% of the total project'}>
            <input id="contribution" type="number" min={0} step="0.001" dir="ltr" value={form.ownerContribution}
                   onChange={(e) => setForm((f) => ({ ...f, ownerContribution: e.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'المدة (شهر)' : 'Term (months)'} htmlFor="tenor">
            <input id="tenor" type="number" min={1} max={120} dir="ltr" value={form.tenorMonths}
                   onChange={(e) => setForm((f) => ({ ...f, tenorMonths: e.target.value }))} />
          </Field>
        </div>
        <Field label={locale === 'ar' ? 'ملخص المشروع' : 'Project summary'} htmlFor="summary"
               hint={locale === 'ar' ? '40 حرفًا على الأقل قبل الإرسال' : 'At least 40 characters before submission'}>
          <textarea id="summary" value={form.summaryAr}
                    onChange={(e) => setForm((f) => ({ ...f, summaryAr: e.target.value }))} />
        </Field>
        <ErrorNotice error={create.error} />
        <button type="submit" className="btn btn--primary" disabled={create.pending}>{t('save')}</button>
      </form>
    </Card>
  );
}

function ApplicationDetail({ applicationId, onChanged }: { applicationId: string; onChanged: () => void }) {
  const { t, locale, formatDate } = useI18n();
  const detail = useQuery<any>(`/origination/applications/${applicationId}`, [applicationId]);
  const completeness = useQuery<any>(`/origination/applications/${applicationId}/completeness`, [applicationId]);

  const submit = useMutation(() => api.post(`/origination/applications/${applicationId}/submit`));
  const upload = useMutation((payload: { category: string; file: File }) => uploadDocument(applicationId, payload));
  const addFeed = useMutation((payload: any) => api.post(`/origination/applications/${applicationId}/feeds`, payload));
  const answer = useMutation((payload: { id: string; answer: string }) =>
    api.post(`/origination/requests/${payload.id}/answer`, { answer: payload.answer }));

  const [feed, setFeed] = useState({ periodStart: '', periodEnd: '', grossRevenue: '' });
  const [answers, setAnswers] = useState<Record<string, string>>({});

  if (detail.loading) return <Loading />;
  if (!detail.data) return null;

  const reload = () => { detail.reload(); completeness.reload(); onChanged(); };
  const editable = ['draft', 'returned'].includes(detail.data.application.status);

  return (
    <div className="stack" style={{ marginBlockStart: '1rem' }}>
      {/* FR-101 — the gate is visible before submission, not a surprise at the end. */}
      <Card title={t('completeness')}>
        {completeness.loading ? <Loading rows={2} /> : completeness.data?.complete ? (
          <div className="notice notice--success">
            {locale === 'ar' ? 'الطلب مكتمل وجاهز للإرسال.' : 'The application is complete and ready to submit.'}
          </div>
        ) : (
          <div className="stack-sm">
            <strong className="small">{t('missingItems')}</strong>
            <ul className="small" style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
              {(completeness.data?.missing ?? []).map((item: string) => <li key={item}>{item}</li>)}
            </ul>
            <span className="small muted">
              {locale === 'ar' ? 'أشهر البيانات المالية' : 'Financial history'}: {completeness.data?.monthsCovered ?? 0}/12
            </span>
          </div>
        )}
      </Card>

      {editable ? (
        <>
          <Card title={t('documents')}>
            <div className="stack-sm">
              {['cr_certificate', 'bank_statement', 'quotes', 'licences', 'lease'].map((category) => (
                <div key={category} className="row row--between">
                  <span className="small">{category}</span>
                  <input
                    type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file && await upload.run({ category, file })) reload();
                    }}
                  />
                </div>
              ))}
              <ErrorNotice error={upload.error} />
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>{locale === 'ar' ? 'الملف' : 'File'}</th><th>{locale === 'ar' ? 'التصنيف' : 'Category'}</th>
                        <th>{locale === 'ar' ? 'النسخة' : 'Version'}</th><th>{t('date')}</th></tr>
                  </thead>
                  <tbody>
                    {(detail.data.documents ?? []).map((document: any) => (
                      <tr key={document.id}>
                        <td>{document.file_name}</td>
                        <td>{document.category}</td>
                        <td className="num">v{document.version}</td>
                        <td>{formatDate(document.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          <Card title={locale === 'ar' ? 'البيانات المالية التاريخية' : 'Financial history'}>
            <form
              className="stack-sm"
              onSubmit={async (event) => {
                event.preventDefault();
                const created = await addFeed.run({
                  source: 'statement_upload', periodStart: `${feed.periodStart}T00:00:00.000Z`,
                  periodEnd: `${feed.periodEnd}T00:00:00.000Z`,
                  grossRevenue: Math.round(Number(feed.grossRevenue) * 1000),
                  documentId: detail.data.documents.find((d: any) => d.category === 'bank_statement')?.id,
                });
                if (created) { setFeed({ periodStart: '', periodEnd: '', grossRevenue: '' }); reload(); }
              }}
            >
              <div className="filters">
                <Field label={locale === 'ar' ? 'من' : 'From'} htmlFor="feed-from">
                  <input id="feed-from" type="date" required value={feed.periodStart}
                         onChange={(e) => setFeed((f) => ({ ...f, periodStart: e.target.value }))} />
                </Field>
                <Field label={locale === 'ar' ? 'إلى' : 'To'} htmlFor="feed-to">
                  <input id="feed-to" type="date" required value={feed.periodEnd}
                         onChange={(e) => setFeed((f) => ({ ...f, periodEnd: e.target.value }))} />
                </Field>
                <Field label={locale === 'ar' ? 'الإيراد (ر.ع)' : 'Revenue (OMR)'} htmlFor="feed-revenue">
                  <input id="feed-revenue" type="number" min={0} step="0.001" dir="ltr" required value={feed.grossRevenue}
                         onChange={(e) => setFeed((f) => ({ ...f, grossRevenue: e.target.value }))} />
                </Field>
                <button type="submit" className="btn btn--sm" disabled={addFeed.pending}>{t('save')}</button>
              </div>
              <ErrorNotice error={addFeed.error} />
            </form>

            {(detail.data.feeds ?? []).length > 0 ? (
              <div className="table-wrap" style={{ marginBlockStart: '.75rem' }}>
                <table className="data">
                  <thead>
                    <tr><th>{locale === 'ar' ? 'الفترة' : 'Period'}</th><th>{locale === 'ar' ? 'المصدر' : 'Source'}</th>
                        <th>{locale === 'ar' ? 'الإيراد' : 'Revenue'}</th><th>{locale === 'ar' ? 'الجودة' : 'Quality'}</th></tr>
                  </thead>
                  <tbody>
                    {detail.data.feeds.map((row: any) => (
                      <tr key={row.id}>
                        <td className="small">{formatDate(row.period_start)} – {formatDate(row.period_end)}</td>
                        <td>{row.source}</td>
                        <td className="num"><Money baisa={row.gross_revenue} decimals={0} /></td>
                        <td><Badge tone={row.quality === 'verified' ? 'positive' : 'warning'}>{row.quality}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

          <div className="stack-sm">
            <ErrorNotice error={submit.error} />
            <button
              type="button" className="btn btn--primary"
              disabled={submit.pending || !completeness.data?.complete}
              onClick={async () => { if (await submit.run()) reload(); }}
            >
              {t('submitApplication')}
            </button>
          </div>
        </>
      ) : null}

      {/* FR-104 — the applicant answers requests here, with the SLA in view. */}
      {(detail.data.infoRequests ?? []).length > 0 ? (
        <Card title={t('infoRequests')}>
          <div className="stack">
            {detail.data.infoRequests.map((request: any) => (
              <div key={request.id} className="panel stack-sm">
                <div className="row row--between">
                  <strong className="small">{request.body_ar}</strong>
                  <StatusBadge status={request.status} />
                </div>
                <span className="small muted">{t('slaDue')}: {formatDate(request.due_at, true)}</span>

                {request.answer_body ? (
                  <p className="small" style={{ margin: 0 }}>{request.answer_body}</p>
                ) : (
                  <div className="stack-sm">
                    <textarea
                      value={answers[request.id] ?? ''} rows={3}
                      onChange={(event) => setAnswers((previous) => ({ ...previous, [request.id]: event.target.value }))}
                    />
                    <div className="row row--end">
                      <button
                        type="button" className="btn btn--sm" disabled={answer.pending}
                        onClick={async () => {
                          if (await answer.run({ id: request.id, answer: answers[request.id] ?? '' })) reload();
                        }}
                      >
                        {t('submit')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <ErrorNotice error={answer.error} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Reads a file into base64 — the API stores it with a checksum and malware scan. */
async function uploadDocument(applicationId: string, payload: { category: string; file: File }) {
  const buffer = await payload.file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);

  return api.post(`/origination/applications/${applicationId}/documents`, {
    category: payload.category,
    fileName: payload.file.name,
    mimeType: payload.file.type || 'application/pdf',
    contentBase64: btoa(binary),
  });
}
