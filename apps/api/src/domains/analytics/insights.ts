/**
 * Aggregations behind the dashboards (PRD §14). Every figure is derived from the
 * source-of-truth tables rather than a cached counter, so a dashboard and an
 * export of the same period always agree.
 */
import { all, get } from '../../db/index.ts';
import { nowIso, days } from '../../lib/ids.ts';

/** Inclusive list of ISO dates from `from` to `to`, so gaps render as zero not as a break. */
function dateSpan(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  for (let t = new Date(`${from}T00:00:00.000Z`).getTime(); t <= end; t += days(1)) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export interface OverviewInsights {
  window: { from: string; to: string; days: number };
  commitments: { date: string; amount: number; count: number; cumulative: number }[];
  funnel: { stage: string; labelAr: string; labelEn: string; value: number }[];
  poolStatus: { status: string; count: number; target: number }[];
  sectors: { sector: string; funded: number; pools: number }[];
  health: {
    reconciliationOpen: number; reconciliationOverSla: number;
    casesOpen: number; casesOverSla: number;
    reportsDue: number; reportsLate: number;
    fundsAwaitingApproval: number;
  };
  disbursement: { planned: number; approved: number; executed: number };
}

export function overviewInsights(windowDays = 90): OverviewInsights {
  const to = nowIso().slice(0, 10);
  const from = new Date(Date.now() - days(windowDays)).toISOString().slice(0, 10);
  const at = nowIso();

  // Commitments per day, counted at creation so the curve shows demand as it arrived.
  const rows = all<{ d: string; amount: number; n: number }>(
    `SELECT substr(created_at, 1, 10) AS d, SUM(amount) AS amount, COUNT(*) AS n
       FROM investment_orders
      WHERE status IN ('pending','confirmed','allocated') AND substr(created_at,1,10) >= ?
      GROUP BY d ORDER BY d`,
    [from],
  );
  const byDate = new Map(rows.map((r) => [r.d, r]));
  let running = 0;
  const commitments = dateSpan(from, to).map((date) => {
    const row = byDate.get(date);
    running += row?.amount ?? 0;
    return { date, amount: row?.amount ?? 0, count: row?.n ?? 0, cumulative: running };
  });

  // Ordinal funnel: each stage is a subset of the one before it.
  const distinct = (name: string) => get<{ n: number }>(
    `SELECT COUNT(DISTINCT pseudo_id) AS n FROM analytics_events WHERE name = ?`, [name])?.n ?? 0;
  const funnel = [
    { stage: 'viewed',    labelAr: 'اطّلع على فرصة',  labelEn: 'Viewed a pool',     value: distinct('pool_viewed') },
    { stage: 'signup',    labelAr: 'أنشأ حسابًا',      labelEn: 'Signed up',         value: distinct('signup_started') },
    { stage: 'kyc',       labelAr: 'اكتمل التحقق',    labelEn: 'Verified',          value: distinct('kyc_completed') },
    { stage: 'started',   labelAr: 'بدأ الاستثمار',   labelEn: 'Started investing',  value: distinct('investment_started') },
    { stage: 'confirmed', labelAr: 'التزام مؤكد',     labelEn: 'Commitment confirmed', value: distinct('investment_confirmed') },
  ];

  const poolStatus = all<{ status: string; count: number; target: number }>(
    `SELECT status, COUNT(*) AS count, COALESCE(SUM(target_amount),0) AS target
       FROM pools GROUP BY status ORDER BY count DESC`);

  const sectors = all<{ sector: string; funded: number; pools: number }>(
    `SELECT p.sector,
            COALESCE(SUM(CASE WHEN o.status = 'allocated' THEN COALESCE(o.allocated_amount, o.amount) ELSE 0 END), 0) AS funded,
            COUNT(DISTINCT p.id) AS pools
       FROM pools p LEFT JOIN investment_orders o ON o.pool_id = p.id
      GROUP BY p.sector ORDER BY funded DESC`);

  const count = (sql: string, params: any[] = []) => get<{ n: number }>(sql, params)?.n ?? 0;

  return {
    window: { from, to, days: windowDays },
    commitments,
    funnel,
    poolStatus,
    sectors,
    health: {
      reconciliationOpen: count(`SELECT COUNT(*) AS n FROM reconciliation_breaks WHERE status <> 'resolved'`),
      reconciliationOverSla: count(
        `SELECT COUNT(*) AS n FROM reconciliation_breaks WHERE status <> 'resolved' AND sla_due_at < ?`, [at]),
      casesOpen: count(`SELECT COUNT(*) AS n FROM cases WHERE closed_at IS NULL`),
      casesOverSla: count(`SELECT COUNT(*) AS n FROM cases WHERE closed_at IS NULL AND sla_due_at < ?`, [at]),
      reportsDue: count(
        `SELECT COUNT(*) AS n FROM project_reports WHERE status IN ('scheduled','draft') AND due_at >= ?`, [at]),
      reportsLate: count(
        `SELECT COUNT(*) AS n FROM project_reports WHERE status IN ('scheduled','draft','late') AND due_at < ?`, [at]),
      fundsAwaitingApproval: count(
        `SELECT (SELECT COUNT(*) FROM disbursements WHERE status = 'pending_approval')
              + (SELECT COUNT(*) FROM refunds WHERE status IN ('requested','pending_approval'))
              + (SELECT COUNT(*) FROM distributions WHERE status = 'pending_approval') AS n`),
    },
    disbursement: {
      planned:  get<{ t: number | null }>(
        `SELECT SUM(amount) AS t FROM disbursements WHERE status NOT IN ('rejected','cancelled')`)?.t ?? 0,
      approved: get<{ t: number | null }>(
        `SELECT SUM(amount) AS t FROM disbursements WHERE status IN ('approved','executed')`)?.t ?? 0,
      executed: get<{ t: number | null }>(
        `SELECT SUM(amount) AS t FROM disbursements WHERE status = 'executed'`)?.t ?? 0,
    },
  };
}

export interface PoolInsights {
  pool: Record<string, any>;
  fundingCurve: { date: string; amount: number; cumulative: number }[];
  investorMix: { classification: string; investors: number; amount: number }[];
  ticketBands: { band: string; from: number; to: number | null; investors: number; amount: number }[];
  milestones: { code: string; label: string; amount: number; status: string; executedAt: string | null }[];
  reports: { period: string; dueAt: string; status: string; publishedAt: string | null; onTime: boolean | null }[];
  kpiSeries: { metric: string; points: { period: string; actual: number; forecast: number | null }[] }[];
  distributions: { period: string; gross: number; fee: number; net: number; status: string }[];
}

export function poolInsights(poolId: string): PoolInsights | null {
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [poolId]);
  if (!pool) return null;

  const daily = all<{ d: string; amount: number }>(
    `SELECT substr(created_at,1,10) AS d, SUM(amount) AS amount
       FROM investment_orders WHERE pool_id = ? AND status IN ('pending','confirmed','allocated')
      GROUP BY d ORDER BY d`, [poolId]);

  let running = 0;
  const fundingCurve = daily.length
    ? dateSpan(daily[0].d, nowIso().slice(0, 10)).map((date) => {
        const row = daily.find((r) => r.d === date);
        running += row?.amount ?? 0;
        return { date, amount: row?.amount ?? 0, cumulative: running };
      })
    : [];

  const investorMix = all<{ classification: string; investors: number; amount: number }>(
    `SELECT COALESCE(ip.classification,'retail') AS classification,
            COUNT(DISTINCT o.investor_id) AS investors,
            SUM(COALESCE(o.allocated_amount, o.amount)) AS amount
       FROM investment_orders o
       LEFT JOIN investor_profiles ip ON ip.user_id = o.investor_id
      WHERE o.pool_id = ? AND o.status IN ('pending','confirmed','allocated')
      GROUP BY classification ORDER BY amount DESC`, [poolId]);

  // Ordinal ticket bands — order carries meaning, so the UI ramps them.
  const BANDS: [string, number, number | null][] = [
    ['100 – 999', 100_000, 1_000_000],
    ['1,000 – 4,999', 1_000_000, 5_000_000],
    ['5,000 – 19,999', 5_000_000, 20_000_000],
    ['20,000+', 20_000_000, null],
  ];
  const ticketBands = BANDS.map(([band, lo, hi]) => {
    const row = get<{ investors: number; amount: number | null }>(
      `SELECT COUNT(*) AS investors, SUM(amount) AS amount FROM investment_orders
        WHERE pool_id = ? AND status IN ('pending','confirmed','allocated')
          AND amount >= ? ${hi === null ? '' : 'AND amount < ?'}`,
      hi === null ? [poolId, lo] : [poolId, lo, hi]);
    return { band, from: lo, to: hi, investors: row?.investors ?? 0, amount: row?.amount ?? 0 };
  });

  const milestones = all<any>(
    `SELECT milestone_code, milestone_label, amount, status, executed_at FROM disbursements
      WHERE pool_id = ? ORDER BY created_at`, [poolId])
    .map((d) => ({ code: d.milestone_code, label: d.milestone_label, amount: d.amount,
                   status: d.status, executedAt: d.executed_at }));

  const reportRows = all<any>(
    `SELECT period_label, due_at, status, published_at, kpis FROM project_reports
      WHERE pool_id = ? ORDER BY period_end`, [poolId]);

  const reports = reportRows.map((r) => ({
    period: r.period_label, dueAt: r.due_at, status: r.status, publishedAt: r.published_at,
    onTime: r.published_at ? new Date(r.published_at) <= new Date(r.due_at) : null,
  }));

  // One series per metric, ordered by period, so actual-vs-forecast plots directly.
  const metrics = new Map<string, { period: string; actual: number; forecast: number | null }[]>();
  for (const row of reportRows) {
    if (!['approved', 'published'].includes(row.status)) continue;
    const kpis = JSON.parse(row.kpis || '{}') as Record<string, { actual: number; forecast?: number }>;
    for (const [metric, values] of Object.entries(kpis)) {
      if (!metrics.has(metric)) metrics.set(metric, []);
      metrics.get(metric)!.push({ period: row.period_label, actual: values.actual, forecast: values.forecast ?? null });
    }
  }

  return {
    pool,
    fundingCurve,
    investorMix,
    ticketBands,
    milestones,
    reports,
    kpiSeries: [...metrics.entries()].map(([metric, points]) => ({ metric, points })),
    distributions: all<any>(
      `SELECT period_label, gross_amount, fee_amount, net_amount, status FROM distributions
        WHERE pool_id = ? ORDER BY created_at`, [poolId])
      .map((d) => ({ period: d.period_label, gross: d.gross_amount, fee: d.fee_amount,
                     net: d.net_amount, status: d.status })),
  };
}

/** Investor-facing composition of their own portfolio. */
export function investorInsights(investorId: string) {
  return {
    bySector: all<{ sector: string; amount: number; pools: number }>(
      `SELECT p.sector, SUM(h.invested_amount) AS amount, COUNT(*) AS pools
         FROM holdings h JOIN pools p ON p.id = h.pool_id
        WHERE h.investor_id = ? GROUP BY p.sector ORDER BY amount DESC`, [investorId]),
    byStatus: all<{ status: string; amount: number; pools: number }>(
      `SELECT p.status, SUM(h.invested_amount) AS amount, COUNT(*) AS pools
         FROM holdings h JOIN pools p ON p.id = h.pool_id
        WHERE h.investor_id = ? GROUP BY p.status`, [investorId]),
    distributionTimeline: all<{ period: string; amount: number; paidAt: string | null }>(
      `SELECT d.period_label AS period, SUM(dl.net_amount) AS amount, MAX(d.paid_at) AS paidAt
         FROM distribution_lines dl JOIN distributions d ON d.id = dl.distribution_id
        WHERE dl.investor_id = ? AND d.status IN ('approved','paid')
        GROUP BY d.period_label ORDER BY d.period_label`, [investorId]),
    commitmentHistory: all<{ date: string; amount: number }>(
      `SELECT substr(created_at,1,10) AS date, SUM(amount) AS amount
         FROM investment_orders WHERE investor_id = ? AND status IN ('confirmed','allocated')
        GROUP BY date ORDER BY date`, [investorId]),
  };
}
