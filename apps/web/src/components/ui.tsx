/** Shared presentational building blocks. */
import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, ReactElement } from 'react';
import { useI18n } from '../lib/i18n.tsx';
import type { ApiError } from '../lib/api.ts';

export function Card({ title, actions, children, flush, className = '' }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string;
}) {
  if (!title && !actions) return <section className={`card ${className}`}>{children}</section>;
  return (
    <section className={`card card--flush ${className}`}>
      <header className="card__header">
        <h3 className="card__title">{title}</h3>
        {actions}
      </header>
      <div className={flush ? '' : 'card__body'}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {sub ? <div className="stat__sub">{sub}</div> : null}
    </div>
  );
}

type Tone = 'neutral' | 'brand' | 'positive' | 'warning' | 'danger' | 'info';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge${tone === 'neutral' ? '' : ` badge--${tone}`}`}>{children}</span>;
}

/** A single vocabulary for status colouring across every screen. */
export function statusTone(status: string): Tone {
  const map: Record<string, Tone> = {
    // pools
    draft: 'neutral', approved: 'info', funding: 'brand', paused: 'warning', funded: 'positive',
    refunding: 'warning', disbursement: 'info', operating: 'positive', default: 'danger',
    workout: 'warning', closed: 'neutral', cancelled: 'neutral', expired: 'warning',
    // orders & money
    pending: 'warning', confirmed: 'positive', allocated: 'positive', failed: 'danger',
    refunded: 'neutral', settled: 'positive', executed: 'positive', pending_approval: 'warning',
    requested: 'warning', paid: 'positive',
    // identity & cases
    not_started: 'neutral', in_review: 'warning', rejected: 'danger', restricted: 'warning',
    active: 'positive', suspended: 'danger', open: 'warning', in_progress: 'info',
    escalated: 'danger', resolved: 'positive', published: 'positive', submitted: 'info',
    scheduled: 'neutral', late: 'danger', overdue: 'danger', answered: 'positive',
    committee: 'info', due_diligence: 'info', conditional: 'warning', returned: 'warning',
  };
  return map[status] ?? 'neutral';
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { locale } = useI18n();
  return <Badge tone={statusTone(status)}>{label ?? statusLabel(status, locale)}</Badge>;
}

const STATUS_LABELS: Record<string, { ar: string; en: string }> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  submitted: { ar: 'مُرسل', en: 'Submitted' },
  due_diligence: { ar: 'عناية واجبة', en: 'Due diligence' },
  committee: { ar: 'لدى اللجنة', en: 'At committee' },
  approved: { ar: 'معتمد', en: 'Approved' },
  conditional: { ar: 'معتمد بشروط', en: 'Conditionally approved' },
  returned: { ar: 'مُعاد للاستكمال', en: 'Returned' },
  rejected: { ar: 'مرفوض', en: 'Rejected' },
  withdrawn: { ar: 'مسحوب', en: 'Withdrawn' },
  funding: { ar: 'مفتوحة للتمويل', en: 'Funding' },
  paused: { ar: 'موقوفة مؤقتًا', en: 'Paused' },
  funded: { ar: 'مموّلة', en: 'Funded' },
  refunding: { ar: 'قيد الاسترداد', en: 'Refunding' },
  disbursement: { ar: 'قيد الصرف', en: 'Disbursing' },
  operating: { ar: 'قيد التشغيل', en: 'Operating' },
  default: { ar: 'متعثرة', en: 'Default' },
  workout: { ar: 'قيد المعالجة', en: 'Workout' },
  closed: { ar: 'مغلقة', en: 'Closed' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled' },
  expired: { ar: 'منتهية المدة', en: 'Expired' },
  pending: { ar: 'قيد التأكيد', en: 'Pending' },
  confirmed: { ar: 'مؤكد', en: 'Confirmed' },
  allocated: { ar: 'مُخصص', en: 'Allocated' },
  failed: { ar: 'غير مكتمل', en: 'Failed' },
  refunded: { ar: 'مُسترد', en: 'Refunded' },
  settled: { ar: 'مُسوّى', en: 'Settled' },
  executed: { ar: 'مُنفّذ', en: 'Executed' },
  pending_approval: { ar: 'بانتظار الاعتماد', en: 'Pending approval' },
  requested: { ar: 'مطلوب', en: 'Requested' },
  paid: { ar: 'مدفوع', en: 'Paid' },
  not_started: { ar: 'لم يبدأ', en: 'Not started' },
  in_review: { ar: 'قيد المراجعة', en: 'In review' },
  expired_kyc: { ar: 'منتهي', en: 'Expired' },
  active: { ar: 'نشط', en: 'Active' },
  restricted: { ar: 'مقيّد', en: 'Restricted' },
  suspended: { ar: 'موقوف', en: 'Suspended' },
  open: { ar: 'مفتوح', en: 'Open' },
  in_progress: { ar: 'قيد العمل', en: 'In progress' },
  escalated: { ar: 'مُصعّد', en: 'Escalated' },
  resolved: { ar: 'مُغلق', en: 'Resolved' },
  published: { ar: 'منشور', en: 'Published' },
  scheduled: { ar: 'مجدول', en: 'Scheduled' },
  late: { ar: 'متأخر', en: 'Late' },
  overdue: { ar: 'متأخر', en: 'Overdue' },
  answered: { ar: 'تمت الإجابة', en: 'Answered' },
  awaiting_applicant: { ar: 'بانتظار مقدم الطلب', en: 'Awaiting applicant' },
  ready_for_committee: { ar: 'جاهز للجنة', en: 'Ready for committee' },
  decided: { ar: 'تم القرار', en: 'Decided' },
  retail: { ar: 'أفراد', en: 'Retail' },
  angel: { ar: 'ملائكي', en: 'Angel' },
  sophisticated: { ar: 'متمرس', en: 'Sophisticated' },
};

/**
 * Locale is passed in rather than read from a module variable: a badge must
 * re-render when the reader switches language, and only props or context do that.
 */
export function statusLabel(status: string, locale: 'ar' | 'en'): string {
  return STATUS_LABELS[status]?.[locale] ?? status;
}

/** Hook form, for call sites that need the string rather than the badge. */
export function useStatusLabel(): (status: string) => string {
  const { locale } = useI18n();
  return (status: string) => statusLabel(status, locale);
}

/** System-generated reason codes, rendered in the reader's language. */
const REASON_LABELS: Record<string, { ar: string; en: string }> = {
  'refund.target_not_reached': {
    ar: 'لم تحقق الفرصة حدها الأدنى عند الإغلاق — استرداد كامل',
    en: 'The pool did not reach its minimum at close — full refund',
  },
  'refund.allocation_remainder': {
    ar: 'المبلغ الفائض عن التخصيص بعد تجاوز الهدف',
    en: 'Amount above the allocation after oversubscription',
  },
  'refund.investor_cancellation': {
    ar: 'إلغاء المستثمر ضمن فترة التراجع',
    en: 'Investor cancellation within the cooling-off window',
  },
};

export function reasonLabel(reason: string | null | undefined, locale: 'ar' | 'en'): string {
  if (!reason) return '—';
  return REASON_LABELS[reason]?.[locale] ?? reason;
}

/** Renders a system reason code in the reader's language. */
export function Reason({ code }: { code: string | null | undefined }) {
  const { locale } = useI18n();
  return <>{reasonLabel(code, locale)}</>;
}

export function Progress({ bps, label }: { bps: number; label?: ReactNode }) {
  const clamped = Math.max(0, Math.min(100, bps / 100));
  return (
    <div className="stack-sm">
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === 'string' ? label : undefined}
      >
        <div className="progress__bar" style={{ width: `${clamped}%` }} />
      </div>
      {label ? <div className="small muted">{label}</div> : null}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="stack-sm" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">{t('loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: index === 0 ? 28 : 18, width: index === 0 ? '45%' : '100%' }} />
      ))}
    </div>
  );
}

/** Renders an API error in the reader's own language, with its correlation id. */
export function ErrorNotice({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  const { locale, t } = useI18n();
  if (!error) return null;
  const message = locale === 'ar' ? error.payload.messageAr : error.payload.messageEn;

  return (
    <div className="notice notice--danger stack-sm" role="alert">
      <strong>{message}</strong>
      {error.payload.fields?.length ? (
        <ul className="small" style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
          {error.payload.fields.map((field) => <li key={field.path}>{field.path}: {field.message}</li>)}
        </ul>
      ) : null}
      {error.payload.details?.missing ? (
        <ul className="small" style={{ margin: 0, paddingInlineStart: '1.1rem' }}>
          {(error.payload.details.missing as string[]).map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      <div className="row">
        {onRetry ? <button type="button" className="btn btn--sm" onClick={onRetry}>{t('retry')}</button> : null}
        {error.payload.correlationId ? (
          <span className="small mono muted">{error.payload.correlationId}</span>
        ) : null}
      </div>
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <p className="muted small" style={{ margin: '.5rem 0' }}>{children ?? t('empty')}</p>;
}

/** BR-013 — the standing capital-loss warning shown on every decision surface. */
export function RiskNotice() {
  const { t } = useI18n();
  return <div className="notice notice--risk" role="note">{t('riskBanner')}</div>;
}

export function Money({ baisa, decimals }: { baisa: number | null | undefined; decimals?: number }) {
  const { formatOmr } = useI18n();
  return <span className="numeric">{formatOmr(baisa, { decimals })}</span>;
}

/**
 * The hint and the error are described *to* the control, not merely printed
 * under it.
 *
 * They used to be anonymous spans. Checkout pointed at `aria-describedby=
 * "amount-hint"` and no element carried that id, so the minimum ticket and the
 * remaining limit — the two numbers that decide whether an amount is accepted
 * — were never announced, and every audit tool flagged the dangling
 * reference. Wiring it here fixes all 117 Field usages at once, without
 * touching one of them.
 *
 * The control is cloned to receive the ids. Where a Field wraps something
 * other than a single element — a radio group, a fieldset — it is rendered
 * untouched, which is what it did before.
 */
export function Field({ label, hint, error, children, htmlFor }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string;
}) {
  const generated = useId();
  const base = htmlFor ?? generated;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const only = Children.count(children) === 1 ? Children.only(children) : null;
  const control = only && isValidElement(only) && describedBy
    ? cloneElement(only as ReactElement<Record<string, unknown>>, {
        'aria-describedby': [(only.props as Record<string, unknown>)['aria-describedby'], describedBy]
          .filter(Boolean).join(' '),
        ...(error ? { 'aria-invalid': true } : {}),
      })
    : children;

  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {control}
      {hint ? <span className="field__hint" id={hintId}>{hint}</span> : null}
      {error ? <span className="field__error" id={errorId}>{error}</span> : null}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: { key: T; label: ReactNode }[]; active: T; onChange: (key: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key} type="button" role="tab"
          aria-selected={tab.key === active}
          className={tab.key === active ? 'is-active' : ''}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────── asking for a reason ───────────────────────
 *
 * Thirty-seven staff actions — pausing a pool, cancelling one, recording a
 * default, closing out a settlement — collected their justification through
 * window.prompt, and every call site did the same thing with the result:
 *
 *     const r = ask('Pause reason (10+)'); if (r.length >= 10) run(pause.run(r));
 *
 * Nine characters and the click vanished. No message, no field error, nothing
 * to distinguish a rejected reason from a broken button — on actions that move
 * investor money. Multi-step ones (default → reason, then plan) could be
 * abandoned halfway with no trace. window.prompt is also unstyled, ignores the
 * document's direction, cannot be translated, and some browsers suppress it.
 *
 * The dialog states the requirement, keeps the confirm button disabled until
 * it is met, and says why. Cancelling is explicit.
 */
export interface AskField {
  name: string;
  label: ReactNode;
  minLength?: number;
  type?: 'text' | 'number';
  multiline?: boolean;
}

interface AskRequest {
  title: ReactNode;
  intro?: ReactNode;
  fields: AskField[];
  confirmText?: ReactNode;
  danger?: boolean;
  resolve: (value: Record<string, string> | null) => void;
}

export function useReasonDialog() {
  const [request, setRequest] = useState<AskRequest | null>(null);

  const ask = useCallback(
    (config: Omit<AskRequest, 'resolve'>) =>
      new Promise<Record<string, string> | null>((resolve) => setRequest({ ...config, resolve })),
    [],
  );

  const dialog = request
    ? <ReasonDialog request={request} onClose={() => setRequest(null)} />
    : null;

  return { ask, dialog };
}

function ReasonDialog({ request, onClose }: { request: AskRequest; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const first = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => { first.current?.focus(); }, []);

  const shortfall = (field: AskField): number => {
    const value = (values[field.name] ?? '').trim();
    return Math.max(0, (field.minLength ?? 0) - value.length);
  };
  const complete = request.fields.every((field) => shortfall(field) === 0 && (values[field.name] ?? '').trim() !== '');

  const finish = (result: Record<string, string> | null) => { request.resolve(result); onClose(); };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) finish(null); }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={typeof request.title === 'string' ? request.title : undefined}
        className="modal"
        onKeyDown={(event) => { if (event.key === 'Escape') finish(null); }}
      >
        <h3 className="modal__title">{request.title}</h3>
        {request.intro ? <p className="small muted">{request.intro}</p> : null}

        {request.fields.map((field, index) => {
          const missing = shortfall(field);
          const showError = touched[field.name] && missing > 0;
          return (
            <Field
              key={field.name}
              htmlFor={`ask-${field.name}`}
              label={field.label}
              hint={field.minLength
                ? (locale === 'ar'
                    ? `${field.minLength} أحرف على الأقل`
                    : `at least ${field.minLength} characters`)
                : undefined}
              error={showError
                ? (locale === 'ar'
                    ? `ينقص ${missing} ${missing === 1 ? 'حرف' : 'حرفًا'}`
                    : `${missing} more character${missing === 1 ? '' : 's'} needed`)
                : undefined}
            >
              {field.multiline ? (
                <textarea
                  id={`ask-${field.name}`}
                  ref={index === 0 ? (first as React.RefObject<HTMLTextAreaElement>) : undefined}
                  value={values[field.name] ?? ''}
                  onChange={(event) => setValues((v) => ({ ...v, [field.name]: event.target.value }))}
                  onBlur={() => setTouched((s) => ({ ...s, [field.name]: true }))}
                />
              ) : (
                <input
                  id={`ask-${field.name}`}
                  type={field.type === 'number' ? 'number' : 'text'}
                  ref={index === 0 ? (first as React.RefObject<HTMLInputElement>) : undefined}
                  value={values[field.name] ?? ''}
                  onChange={(event) => setValues((v) => ({ ...v, [field.name]: event.target.value }))}
                  onBlur={() => setTouched((s) => ({ ...s, [field.name]: true }))}
                />
              )}
            </Field>
          );
        })}

        <div className="modal__actions">
          <button type="button" className="btn" onClick={() => finish(null)}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className={request.danger ? 'btn btn--danger' : 'btn btn--primary'}
            disabled={!complete}
            onClick={() => finish(
              Object.fromEntries(request.fields.map((f) => [f.name, (values[f.name] ?? '').trim()])),
            )}
          >
            {request.confirmText ?? t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
