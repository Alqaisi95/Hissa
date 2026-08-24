/**
 * FR-402 — daily reconciliation between internal commitments and the partner /
 * bank statement. Differences surface in a queue with an SLA and are never
 * auto-closed without a rule.
 */
import { all, get, run } from '../../db/index.ts';
import { newId, nowIso, plus, hours } from '../../lib/ids.ts';
import { audit } from '../../lib/audit.ts';
import { slas } from '../../lib/settings.ts';

export interface ExternalLine {
  providerRef: string;
  amount: number;
  status: 'settled' | 'failed' | 'pending' | 'reversed';
}

export interface ReconciliationSummary {
  runId: string;
  runDate: string;
  matched: number;
  breaks: { type: string; providerRef: string | null; orderId: string | null }[];
}

export function runReconciliation(scope: string, externalLines: ExternalLine[], actorId?: string): ReconciliationSummary {
  const runId = newId();
  const at = nowIso();
  const slaHours = slas().reconciliationBreakHours;

  run(`INSERT INTO reconciliation_runs (id, run_date, scope, status, created_at) VALUES (?,?,?, 'running', ?)`,
      [runId, at.slice(0, 10), scope, at]);

  const internal = all<any>(
    `SELECT pr.id, pr.provider_ref, pr.amount, pr.status, pr.order_id
       FROM payment_references pr WHERE pr.direction = 'collection'`,
  );
  const byRef = new Map(internal.map((row) => [row.provider_ref, row]));
  const externalByRef = new Map(externalLines.map((line) => [line.providerRef, line]));

  const breaks: ReconciliationSummary['breaks'] = [];
  let matched = 0;

  const raiseBreak = (type: string, providerRef: string | null, orderId: string | null,
                      internalAmount: number | null, externalAmount: number | null) => {
    run(
      `INSERT INTO reconciliation_breaks
         (id, run_id, order_id, provider_ref, break_type, internal_amount, external_amount, status, sla_due_at, created_at)
       VALUES (?,?,?,?,?,?,?, 'open', ?, ?)`,
      [newId(), runId, orderId, providerRef, type, internalAmount, externalAmount, plus(at, hours(slaHours)), at],
    );
    breaks.push({ type, providerRef, orderId });
  };

  for (const line of externalLines) {
    const internalRow = byRef.get(line.providerRef);
    if (!internalRow) {
      // Money at the partner with no internal record — never ignore.
      raiseBreak('missing_internal', line.providerRef, null, null, line.amount);
      continue;
    }
    if (internalRow.amount !== line.amount) {
      raiseBreak('amount_mismatch', line.providerRef, internalRow.order_id, internalRow.amount, line.amount);
      continue;
    }
    const statusAligned =
      (line.status === 'settled' && internalRow.status === 'settled') ||
      (line.status === 'failed' && internalRow.status === 'failed') ||
      (line.status === 'pending' && ['initiated', 'pending'].includes(internalRow.status));

    if (!statusAligned) {
      raiseBreak('status_mismatch', line.providerRef, internalRow.order_id, internalRow.amount, line.amount);
      continue;
    }
    matched += 1;
  }

  // Internal records the partner did not report at all.
  for (const row of internal) {
    if (!externalByRef.has(row.provider_ref) && row.status === 'settled') {
      raiseBreak('missing_external', row.provider_ref, row.order_id, row.amount, null);
    }
  }

  run(`UPDATE reconciliation_runs SET matched = ?, breaks = ?, status = 'completed' WHERE id = ?`,
      [matched, breaks.length, runId]);

  // A break becomes an operations case so it is worked, not just listed.
  for (const item of breaks) {
    run(`INSERT INTO cases (id, reference, type, subject, body, severity, status, related_type, related_id,
                            sla_due_at, created_at, updated_at)
         VALUES (?,?, 'recon_break', ?, ?, 'high', 'open', 'payment_reference', ?, ?, ?, ?)`,
        [newId(), `CASE-REC-${runId.slice(0, 8)}-${item.providerRef ?? 'na'}`,
         `فرق مطابقة — ${item.type}`, JSON.stringify(item), item.providerRef ?? runId,
         plus(at, hours(slaHours)), at, at]);
  }

  audit({ actorId: actorId ?? null, action: 'reconciliation.run', entityType: 'reconciliation_run', entityId: runId,
          after: { scope, matched, breaks: breaks.length } });

  return { runId, runDate: at.slice(0, 10), matched, breaks };
}

export function openBreaks() {
  return all<any>(
    `SELECT b.*, o.reference AS order_reference
       FROM reconciliation_breaks b LEFT JOIN investment_orders o ON o.id = b.order_id
      WHERE b.status <> 'resolved' ORDER BY b.sla_due_at ASC`,
  );
}

export function resolveBreak(breakId: string, resolution: string, actorId: string): void {
  const row = get<any>(`SELECT * FROM reconciliation_breaks WHERE id = ?`, [breakId]);
  if (!row) throw new Error('break_not_found');

  run(`UPDATE reconciliation_breaks SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`,
      [resolution, actorId, nowIso(), breakId]);
  audit({ actorId, action: 'reconciliation.break_resolved', entityType: 'reconciliation_break', entityId: breakId,
          before: { status: row.status }, after: { status: 'resolved' }, reason: resolution });
}
