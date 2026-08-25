/** FR-608 / FR-609 — notification templates with preview and approval, and the incident banner. */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Badge, Card, Empty, ErrorNotice, Field, Loading, StatusBadge } from '../../components/ui.tsx';

export function AdminContent() {
  const { locale } = useI18n();
  return (
    <div className="stack">
      <Templates />
      <BannerPanel />
      <JobRuns />
    </div>
  );
}

function Templates() {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const templates = useQuery<any>('/admin/templates');
  const [preview, setPreview] = useState<{ code: string; ar: any; en: any } | null>(null);

  const approve = useMutation((code: string) => api.post(`/admin/templates/${code}/approve`));
  const runPreview = useMutation((code: string) => api.post(`/admin/templates/${code}/preview`, {
    variables: { code: '123456', minutes: 10, reference: 'ORD-2026-0001', poolTitle: 'فرصة تجريبية',
                 amount: '500', period: '2026-Q1', message: '…', version: 2, closesAt: '2026-12-31',
                 allocated: '450', refund: '50', slaDueAt: '2026-01-01', resolution: '…', dueAt: '2026-01-01', title: '…' },
  }));

  return (
    <Card title={locale === 'ar' ? 'قوالب الإشعارات' : 'Notification templates'}>
      <p className="small muted">
        {locale === 'ar'
          ? 'لا يُرسل قالب غير معتمد. المعاينة تعرض النص بلغتيه قبل الاعتماد.'
          : 'An unapproved template is never dispatched. Preview shows both languages before approval.'}
      </p>
      <ErrorNotice error={approve.error ?? runPreview.error} />

      {templates.loading ? <Loading rows={4} /> : (templates.data?.items ?? []).length === 0 ? <Empty /> : (
        <div className="table-wrap" style={{ marginBlockStart: '.8rem' }}>
          <table className="data">
            <thead>
              <tr><th>{locale === 'ar' ? 'الرمز' : 'Code'}</th><th>{locale === 'ar' ? 'القناة' : 'Channel'}</th>
                  <th>{t('status')}</th><th>{t('date')}</th><th /></tr>
            </thead>
            <tbody>
              {templates.data.items.map((tpl: any) => (
                <tr key={tpl.code}>
                  <td className="mono small">{tpl.code}</td>
                  <td><Badge>{tpl.channel}</Badge></td>
                  <td><StatusBadge status={tpl.status === 'approved' ? 'approved' : 'draft'} /></td>
                  <td className="small">{formatDate(tpl.updated_at)}</td>
                  <td>
                    <div className="row" style={{ gap: '.3rem' }}>
                      <button type="button" className="btn btn--sm"
                              onClick={async () => {
                                const r = await runPreview.run(tpl.code);
                                if (r) setPreview({ code: tpl.code, ar: r.ar, en: r.en });
                              }}>
                        {locale === 'ar' ? 'معاينة' : 'Preview'}
                      </button>
                      {tpl.status !== 'approved' && auth.has('compliance') ? (
                        <button type="button" className="btn btn--sm btn--primary"
                                onClick={async () => { if (await approve.run(tpl.code)) templates.reload(); }}>
                          {t('approve')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview ? (
        <div className="panel stack-sm" style={{ marginBlockStart: '1rem' }}>
          <div className="row row--between">
            <strong className="mono small">{preview.code}</strong>
            <button type="button" className="btn btn--sm" onClick={() => setPreview(null)}>{t('close')}</button>
          </div>
          <div className="grid grid--two">
            <div dir="rtl">
              <strong className="small">{preview.ar.subject}</strong>
              <p className="small" style={{ margin: '.2rem 0 0' }}>{preview.ar.body}</p>
            </div>
            <div dir="ltr">
              <strong className="small">{preview.en.subject}</strong>
              <p className="small" style={{ margin: '.2rem 0 0' }}>{preview.en.body}</p>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function BannerPanel() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const current = useQuery<any>('/public/banner');
  const [form, setForm] = useState({
    messageAr: '', messageEn: '', severity: 'info', audience: 'all', hours: '24',
  });

  const publish = useMutation(() => {
    const now = new Date();
    return api.post('/admin/banners', {
      messageAr: form.messageAr, messageEn: form.messageEn,
      severity: form.severity, audience: form.audience,
      startsAt: now.toISOString(),
      endsAt: new Date(now.getTime() + Number(form.hours) * 3_600_000).toISOString(),
    });
  });
  const retract = useMutation((id: string) => api.del(`/admin/banners/${id}`));

  if (!auth.has('system_admin')) return null;

  return (
    <Card title={locale === 'ar' ? 'شريط الحوادث' : 'Incident banner'}>
      <p className="small muted">
        {locale === 'ar'
          ? 'رسالة مقيدة بزمن وجمهور، تظهر أعلى كل صفحة. استخدمها للأعطال والصيانة المعلنة.'
          : 'A time-boxed, audience-scoped message shown above every page. Use it for incidents and announced maintenance.'}
      </p>

      {current.data?.banner ? (
        <div className="notice notice--info" style={{ marginBlock: '.8rem' }}>
          <div className="row row--between">
            <span>{locale === 'ar' ? current.data.banner.message_ar : current.data.banner.message_en}</span>
            <button type="button" className="btn btn--sm" disabled={retract.pending}
                    onClick={async () => { if (await retract.run(current.data.banner.id)) current.reload(); }}>
              {locale === 'ar' ? 'سحب' : 'Retract'}
            </button>
          </div>
        </div>
      ) : null}

      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        if (await publish.run()) { setForm((f) => ({ ...f, messageAr: '', messageEn: '' })); current.reload(); }
      }}>
        <Field label={locale === 'ar' ? 'الرسالة (عربي)' : 'Message (Arabic)'} htmlFor="b-ar">
          <textarea id="b-ar" rows={2} required minLength={10} value={form.messageAr}
                    onChange={(e) => setForm((f) => ({ ...f, messageAr: e.target.value }))} />
        </Field>
        <Field label={locale === 'ar' ? 'الرسالة (إنجليزي)' : 'Message (English)'} htmlFor="b-en">
          <textarea id="b-en" rows={2} dir="ltr" required minLength={10} value={form.messageEn}
                    onChange={(e) => setForm((f) => ({ ...f, messageEn: e.target.value }))} />
        </Field>
        <div className="filters">
          <Field label={locale === 'ar' ? 'الأهمية' : 'Severity'} htmlFor="b-sev">
            <select id="b-sev" value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
              <option value="info">{locale === 'ar' ? 'معلومة' : 'Info'}</option>
              <option value="warning">{locale === 'ar' ? 'تنبيه' : 'Warning'}</option>
              <option value="critical">{locale === 'ar' ? 'حرج' : 'Critical'}</option>
            </select>
          </Field>
          <Field label={locale === 'ar' ? 'الجمهور' : 'Audience'} htmlFor="b-aud">
            <select id="b-aud" value={form.audience} onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value }))}>
              <option value="all">{locale === 'ar' ? 'الجميع' : 'Everyone'}</option>
              <option value="investors">{locale === 'ar' ? 'المستثمرون' : 'Investors'}</option>
              <option value="owners">{locale === 'ar' ? 'أصحاب المشاريع' : 'Project owners'}</option>
              <option value="staff">{locale === 'ar' ? 'الفريق' : 'Staff'}</option>
            </select>
          </Field>
          <Field label={locale === 'ar' ? 'المدة (ساعة)' : 'Duration (hours)'} htmlFor="b-hrs">
            <input id="b-hrs" type="number" min={1} max={720} dir="ltr" value={form.hours}
                   onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))} />
          </Field>
        </div>
        <ErrorNotice error={publish.error ?? retract.error} />
        <button type="submit" className="btn btn--primary" disabled={publish.pending}>
          {locale === 'ar' ? 'نشر الشريط' : 'Publish banner'}
        </button>
      </form>
    </Card>
  );
}

/** NFR-012 — proof the scheduled jobs actually ran. */
function JobRuns() {
  const { t, locale, formatDate } = useI18n();
  const jobs = useQuery<any>('/admin/jobs');

  return (
    <Card title={locale === 'ar' ? 'المهام المجدولة' : 'Scheduled jobs'}>
      <p className="small muted">
        {locale === 'ar'
          ? 'ساعات SLA وتذكيرات التقارير وكنس الإغلاق والمطابقة — كل تشغيل مسجل بنتيجته.'
          : 'SLA clocks, report reminders, closing sweeps and reconciliation — every run is recorded with its outcome.'}
      </p>
      {jobs.loading ? <Loading rows={3} /> : (jobs.data?.items ?? []).length === 0 ? <Empty /> : (
        <div className="table-wrap" style={{ marginBlockStart: '.8rem' }}>
          <table className="data">
            <thead>
              <tr><th>{locale === 'ar' ? 'المهمة' : 'Job'}</th><th>{t('status')}</th>
                  <th>{locale === 'ar' ? 'النتيجة' : 'Summary'}</th><th>{t('date')}</th></tr>
            </thead>
            <tbody>
              {jobs.data.items.slice(0, 25).map((j: any) => (
                <tr key={j.id}>
                  <td className="mono small">{j.job_name}</td>
                  <td>
                    <Badge tone={j.status === 'ok' ? 'positive' : j.status === 'failed' ? 'danger' : 'warning'}>
                      {j.status}
                    </Badge>
                  </td>
                  <td className="small mono">{j.summary ?? '—'}</td>
                  <td className="small">{formatDate(j.started_at, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
