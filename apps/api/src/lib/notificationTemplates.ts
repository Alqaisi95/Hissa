/**
 * FR-608 — the bilingual notification catalogue. Templates live here so the seed,
 * the test harness and operations all install the same, reviewed set. Editing a
 * template in production goes through the admin propose/approve flow instead.
 */
import { run } from '../db/index.ts';
import { newId, nowIso } from './ids.ts';

export interface TemplateDefinition {
  code: string;
  channel: 'email' | 'sms' | 'inapp';
  subjectAr?: string; subjectEn?: string;
  bodyAr: string; bodyEn: string;
}

export const NOTIFICATION_TEMPLATES: TemplateDefinition[] = [
  { code: 'otp_code', channel: 'sms', subjectAr: 'رمز التحقق', subjectEn: 'Verification code',
    bodyAr: 'رمز التحقق الخاص بك هو {{code}} وينتهي خلال {{minutes}} دقائق. لا تشاركه مع أحد.',
    bodyEn: 'Your verification code is {{code}}, valid for {{minutes}} minutes. Never share it.' },

  { code: 'kyc_approved', channel: 'email', subjectAr: 'اكتمل التحقق من هويتك', subjectEn: 'Identity verification approved',
    bodyAr: 'تم اعتماد التحقق من هويتك. يمكنك الآن استعراض الفرص والاستثمار ضمن حدودك.',
    bodyEn: 'Your identity verification is approved. You can now browse opportunities and invest within your limits.' },

  { code: 'kyc_rejected', channel: 'email', subjectAr: 'تحديث بشأن التحقق', subjectEn: 'Verification update',
    bodyAr: 'تعذر إكمال التحقق حاليًا. سيتواصل معك فريق الامتثال خلال يومي عمل.',
    bodyEn: 'Verification could not be completed. Compliance will contact you within two business days.' },

  { code: 'kyc_refresh_required', channel: 'email', subjectAr: 'يلزم تحديث بيانات التحقق', subjectEn: 'Verification refresh required',
    bodyAr: 'انتهت صلاحية التحقق من هويتك. حسابك مقيد مؤقتًا حتى إعادة التحقق.',
    bodyEn: 'Your identity verification has expired. Your account is restricted until you re-verify.' },

  { code: 'application_received', channel: 'email', subjectAr: 'استلمنا طلبك', subjectEn: 'Application received',
    bodyAr: 'استلمنا طلب التمويل {{reference}}. سيتواصل معك المحلل عند بدء العناية الواجبة.',
    bodyEn: 'We received application {{reference}}. An analyst will contact you when due diligence starts.' },

  { code: 'info_request', channel: 'email', subjectAr: 'طلب استكمال بيانات', subjectEn: 'Information request',
    bodyAr: 'يوجد طلب استكمال جديد على الطلب {{reference}}. يرجى الرد قبل الموعد المحدد.',
    bodyEn: 'A new information request is open on application {{reference}}. Please respond before the due date.' },

  { code: 'application_approved', channel: 'email', subjectAr: 'قرار لجنة الاستثمار', subjectEn: 'Committee decision',
    bodyAr: 'بخصوص الطلب {{reference}}: {{message}}', bodyEn: 'Regarding application {{reference}}: {{message}}' },

  { code: 'application_rejected', channel: 'email', subjectAr: 'قرار لجنة الاستثمار', subjectEn: 'Committee decision',
    bodyAr: 'بخصوص الطلب {{reference}}: {{message}}', bodyEn: 'Regarding application {{reference}}: {{message}}' },

  { code: 'order_confirmed', channel: 'email', subjectAr: 'تأكيد التزامك الاستثماري', subjectEn: 'Investment confirmed',
    bodyAr: 'تم تأكيد التزامك {{reference}} في فرصة {{poolTitle}}. الإيصال متاح في محفظتك.',
    bodyEn: 'Your commitment {{reference}} in {{poolTitle}} is confirmed. The receipt is available in your portfolio.' },

  { code: 'order_failed', channel: 'email', subjectAr: 'لم تكتمل عملية الدفع', subjectEn: 'Payment not completed',
    bodyAr: 'لم تكتمل عملية الدفع للالتزام {{reference}}. يمكنك المحاولة مرة أخرى.',
    bodyEn: 'The payment for commitment {{reference}} was not completed. You may try again.' },

  { code: 'pool_funded', channel: 'email', subjectAr: 'اكتمل تمويل الفرصة', subjectEn: 'Pool funded',
    bodyAr: 'اكتمل تمويل {{poolTitle}}. المبلغ المخصص لك {{allocated}} ر.ع، والمبلغ المسترد {{refund}} ر.ع.',
    bodyEn: '{{poolTitle}} is fully funded. Your allocation is OMR {{allocated}} and OMR {{refund}} will be refunded.' },

  { code: 'pool_failed_refund', channel: 'email', subjectAr: 'لم يكتمل التمويل — استرداد', subjectEn: 'Funding not completed — refund',
    bodyAr: 'لم تحقق فرصة {{poolTitle}} حدها الأدنى. سيُسترد مبلغ {{amount}} ر.ع وفق إجراءات الشريك المرخّص.',
    bodyEn: '{{poolTitle}} did not reach its minimum. OMR {{amount}} will be refunded through the licensed partner.' },

  { code: 'pool_extended', channel: 'email', subjectAr: 'تمديد مدة الفرصة', subjectEn: 'Pool extended',
    bodyAr: 'تم تمديد مدة جمع التمويل لفرصة {{poolTitle}} حتى {{closesAt}}.',
    bodyEn: 'The funding window for {{poolTitle}} has been extended to {{closesAt}}.' },

  { code: 'material_change', channel: 'email', subjectAr: 'تغيير جوهري في الإفصاح', subjectEn: 'Material disclosure change',
    bodyAr: 'صدرت نسخة إفصاح جديدة رقم {{version}} لفرصة {{poolTitle}}. يرجى مراجعتها قبل أي قرار.',
    bodyEn: 'A new disclosure version {{version}} was issued for {{poolTitle}}. Please review it before deciding.' },

  { code: 'refund_initiated', channel: 'email', subjectAr: 'بدء إجراء الاسترداد', subjectEn: 'Refund initiated',
    bodyAr: 'بدأ إجراء استرداد مبلغ {{amount}} ر.ع للالتزام {{reference}}.',
    bodyEn: 'A refund of OMR {{amount}} for commitment {{reference}} has been initiated.' },

  { code: 'report_due_soon', channel: 'email', subjectAr: 'تذكير بموعد التقرير', subjectEn: 'Report due soon',
    bodyAr: 'يستحق تقرير الفترة {{period}} لمشروع {{poolTitle}} بتاريخ {{dueAt}}.',
    bodyEn: 'The {{period}} report for {{poolTitle}} is due on {{dueAt}}.' },

  { code: 'report_published', channel: 'email', subjectAr: 'نشر تقرير المشروع', subjectEn: 'Project report published',
    bodyAr: 'نُشر تقرير الفترة {{period}} لفرصة {{poolTitle}}. يمكنك الاطلاع عليه من محفظتك.',
    bodyEn: 'The {{period}} report for {{poolTitle}} has been published in your portfolio.' },

  { code: 'distribution_paid', channel: 'email', subjectAr: 'توزيع نقدي', subjectEn: 'Distribution paid',
    bodyAr: 'اعتُمد توزيع الفترة {{period}} لفرصة {{poolTitle}} بمبلغ {{amount}} ر.ع.',
    bodyEn: 'The {{period}} distribution for {{poolTitle}} of OMR {{amount}} has been approved.' },

  { code: 'pool_default', channel: 'email', subjectAr: 'تحديث مهم بشأن مشروعك', subjectEn: 'Important project update',
    bodyAr: 'سُجلت حالة تعثر لفرصة {{poolTitle}}. سنوافيك بخطة المعالجة وتحديثات دورية.',
    bodyEn: 'A default has been recorded for {{poolTitle}}. We will share the workout plan and regular updates.' },

  { code: 'vote_opened', channel: 'email', subjectAr: 'فتح باب التصويت', subjectEn: 'Voting is open',
    bodyAr: 'فُتح التصويت على «{{title}}» ويغلق في {{closesAt}}.',
    bodyEn: 'Voting on "{{title}}" is open and closes on {{closesAt}}.' },

  { code: 'complaint_received', channel: 'email', subjectAr: 'استلمنا شكواك', subjectEn: 'Complaint received',
    bodyAr: 'استلمنا شكواك برقم {{reference}}. الموعد المستهدف للرد {{slaDueAt}}.',
    bodyEn: 'We received your complaint {{reference}}. Target response by {{slaDueAt}}.' },

  { code: 'complaint_update', channel: 'inapp', subjectAr: 'تحديث على شكواك', subjectEn: 'Complaint update',
    bodyAr: 'يوجد تحديث جديد على الشكوى {{reference}}.', bodyEn: 'There is a new update on complaint {{reference}}.' },

  { code: 'complaint_resolved', channel: 'email', subjectAr: 'إغلاق الشكوى', subjectEn: 'Complaint resolved',
    bodyAr: 'أُغلقت الشكوى {{reference}}. الملخص: {{resolution}}',
    bodyEn: 'Complaint {{reference}} is closed. Summary: {{resolution}}' },

  { code: 'dsar_received', channel: 'email', subjectAr: 'استلمنا طلب بياناتك', subjectEn: 'Data request received',
    bodyAr: 'استلمنا طلبك برقم {{reference}} وسيُرد عليه خلال المدة النظامية.',
    bodyEn: 'We received your request {{reference}} and will respond within the statutory period.' },
];

/** Installs the catalogue as approved templates, attributed to the approving user. */
export function installTemplates(approvedBy: string): number {
  for (const template of NOTIFICATION_TEMPLATES) {
    run(
      `INSERT INTO notification_templates (id, code, channel, subject_ar, subject_en, body_ar, body_en,
                                           status, approved_by, updated_at)
       VALUES (?,?,?,?,?,?,?, 'approved', ?, ?)
       ON CONFLICT(code) DO UPDATE SET channel = excluded.channel, subject_ar = excluded.subject_ar,
         subject_en = excluded.subject_en, body_ar = excluded.body_ar, body_en = excluded.body_en,
         status = 'approved', approved_by = excluded.approved_by, updated_at = excluded.updated_at`,
      [newId(), template.code, template.channel, template.subjectAr ?? null, template.subjectEn ?? null,
       template.bodyAr, template.bodyEn, approvedBy, nowIso()],
    );
  }
  return NOTIFICATION_TEMPLATES.length;
}
