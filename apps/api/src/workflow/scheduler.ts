/**
 * PRD §16.1 — the workflow engine's scheduled side: SLA clocks, report reminders,
 * closing sweeps, reconciliation and notification dispatch. Each run is recorded
 * in `job_runs` so operations can prove a job ran (NFR-012).
 */
import { all, get, run } from '../db/index.ts';
import { newId, nowIso, plus, days, hours } from '../lib/ids.ts';
import { audit } from '../lib/audit.ts';
import { slas } from '../lib/settings.ts';
import { notify, dispatchQueued } from '../integrations/notifications.ts';
import { closePool, poolsDueForClosing } from '../domains/funds/closing.ts';
import { transition } from './poolState.ts';

type JobResult = Record<string, unknown>;

function record(jobName: string, fn: () => JobResult): JobResult {
  const id = newId();
  const startedAt = nowIso();
  run(`INSERT INTO job_runs (id, job_name, status, started_at) VALUES (?,?, 'running', ?)`, [id, jobName, startedAt]);
  try {
    const summary = fn();
    run(`UPDATE job_runs SET status = 'ok', summary = ?, finished_at = ? WHERE id = ?`,
        [JSON.stringify(summary), nowIso(), id]);
    return summary;
  } catch (error) {
    run(`UPDATE job_runs SET status = 'failed', summary = ?, finished_at = ? WHERE id = ?`,
        [JSON.stringify({ error: (error as Error).message }), nowIso(), id]);
    throw error;
  }
}

/** FR-501 — reminders before a report is due, so nothing is missed silently. */
export const remindUpcomingReports = () => record('reports.remind', () => {
  const horizon = plus(nowIso(), days(7));
  const due = all<any>(
    `SELECT r.*, p.title_ar, p.application_id FROM project_reports r JOIN pools p ON p.id = r.pool_id
      WHERE r.status = 'scheduled' AND r.due_at BETWEEN ? AND ?`, [nowIso(), horizon]);

  for (const report of due) {
    const owner = get<any>(
      `SELECT ep.user_id FROM project_applications a JOIN entity_people ep ON ep.entity_id = a.entity_id
        WHERE a.id = ? AND ep.role = 'authorised_rep' LIMIT 1`, [report.application_id]);
    if (owner) {
      notify({ userId: owner.user_id, templateCode: 'report_due_soon',
               variables: { poolTitle: report.title_ar, period: report.period_label, dueAt: report.due_at } });
    }
  }
  return { reminded: due.length };
});

/** AT-06 / FR-504 — an overdue report raises an alert, a case and an escalation. */
export const flagLateReports = () => record('reports.flag_late', () => {
  const at = nowIso();
  const graceHours = slas().reportGraceHours;
  const late = all<any>(
    `SELECT r.*, p.title_ar, p.reference FROM project_reports r JOIN pools p ON p.id = r.pool_id
      WHERE r.status IN ('scheduled','draft') AND r.due_at < ?`, [at]);

  let flagged = 0;
  for (const report of late) {
    const overdueHours = (new Date(at).getTime() - new Date(report.due_at).getTime()) / hours(1);
    run(`UPDATE project_reports SET status = 'late' WHERE id = ?`, [report.id]);

    const existing = get<any>(
      `SELECT 1 FROM alerts WHERE pool_id = ? AND type = 'report_late'
         AND json_extract(context, '$.period') = ? AND status = 'open'`,
      [report.pool_id, report.period_label]);
    if (existing) continue;

    run(`INSERT INTO alerts (id, pool_id, type, severity, message_ar, context, status, created_at)
         VALUES (?,?, 'report_late', ?, ?, ?, 'open', ?)`,
        [newId(), report.pool_id, overdueHours > graceHours ? 'critical' : 'warning',
         `تأخر تقرير ${report.period_label} — ${report.title_ar}`,
         JSON.stringify({ period: report.period_label, dueAt: report.due_at, overdueHours: Math.round(overdueHours) }), at]);

    run(`INSERT INTO cases (id, reference, type, subject, body, severity, status, related_type, related_id,
                            sla_due_at, created_at, updated_at)
         VALUES (?,?, 'report_late', ?, ?, ?, 'open', 'pool', ?, ?, ?, ?)`,
        [newId(), `CASE-RPT-${report.reference}-${report.period_label}`,
         `تقرير متأخر — ${report.title_ar}`, `الفترة ${report.period_label} تجاوزت تاريخ الاستحقاق`,
         overdueHours > graceHours ? 'high' : 'normal', report.pool_id, plus(at, days(2)), at, at]);
    flagged += 1;
  }
  return { late: late.length, flagged };
});

/** FR-104 — information requests past their SLA are marked overdue and escalated. */
export const flagOverdueInfoRequests = () => record('info_requests.flag_overdue', () => {
  const at = nowIso();
  const overdue = all<any>(`SELECT * FROM info_requests WHERE status = 'open' AND due_at < ?`, [at]);
  for (const request of overdue) {
    run(`UPDATE info_requests SET status = 'overdue' WHERE id = ?`, [request.id]);
  }
  return { overdue: overdue.length };
});

/** FR-605 — complaints and cases breaching SLA are escalated, not left to age. */
export const escalateOverdueCases = () => record('cases.escalate_overdue', () => {
  const at = nowIso();
  const overdue = all<any>(
    `SELECT * FROM cases WHERE closed_at IS NULL AND status <> 'escalated' AND sla_due_at < ?`, [at]);

  for (const item of overdue) {
    run(`UPDATE cases SET status = 'escalated', severity = CASE severity WHEN 'critical' THEN 'critical' ELSE 'high' END,
                          updated_at = ? WHERE id = ?`, [at, item.id]);
    audit({ actorId: null, action: 'case.auto_escalated', entityType: 'case', entityId: item.id,
            before: { status: item.status }, after: { status: 'escalated' }, reason: 'SLA breached' });
  }
  return { escalated: overdue.length };
});

/**
 * FR-403 — the closing sweep. Pools past their window are moved to `expired` and
 * listed for the funds team; the actual close stays a dual-controlled human action
 * unless the pool failed its minimum, where the outcome is not discretionary.
 */
export const sweepClosings = (systemActorId?: string) => record('pools.sweep_closings', () => {
  const due = poolsDueForClosing();
  const results: unknown[] = [];

  for (const pool of due) {
    if (pool.committed < pool.min_amount) {
      // AT-03 — a failed minimum always refunds; no discretion involved.
      const actorId = systemActorId ?? get<any>(
        `SELECT user_id FROM user_roles WHERE role = 'finance_ops' LIMIT 1`)?.user_id;
      if (!actorId) continue;
      results.push(closePool(pool.id, actorId, 'scheduled close: funding window ended below minimum'));
    } else {
      // Target met: hand to the funds queue for an approved close.
      transition({ poolId: pool.id, to: 'expired', reason: 'funding window ended; awaiting approved close',
                   actorId: systemActorId ?? 'system', payload: { committed: pool.committed } });
      results.push({ poolId: pool.id, outcome: 'awaiting_close_approval', committed: pool.committed });
    }
  }
  return { processed: results.length, results };
});

/** FR-008 — accounts whose KYC has lapsed become Restricted until refreshed. */
export const restrictExpiredKyc = () => record('identity.restrict_expired_kyc', () => {
  const at = nowIso();
  const expired = all<any>(
    `SELECT p.id, p.user_id FROM investor_profiles p
      WHERE p.kyc_status = 'approved' AND p.kyc_expires_at IS NOT NULL AND p.kyc_expires_at < ?`, [at]);

  for (const profile of expired) {
    run(`UPDATE investor_profiles SET kyc_status = 'expired', updated_at = ? WHERE id = ?`, [at, profile.id]);
    run(`UPDATE users SET status = 'restricted', updated_at = ? WHERE id = ? AND status = 'active'`, [at, profile.user_id]);
    notify({ userId: profile.user_id, templateCode: 'kyc_refresh_required' });
    audit({ actorId: null, action: 'identity.kyc_expired', entityType: 'investor_profile', entityId: profile.id,
            after: { kycStatus: 'expired', userStatus: 'restricted' }, reason: 'periodic re-verification due' });
  }
  return { restricted: expired.length };
});

/** AT-09 — pending payments are queried rather than presumed failed. */
export const chasePendingPayments = () => record('payments.chase_pending', () => {
  const cutoff = plus(nowIso(), -hours(2));
  const stale = all<any>(
    `SELECT pr.*, o.reference FROM payment_references pr
       LEFT JOIN investment_orders o ON o.id = pr.order_id
      WHERE pr.status IN ('initiated','pending') AND pr.created_at < ?`, [cutoff]);

  for (const payment of stale) {
    // Never flip to failed on a timeout — raise it for reconciliation instead.
    const existing = get<any>(
      `SELECT 1 FROM cases WHERE type = 'recon_break' AND related_id = ? AND closed_at IS NULL`, [payment.provider_ref]);
    if (existing) continue;
    run(`INSERT INTO cases (id, reference, type, subject, body, severity, status, related_type, related_id,
                            sla_due_at, created_at, updated_at)
         VALUES (?,?, 'recon_break', ?, ?, 'normal', 'open', 'payment_reference', ?, ?, ?, ?)`,
        [newId(), `CASE-PEND-${payment.provider_ref}`, 'معاملة معلقة تتجاوز المدة المتوقعة',
         `المرجع ${payment.provider_ref} ما زال معلقًا. يلزم الاستعلام من الشريك قبل أي تغيير للحالة.`,
         payment.provider_ref, plus(nowIso(), hours(24)), nowIso(), nowIso()]);
  }
  return { stalePending: stale.length };
});

export const drainNotifications = () => record('notifications.dispatch', () => dispatchQueued(200));

export interface SchedulerHandle { stop: () => void }

/** Starts the in-process scheduler. Production would run these as cron workers. */
export function startScheduler(intervalMs = 60_000): SchedulerHandle {
  const tick = () => {
    try {
      flagOverdueInfoRequests();
      flagLateReports();
      escalateOverdueCases();
      restrictExpiredKyc();
      chasePendingPayments();
      sweepClosings();
      remindUpcomingReports();
      drainNotifications();
    } catch (error) {
      console.error('[scheduler] tick failed:', error);
    }
  };
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return { stop: () => clearInterval(handle) };
}

export const ALL_JOBS = {
  'reports.remind': remindUpcomingReports,
  'reports.flag_late': flagLateReports,
  'info_requests.flag_overdue': flagOverdueInfoRequests,
  'cases.escalate_overdue': escalateOverdueCases,
  'pools.sweep_closings': sweepClosings,
  'identity.restrict_expired_kyc': restrictExpiredKyc,
  'payments.chase_pending': chasePendingPayments,
  'notifications.dispatch': drainNotifications,
} as const;
