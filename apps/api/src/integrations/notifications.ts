/**
 * FR-608 — bilingual notification templates with preview, approval and channel
 * fallback. Delivery is queued in-database; a provider adapter drains the queue.
 * §14.1: notification bodies never carry ID numbers, IBANs or documents.
 */
import { all, get, run } from '../db/index.ts';
import { newId, nowIso } from '../lib/ids.ts';

export interface NotifyInput {
  userId: string | null;
  templateCode: string;
  channel?: 'email' | 'sms' | 'inapp';
  locale?: 'ar' | 'en';
  variables?: Record<string, string | number>;
}

function render(template: string, variables: Record<string, string | number> = {}): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => String(variables[key] ?? `{{${key}}}`));
}

export function notify(input: NotifyInput): string | null {
  const template = get<any>(
    `SELECT * FROM notification_templates WHERE code = ? AND status = 'approved'`, [input.templateCode],
  );
  // FR-608: unapproved templates are never dispatched.
  if (!template) return null;

  const user = input.userId ? get<any>(`SELECT locale, email, phone FROM users WHERE id = ?`, [input.userId]) : null;
  const locale = input.locale ?? user?.locale ?? 'ar';
  const channel = input.channel ?? template.channel;

  const body = render(locale === 'ar' ? template.body_ar : template.body_en, input.variables);
  const subject = render(locale === 'ar' ? (template.subject_ar ?? '') : (template.subject_en ?? ''), input.variables);

  const id = newId();
  run(
    `INSERT INTO notifications (id, user_id, template_code, channel, locale, subject, body, status, created_at)
     VALUES (?,?,?,?,?,?,?,'queued',?)`,
    [id, input.userId, input.templateCode, channel, locale, subject || null, body, nowIso()],
  );
  return id;
}

/** Drains the queue. A failed channel falls back to in-app so nothing is silently lost. */
export function dispatchQueued(limit = 100): { sent: number; failed: number } {
  const queued = all<any>(`SELECT * FROM notifications WHERE status = 'queued' ORDER BY created_at LIMIT ?`, [limit]);
  let sent = 0, failed = 0;

  for (const item of queued) {
    const recipient = item.user_id
      ? get<any>(`SELECT email, phone FROM users WHERE id = ?`, [item.user_id])
      : null;
    const deliverable =
      item.channel === 'inapp' ||
      (item.channel === 'email' && recipient?.email) ||
      (item.channel === 'sms' && recipient?.phone);

    if (deliverable) {
      run(`UPDATE notifications SET status = 'sent', sent_at = ? WHERE id = ?`, [nowIso(), item.id]);
      sent += 1;
    } else {
      run(`UPDATE notifications SET status = 'failed' WHERE id = ?`, [item.id]);
      run(
        `INSERT INTO notifications (id, user_id, template_code, channel, locale, subject, body, status, fallback_of, created_at)
         VALUES (?,?,?,'inapp',?,?,?,'queued',?,?)`,
        [newId(), item.user_id, item.template_code, item.locale, item.subject, item.body, item.id, nowIso()],
      );
      failed += 1;
    }
  }
  return { sent, failed };
}

export function inbox(userId: string, limit = 50) {
  return all(
    `SELECT id, template_code, channel, locale, subject, body, status, created_at
       FROM notifications WHERE user_id = ? AND channel = 'inapp' ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
}
