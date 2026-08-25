/**
 * FR-608 — the in-app inbox. Delivery is bilingual and template-driven, so what
 * lands here is the same approved text that goes out by email or SMS.
 */
import { useI18n } from '../../lib/i18n.tsx';
import { useQuery } from '../../lib/useApi.ts';
import { Badge, Card, Empty, ErrorNotice, Loading } from '../../components/ui.tsx';

const TOPIC: Record<string, { ar: string; en: string; tone: 'brand' | 'positive' | 'warning' | 'danger' | 'info' }> = {
  order_confirmed:      { ar: 'استثمار',  en: 'Investment', tone: 'positive' },
  order_failed:         { ar: 'استثمار',  en: 'Investment', tone: 'danger' },
  pool_funded:          { ar: 'تمويل',    en: 'Funding',    tone: 'positive' },
  pool_failed_refund:   { ar: 'استرداد',  en: 'Refund',     tone: 'warning' },
  refund_initiated:     { ar: 'استرداد',  en: 'Refund',     tone: 'warning' },
  material_change:      { ar: 'إفصاح',    en: 'Disclosure', tone: 'warning' },
  pool_extended:        { ar: 'إفصاح',    en: 'Disclosure', tone: 'info' },
  report_published:     { ar: 'تقرير',    en: 'Report',     tone: 'brand' },
  report_due_soon:      { ar: 'تقرير',    en: 'Report',     tone: 'warning' },
  distribution_paid:    { ar: 'توزيع',    en: 'Distribution', tone: 'positive' },
  pool_default:         { ar: 'تعثر',     en: 'Default',    tone: 'danger' },
  vote_opened:          { ar: 'تصويت',    en: 'Vote',       tone: 'brand' },
  complaint_received:   { ar: 'شكوى',     en: 'Complaint',  tone: 'info' },
  complaint_update:     { ar: 'شكوى',     en: 'Complaint',  tone: 'info' },
  complaint_resolved:   { ar: 'شكوى',     en: 'Complaint',  tone: 'positive' },
  dsar_received:        { ar: 'بيانات',   en: 'Data',       tone: 'info' },
  kyc_approved:         { ar: 'تحقق',     en: 'Verification', tone: 'positive' },
  kyc_rejected:         { ar: 'تحقق',     en: 'Verification', tone: 'danger' },
  kyc_refresh_required: { ar: 'تحقق',     en: 'Verification', tone: 'warning' },
  application_approved: { ar: 'طلب',      en: 'Application', tone: 'positive' },
  application_rejected: { ar: 'طلب',      en: 'Application', tone: 'danger' },
  application_received: { ar: 'طلب',      en: 'Application', tone: 'info' },
  info_request:         { ar: 'استكمال',  en: 'Information', tone: 'warning' },
};

export function Notifications() {
  const { t, locale, formatDate } = useI18n();
  const inbox = useQuery<any>('/notifications');

  if (inbox.loading) return <Loading rows={5} />;
  if (inbox.error) return <ErrorNotice error={inbox.error} onRetry={inbox.reload} />;

  const items = inbox.data?.items ?? [];

  return (
    <div className="stack">
      <h1>{t('navNotifications')}</h1>

      <Card>
        {items.length === 0 ? (
          <Empty>{locale === 'ar' ? 'لا توجد إشعارات.' : 'No notifications.'}</Empty>
        ) : (
          <div className="stack-sm">
            {items.map((item: any) => {
              const topic = TOPIC[item.template_code];
              return (
                <div key={item.id} className="panel stack-sm">
                  <div className="row row--between">
                    <div className="row" style={{ gap: '.4rem' }}>
                      {topic ? <Badge tone={topic.tone}>{locale === 'ar' ? topic.ar : topic.en}</Badge> : null}
                      {item.subject ? <strong className="small">{item.subject}</strong> : null}
                    </div>
                    <span className="small muted">{formatDate(item.created_at, true)}</span>
                  </div>
                  <p style={{ margin: 0 }}>{item.body}</p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <p className="small muted">
        {locale === 'ar'
          ? 'تصل الإشعارات المهمة أيضًا عبر البريد أو الرسائل القصيرة. لا تحتوي أي رسالة على رقم هوية أو حساب بنكي أو مستند.'
          : 'Important notifications also arrive by email or SMS. No message ever carries an ID number, a bank account, or a document.'}
      </p>
    </div>
  );
}
