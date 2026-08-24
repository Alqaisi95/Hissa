/** FR-001 / FR-007 — registration with OTP, sign-in and MFA. */
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../../lib/i18n.tsx';
import { useMutation } from '../../lib/useApi.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { Card, ErrorNotice, Field } from '../../components/ui.tsx';

export function SignIn() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as any)?.from ?? '/portfolio';

  const [form, setForm] = useState({ identifier: '', password: '' });
  const [mfa, setMfa] = useState<{ required: boolean; devOtp?: string }>({ required: false });
  const [code, setCode] = useState('');

  const signIn = useMutation(() => auth.signIn(form.identifier, form.password));
  const verify = useMutation(() => auth.verifyMfa(code));

  if (mfa.required) {
    return (
      <div className="stack" style={{ maxWidth: 440, marginInline: 'auto' }}>
        <h1>{t('mfaTitle')}</h1>
        <Card>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const result = await verify.run();
              if (result !== null) navigate(destination, { replace: true });
            }}
          >
            <p className="small muted" style={{ margin: 0 }}>
              {locale === 'ar'
                ? 'أرسلنا رمز تحقق إلى وسيلة الاتصال المسجلة. يلزم هذا التحقق للأدوار الحساسة.'
                : 'We sent a verification code to your registered channel. Privileged roles require this step.'}
            </p>
            <Field label={t('otpCode')} htmlFor="mfa-code"
                   hint={mfa.devOtp ? `dev: ${mfa.devOtp}` : undefined}>
              <input id="mfa-code" type="text" inputMode="numeric" dir="ltr" maxLength={6} required
                     value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
            <ErrorNotice error={verify.error} />
            <button type="submit" className="btn btn--primary btn--block" disabled={verify.pending}>
              {t('confirm')}
            </button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 440, marginInline: 'auto' }}>
      <h1>{t('signIn')}</h1>
      <Card>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await signIn.run();
            if (!result) return;
            if (result.mfaRequired) setMfa({ required: true, devOtp: result.devOtp });
            else navigate(destination, { replace: true });
          }}
        >
          <Field label={`${t('email')} / ${t('phone')}`} htmlFor="identifier">
            <input id="identifier" type="text" dir="ltr" required autoComplete="username"
                   value={form.identifier}
                   onChange={(event) => setForm((f) => ({ ...f, identifier: event.target.value }))} />
          </Field>
          <Field label={t('password')} htmlFor="password">
            <input id="password" type="password" required autoComplete="current-password"
                   value={form.password}
                   onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))} />
          </Field>
          <ErrorNotice error={signIn.error} />
          <button type="submit" className="btn btn--primary btn--block" disabled={signIn.pending}>
            {signIn.pending ? t('loading') : t('signIn')}
          </button>
          <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>
            <Link to="/register">{t('register')}</Link>
          </p>
        </form>
      </Card>
    </div>
  );
}

export function Register() {
  const { t, locale } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', password: '',
    accountType: 'investor' as 'investor' | 'project_owner',
  });
  const [pending, setPending] = useState<{ userId: string; devOtp?: string } | null>(null);
  const [code, setCode] = useState('');

  const register = useMutation(() => api.post('/identity/register', {
    fullName: form.fullName,
    email: form.email || undefined,
    phone: form.phone || undefined,
    password: form.password,
    locale,
    accountType: form.accountType,
  }));
  const verify = useMutation(() => api.post('/identity/otp/verify', { userId: pending!.userId, code }));

  if (pending) {
    return (
      <div className="stack" style={{ maxWidth: 440, marginInline: 'auto' }}>
        <h1>{t('verifyContact')}</h1>
        <Card>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const verified = await verify.run();
              if (!verified) return;
              // FR-001 — the account becomes usable only after verification.
              await auth.signIn(form.email || form.phone, form.password);
              navigate('/account', { replace: true });
            }}
          >
            <p className="small muted" style={{ margin: 0 }}>
              {locale === 'ar'
                ? 'أدخل رمز التحقق المرسل إليك لتفعيل الحساب.'
                : 'Enter the verification code we sent to activate your account.'}
            </p>
            <Field label={t('otpCode')} htmlFor="otp" hint={pending.devOtp ? `dev: ${pending.devOtp}` : undefined}>
              <input id="otp" type="text" inputMode="numeric" dir="ltr" maxLength={6} required
                     value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
            <ErrorNotice error={verify.error} />
            <button type="submit" className="btn btn--primary btn--block" disabled={verify.pending}>
              {t('confirm')}
            </button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: 480, marginInline: 'auto' }}>
      <h1>{t('register')}</h1>
      <Card>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await register.run();
            if (result) setPending({ userId: result.userId, devOtp: result.devOtp });
          }}
        >
          <Field label={locale === 'ar' ? 'نوع الحساب' : 'Account type'} htmlFor="type">
            <select id="type" value={form.accountType}
                    onChange={(event) => setForm((f) => ({ ...f, accountType: event.target.value as any }))}>
              <option value="investor">{t('accountTypeInvestor')}</option>
              <option value="project_owner">{t('accountTypeOwner')}</option>
            </select>
          </Field>
          <Field label={t('fullName')} htmlFor="name">
            <input id="name" type="text" required minLength={3} value={form.fullName}
                   onChange={(event) => setForm((f) => ({ ...f, fullName: event.target.value }))} />
          </Field>
          <Field label={t('email')} htmlFor="email">
            <input id="email" type="email" dir="ltr" value={form.email} autoComplete="email"
                   onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))} />
          </Field>
          <Field label={t('phone')} htmlFor="phone"
                 hint={locale === 'ar' ? 'رقم عُماني، مثال: 91234567' : 'Omani mobile, e.g. 91234567'}>
            <input id="phone" type="tel" dir="ltr" value={form.phone} autoComplete="tel"
                   onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value }))} />
          </Field>
          <Field label={t('password')} htmlFor="new-password"
                 hint={locale === 'ar' ? '10 أحرف على الأقل' : 'At least 10 characters'}>
            <input id="new-password" type="password" required minLength={10} autoComplete="new-password"
                   value={form.password}
                   onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))} />
          </Field>
          <ErrorNotice error={register.error} />
          <button type="submit" className="btn btn--primary btn--block" disabled={register.pending}>
            {register.pending ? t('loading') : t('register')}
          </button>
        </form>
      </Card>
    </div>
  );
}
