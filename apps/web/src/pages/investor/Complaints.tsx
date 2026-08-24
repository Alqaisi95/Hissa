/** FR-605 / FR-610 — complaints with a reference and SLA, plus PDPL data requests. */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { Card, Empty, ErrorNotice, Field, Loading, StatusBadge } from '../../components/ui.tsx';

export function Complaints() {
  const { t, locale, formatDate } = useI18n();
  const categories = useQuery<any>('/cases/complaints/categories');
  const mine = useQuery<any>('/cases/complaints/mine');

  const [form, setForm] = useState({ category: 'investment_process', subject: '', body: '' });
  const [created, setCreated] = useState<any>(null);
  const submit = useMutation(() => api.post('/cases/complaints', form));
  const dsar = useMutation((payload: { requestType: string; details: string }) => api.post('/cases/dsar', payload));

  return (
    <div className="stack">
      <h1>{t('complaintsTitle')}</h1>

      <Card title={t('newComplaint')}>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await submit.run();
            if (result) {
              setCreated(result);
              setForm({ category: 'investment_process', subject: '', body: '' });
              mine.reload();
            }
          }}
        >
          <Field label={t('complaintCategory')} htmlFor="category">
            <select id="category" value={form.category}
                    onChange={(event) => setForm((f) => ({ ...f, category: event.target.value }))}>
              {(categories.data?.categories ?? []).map((category: any) => (
                <option key={category.code} value={category.code}>{category.labelAr}</option>
              ))}
            </select>
          </Field>
          <Field label={t('complaintSubject')} htmlFor="subject">
            <input id="subject" type="text" required minLength={5} maxLength={200} value={form.subject}
                   onChange={(event) => setForm((f) => ({ ...f, subject: event.target.value }))} />
          </Field>
          <Field label={t('complaintBody')} htmlFor="body"
                 hint={locale === 'ar' ? '20 حرفًا على الأقل' : 'At least 20 characters'}>
            <textarea id="body" required minLength={20} maxLength={5000} value={form.body}
                      onChange={(event) => setForm((f) => ({ ...f, body: event.target.value }))} />
          </Field>

          <ErrorNotice error={submit.error} />
          {created ? (
            <div className="notice notice--success">
              {locale === 'ar' ? 'رقم الشكوى' : 'Complaint reference'}: <strong className="mono">{created.reference}</strong> ·{' '}
              {t('slaDue')}: {formatDate(created.slaDueAt, true)}
            </div>
          ) : null}

          <button type="submit" className="btn btn--primary" disabled={submit.pending}>{t('submit')}</button>
        </form>
      </Card>

      <Card title={t('complaintsTitle')}>
        {mine.loading ? <Loading /> : (mine.data?.items ?? []).length === 0 ? <Empty /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>{t('reference')}</th><th>{t('complaintSubject')}</th>
                  <th>{t('status')}</th><th>{t('slaDue')}</th><th>{t('date')}</th>
                </tr>
              </thead>
              <tbody>
                {mine.data.items.map((item: any) => (
                  <tr key={item.id}>
                    <td className="mono small">{item.reference}</td>
                    <td>{item.subject}</td>
                    <td><StatusBadge status={item.status} /></td>
                    <td>{formatDate(item.sla_due_at)}</td>
                    <td>{formatDate(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={locale === 'ar' ? 'طلبات البيانات الشخصية' : 'Personal data requests'}>
        <p className="small muted">
          {locale === 'ar'
            ? 'يمكنك طلب الوصول إلى بياناتك أو تصحيحها أو حذفها ضمن ما تسمح به الالتزامات القانونية وفترات الاحتفاظ المعتمدة.'
            : 'You may request access to, correction of, or deletion of your data within legal obligations and approved retention periods.'}
        </p>
        <div className="row">
          {(['access', 'correction', 'deletion', 'objection'] as const).map((type) => (
            <button
              key={type} type="button" className="btn btn--sm" disabled={dsar.pending}
              onClick={() => void dsar.run({ requestType: type, details: `Request of type ${type} submitted from the account page.` })}
            >
              {locale === 'ar'
                ? { access: 'وصول', correction: 'تصحيح', deletion: 'حذف', objection: 'اعتراض' }[type]
                : type}
            </button>
          ))}
          <a href="/api/cases/dsar/export" className="btn btn--sm" target="_blank" rel="noreferrer">
            {locale === 'ar' ? 'تنزيل نسخة من بياناتي' : 'Download my data'}
          </a>
        </div>
        <ErrorNotice error={dsar.error} />
      </Card>
    </div>
  );
}
