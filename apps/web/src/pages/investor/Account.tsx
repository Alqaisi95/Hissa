/** FR-002 … FR-006 — onboarding completion: consents, suitability, KYC, classification. */
import { useState } from 'react';
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery, useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import {
  Badge, Card, ErrorNotice, Field, Loading, StatusBadge, useStatusLabel,
} from '../../components/ui.tsx';

export function Account() {
  const { t, locale, formatDate } = useI18n();
  const auth = useAuth();
  const statusLabel = useStatusLabel();

  if (auth.loading) return <Loading rows={6} />;
  if (!auth.user) return null;

  return (
    <div className="stack">
      <h1>{t('navProfile')}</h1>

      <Card title={t('navProfile')}>
        <dl className="kv" style={{ marginBlockEnd: 0 }}>
          <dt>{t('fullName')}</dt><dd>{auth.user.full_name}</dd>
          <dt>{t('email')}</dt><dd dir="ltr">{auth.user.email ?? '—'}</dd>
          <dt>{t('phone')}</dt><dd dir="ltr">{auth.user.phone ?? '—'}</dd>
          <dt>{t('status')}</dt><dd><StatusBadge status={auth.user.status} /></dd>
          <dt>{locale === 'ar' ? 'الأدوار' : 'Roles'}</dt>
          <dd className="row" style={{ gap: '.3rem' }}>
            {auth.roles.map((role) => <Badge key={role}>{role}</Badge>)}
          </dd>
          {auth.investorProfile ? (
            <>
              <dt>{t('classification')}</dt>
              <dd><Badge tone="brand">{statusLabel(auth.investorProfile.classification)}</Badge></dd>
              <dt>{t('kycStatus')}</dt>
              <dd>
                <StatusBadge status={auth.investorProfile.kycStatus} />
                {auth.investorProfile.kycExpiresAt ? (
                  <span className="small muted"> · {formatDate(auth.investorProfile.kycExpiresAt)}</span>
                ) : null}
              </dd>
            </>
          ) : null}
        </dl>
      </Card>

      {auth.outstanding.length > 0 ? (
        <div className="notice notice--info">
          <strong>{t('eligibilityTitle')}</strong>
          <ul style={{ margin: '.4rem 0 0', paddingInlineStart: '1.1rem' }}>
            {auth.outstanding.map((item) => (
              <li key={item}>
                {item === 'kyc' ? t('completeKyc')
                  : item === 'suitability' ? t('completeSuitability')
                  : item === 'consents' ? t('completeConsents')
                  : item === 'kyc_refresh' ? (locale === 'ar' ? 'إعادة التحقق من الهوية' : 'Refresh identity verification')
                  : item}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="notice notice--success">
          {locale === 'ar' ? 'حسابك مكتمل ويمكنك الاستثمار ضمن حدودك.' : 'Your account is complete. You can invest within your limits.'}
        </div>
      )}

      {auth.investorProfile ? (
        <>
          <Consents />
          <Suitability />
          <Kyc />
          <Classification />
        </>
      ) : null}
    </div>
  );
}

function Consents() {
  const { t, pick, locale } = useI18n();
  const auth = useAuth();
  const documents = useQuery<any>('/identity/legal-documents');
  const accept = useMutation((payload: { documentKey: string; version: string }) =>
    api.post('/identity/consents', payload));

  if (documents.loading) return null;

  return (
    <Card title={t('completeConsents')}>
      <div className="stack-sm">
        {(documents.data?.documents ?? []).filter((d: any) => d.key !== 'fees').map((doc: any) => (
          <div key={doc.key} className="row row--between">
            <div>
              <strong>{pick(doc.titleAr, doc.titleEn)}</strong>
              <span className="small muted"> · v{doc.version}</span>
            </div>
            <button
              type="button" className="btn btn--sm" disabled={accept.pending}
              onClick={async () => {
                if (await accept.run({ documentKey: doc.key, version: doc.version })) await auth.refresh();
              }}
            >
              {locale === 'ar' ? 'قرأت وأوافق' : 'I have read and accept'}
            </button>
          </div>
        ))}
        <ErrorNotice error={accept.error} />
        <p className="small muted" style={{ margin: 0 }}>
          {locale === 'ar'
            ? 'تُحفظ نسخة الوثيقة ووقت الموافقة كدليل.'
            : 'The document version and the time of acceptance are stored as evidence.'}
        </p>
      </div>
    </Card>
  );
}

function Suitability() {
  const { t, pick, locale } = useI18n();
  const auth = useAuth();
  const questions = useQuery<any>('/identity/suitability/questions');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<any>(null);
  const submit = useMutation(() => api.post('/identity/suitability', { answers }));

  if (questions.loading) return null;
  const list = questions.data?.questions ?? [];
  const complete = list.every((q: any) => answers[q.code]);

  return (
    <Card title={t('completeSuitability')}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await submit.run();
          if (result) { setOutcome(result); await auth.refresh(); }
        }}
      >
        {list.map((question: any) => (
          <fieldset key={question.code} style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, fontSize: '.92rem', marginBlockEnd: '.4rem' }}>
              {pick(question.textAr, question.textEn)}
            </legend>
            <div className="stack-sm">
              {question.options.map((option: any) => (
                <label key={option.value} className="checkbox">
                  <input
                    type="radio" name={question.code} value={option.value}
                    checked={answers[question.code] === option.value}
                    onChange={() => setAnswers((previous) => ({ ...previous, [question.code]: option.value }))}
                  />
                  <span>{pick(option.labelAr, option.labelEn)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <ErrorNotice error={submit.error} />

        {outcome ? (
          <div className={`notice notice--${outcome.result === 'pass' ? 'success' : outcome.result === 'warn' ? 'risk' : 'danger'}`}>
            {outcome.messageAr}
          </div>
        ) : null}

        <button type="submit" className="btn btn--primary" disabled={!complete || submit.pending}>
          {t('submit')}
        </button>
      </form>
    </Card>
  );
}

function Kyc() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const [form, setForm] = useState({ fullName: auth.user?.full_name ?? '', idReference: '', dateOfBirth: '', nationality: '' });
  const [result, setResult] = useState<any>(null);
  const start = useMutation(() => api.post('/identity/kyc/start', form));

  if (auth.investorProfile?.kycStatus === 'approved') return null;

  return (
    <Card title={t('completeKyc')}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          const outcome = await start.run();
          if (outcome) { setResult(outcome); await auth.refresh(); }
        }}
      >
        <Field label={t('fullName')} htmlFor="kyc-name">
          <input id="kyc-name" type="text" required minLength={3} value={form.fullName}
                 onChange={(event) => setForm((f) => ({ ...f, fullName: event.target.value }))} />
        </Field>
        <Field label={locale === 'ar' ? 'رقم البطاقة الشخصية' : 'National ID number'} htmlFor="kyc-id">
          <input id="kyc-id" type="text" dir="ltr" required minLength={4} value={form.idReference}
                 onChange={(event) => setForm((f) => ({ ...f, idReference: event.target.value }))} />
        </Field>
        <Field label={locale === 'ar' ? 'تاريخ الميلاد' : 'Date of birth'} htmlFor="kyc-dob">
          <input id="kyc-dob" type="date" value={form.dateOfBirth}
                 onChange={(event) => setForm((f) => ({ ...f, dateOfBirth: event.target.value }))} />
        </Field>

        <p className="small muted" style={{ margin: 0 }}>
          {locale === 'ar'
            ? 'يُجرى التحقق لدى مزود معتمد ويشمل فحص العقوبات والأشخاص المعرضين سياسيًا. لا تُرسل هذه البيانات إلى أدوات التحليلات.'
            : 'Verification is performed by an approved provider and includes sanctions and PEP screening. These details are never sent to analytics tools.'}
        </p>

        <ErrorNotice error={start.error} />
        {result ? (
          <div className={`notice notice--${result.status === 'approved' ? 'success' : 'info'}`}>
            {result.messageAr ?? result.messageEn}
          </div>
        ) : null}

        <button type="submit" className="btn btn--primary" disabled={start.pending}>
          {start.pending ? t('loading') : t('submit')}
        </button>
      </form>
    </Card>
  );
}

function Classification() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const [form, setForm] = useState({ netWorthOmr: '', annualIncomeOmr: '', professionalCertification: false, priorDeals: '' });
  const [result, setResult] = useState<any>(null);

  const declare = useMutation(() => api.post('/identity/classification', {
    netWorthOmr: form.netWorthOmr ? Number(form.netWorthOmr) : undefined,
    annualIncomeOmr: form.annualIncomeOmr ? Number(form.annualIncomeOmr) : undefined,
    professionalCertification: form.professionalCertification,
    priorDeals: form.priorDeals ? Number(form.priorDeals) : undefined,
  }));

  return (
    <Card title={t('classification')}>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          const outcome = await declare.run();
          if (outcome) { setResult(outcome); await auth.refresh(); }
        }}
      >
        <p className="small muted" style={{ margin: 0 }}>
          {locale === 'ar'
            ? 'يحدد التصنيف حدود الاستثمار المتاحة لك. أي تصنيف أعلى من «أفراد» يسري بعد مراجعة الامتثال.'
            : 'Your classification sets the limits available to you. Anything above retail takes effect after compliance review.'}
        </p>
        <div className="grid grid--two">
          <Field label={locale === 'ar' ? 'صافي الثروة (ر.ع)' : 'Net worth (OMR)'} htmlFor="net-worth">
            <input id="net-worth" type="number" min={0} dir="ltr" value={form.netWorthOmr}
                   onChange={(event) => setForm((f) => ({ ...f, netWorthOmr: event.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'الدخل السنوي (ر.ع)' : 'Annual income (OMR)'} htmlFor="income">
            <input id="income" type="number" min={0} dir="ltr" value={form.annualIncomeOmr}
                   onChange={(event) => setForm((f) => ({ ...f, annualIncomeOmr: event.target.value }))} />
          </Field>
          <Field label={locale === 'ar' ? 'عدد الصفقات السابقة' : 'Prior deals'} htmlFor="deals">
            <input id="deals" type="number" min={0} dir="ltr" value={form.priorDeals}
                   onChange={(event) => setForm((f) => ({ ...f, priorDeals: event.target.value }))} />
          </Field>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={form.professionalCertification}
                 onChange={(event) => setForm((f) => ({ ...f, professionalCertification: event.target.checked }))} />
          <span>{locale === 'ar' ? 'أحمل شهادة مهنية في الاستثمار أو المالية' : 'I hold a professional investment or finance certification'}</span>
        </label>

        <ErrorNotice error={declare.error} />
        {result ? <div className="notice notice--info">{result.messageAr}</div> : null}

        <button type="submit" className="btn" disabled={declare.pending}>{t('save')}</button>
      </form>
    </Card>
  );
}
