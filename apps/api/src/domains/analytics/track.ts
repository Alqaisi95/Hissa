/**
 * PRD §14 — product analytics. §14.1 forbids sending ID numbers, bank accounts
 * or documents to analytics: user ids are replaced with a salted pseudonym and
 * properties are allow-listed to primitives.
 */
import crypto from 'node:crypto';
import { all, get, run } from '../../db/index.ts';
import { newId, nowIso, days } from '../../lib/ids.ts';

const PSEUDO_SALT = process.env.ANALYTICS_SALT ?? 'hissa-pilot-pseudonymisation-salt';

export const pseudonymise = (userId: string | null): string =>
  userId ? crypto.createHmac('sha256', PSEUDO_SALT).update(userId).digest('hex').slice(0, 24) : 'anonymous';

const BLOCKED_KEYS = /id_?number|iban|account|passport|phone|email|document|national/i;

export function track(name: string, userId: string | null, properties: Record<string, unknown> = {}, poolId?: string): void {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (BLOCKED_KEYS.test(key)) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
  }
  run(
    `INSERT INTO analytics_events (id, name, pseudo_id, pool_id, properties, created_at) VALUES (?,?,?,?,?,?)`,
    [newId(), name, pseudonymise(userId), poolId ?? null, JSON.stringify(safe), nowIso()],
  );
}

const countEvent = (name: string, since: string): number =>
  get<{ n: number }>(`SELECT COUNT(*) AS n FROM analytics_events WHERE name = ? AND created_at >= ?`, [name, since])?.n ?? 0;

const distinctEvent = (name: string, since: string): number =>
  get<{ n: number }>(`SELECT COUNT(DISTINCT pseudo_id) AS n FROM analytics_events WHERE name = ? AND created_at >= ?`,
    [name, since])?.n ?? 0;

/** §14.1 — the governing KPI definitions, computed from source-of-truth tables. */
export function kpiSnapshot(windowDays = 30) {
  const since = new Date(Date.now() - days(windowDays)).toISOString();

  const fundedGmv = get<{ total: number | null }>(
    `SELECT SUM(o.amount) AS total FROM investment_orders o JOIN pools p ON p.id = o.pool_id
      WHERE o.status IN ('confirmed','allocated') AND p.status IN ('funded','disbursement','operating','closed')`,
  )?.total ?? 0;

  const fundingTimes = all<{ published_at: string; funded_at: string }>(
    `SELECT published_at, funded_at FROM pools WHERE funded_at IS NOT NULL AND published_at IS NOT NULL`,
  ).map((p) => (new Date(p.funded_at).getTime() - new Date(p.published_at).getTime()) / days(1));

  const kycStarted = distinctEvent('kyc_started', since);
  const kycCompleted = distinctEvent('kyc_completed', since);

  const reportsDue = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM project_reports WHERE due_at <= ?`, [nowIso()])?.n ?? 0;
  const reportsOnTime = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM project_reports
      WHERE status IN ('approved','published') AND published_at IS NOT NULL AND published_at <= due_at`)?.n ?? 0;

  const openBreaks = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM reconciliation_breaks WHERE status <> 'resolved' AND sla_due_at < ?`, [nowIso()])?.n ?? 0;

  const repeatInvestors = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT investor_id FROM investment_orders WHERE status IN ('confirmed','allocated')
        GROUP BY investor_id HAVING COUNT(DISTINCT pool_id) > 1)`,
  )?.n ?? 0;
  const totalInvestors = get<{ n: number }>(
    `SELECT COUNT(DISTINCT investor_id) AS n FROM investment_orders WHERE status IN ('confirmed','allocated')`)?.n ?? 0;

  const complaintsClosed = all<any>(
    `SELECT sla_due_at, closed_at FROM cases WHERE type = 'complaint' AND closed_at IS NOT NULL`);
  const complaintsInSla = complaintsClosed.filter((c) => new Date(c.closed_at) <= new Date(c.sla_due_at)).length;

  return {
    windowDays,
    fundedGmv,                                          // Funded GMV
    fundingTimeDaysAvg: fundingTimes.length
      ? Math.round((fundingTimes.reduce((a, b) => a + b, 0) / fundingTimes.length) * 10) / 10 : null,
    kycCompletionRate: kycStarted ? Math.round((kycCompleted / kycStarted) * 100) : null,
    investorConversionRate: (() => {
      const viewers = distinctEvent('pool_viewed', since);
      const confirmed = distinctEvent('investment_confirmed', since);
      return viewers ? Math.round((confirmed / viewers) * 100) : null;
    })(),
    onTimeReportRate: reportsDue ? Math.round((reportsOnTime / reportsDue) * 100) : null,
    reconciliationBreaksOverSla: openBreaks,
    repeatInvestorRate: totalInvestors ? Math.round((repeatInvestors / totalInvestors) * 100) : null,
    complaintSlaRate: complaintsClosed.length ? Math.round((complaintsInSla / complaintsClosed.length) * 100) : null,
    funnel: {
      poolViewed: countEvent('pool_viewed', since),
      signupStarted: countEvent('signup_started', since),
      kycStarted, kycCompleted,
      investmentStarted: countEvent('investment_started', since),
      investmentConfirmed: countEvent('investment_confirmed', since),
    },
  };
}
