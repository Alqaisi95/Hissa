/** Shared presentational building blocks. */
import type { ReactNode } from 'react';
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
  return <Badge tone={statusTone(status)}>{label ?? statusLabel(status)}</Badge>;
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

let activeLocale: 'ar' | 'en' = 'ar';
export function setStatusLocale(locale: 'ar' | 'en') { activeLocale = locale; }
export function statusLabel(status: string): string {
  return STATUS_LABELS[status]?.[activeLocale] ?? status;
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

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  return REASON_LABELS[reason]?.[activeLocale] ?? reason;
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

export function Field({ label, hint, error, children, htmlFor }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error">{error}</span> : null}
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
