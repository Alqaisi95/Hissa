/**
 * FR-403 / BR-008 — All-or-Nothing closing. When the window ends or the target
 * is reached, the pool either funds (allocations applied) or fails (refund
 * orders created for every confirmed commitment). Money is never disbursed to
 * the project on a failed close.
 */
import { all, get, run, tx } from '../../db/index.ts';
import { newId, nowIso } from '../../lib/ids.ts';
import { audit } from '../../lib/audit.ts';
import { transition } from '../../workflow/poolState.ts';
import { allocate, type AllocatableOrder } from '../orders/allocation.ts';
import { committedToPool } from '../orders/eligibility.ts';
import { notify } from '../../integrations/notifications.ts';
import { track } from '../analytics/track.ts';

export interface CloseResult {
  poolId: string;
  outcome: 'funded' | 'refunding';
  confirmedTotal: number;
  allocatedTotal: number;
  refundTotal: number;
  refundOrders: number;
  allocation?: ReturnType<typeof allocate>;
}

/**
 * Closes one pool. `actorId` is the operator approving the close, or the
 * scheduler for the automatic date-driven run.
 */
export function closePool(poolId: string, actorId: string, reason: string): CloseResult {
  const pool = get<any>(`SELECT * FROM pools WHERE id = ?`, [poolId]);
  if (!pool) throw new Error('pool_not_found');
  if (!['funding', 'paused', 'expired'].includes(pool.status)) throw new Error('pool_not_closable');

  const confirmed = all<AllocatableOrder>(
    `SELECT id, reference, investor_id, amount, created_at FROM investment_orders
      WHERE pool_id = ? AND status = 'confirmed' ORDER BY created_at ASC, reference ASC`, [poolId],
  );
  const confirmedTotal = confirmed.reduce((sum, o) => sum + o.amount, 0);
  const at = nowIso();

  // AT-03 — target not met: no disbursement, refunds for every confirmed commitment.
  if (confirmedTotal < pool.min_amount) {
    return tx(() => {
      transition({ poolId, to: 'refunding', reason: `${reason} — minimum not reached`, actorId,
                   payload: { confirmedTotal, minAmount: pool.min_amount } });

      for (const order of confirmed) {
        run(`INSERT INTO refunds (id, pool_id, order_id, amount, reason, status, created_by, created_at)
             VALUES (?,?,?,?, 'all-or-nothing: funding target not reached', 'requested', ?, ?)`,
            [newId(), poolId, order.id, order.amount, actorId, at]);
        notify({ userId: order.investor_id, templateCode: 'pool_failed_refund',
                 variables: { poolTitle: pool.title_ar, amount: order.amount / 1000 } });
      }
      // Pending commitments never settled — they are cancelled, not refunded.
      run(`UPDATE investment_orders SET status = 'cancelled', cancelled_at = ?, updated_at = ?
            WHERE pool_id = ? AND status = 'pending'`, [at, at, poolId]);

      audit({ actorId, action: 'pool.close_failed', entityType: 'pool', entityId: poolId,
              after: { confirmedTotal, minAmount: pool.min_amount, refunds: confirmed.length }, reason });
      track('pool_closed', null, { outcome: 'refunding', confirmedTotal }, poolId);

      return { poolId, outcome: 'refunding' as const, confirmedTotal, allocatedTotal: 0,
               refundTotal: confirmedTotal, refundOrders: confirmed.length };
    });
  }

  // Target met — apply the declared allocation rule (FR-306).
  const allocation = allocate(pool, confirmed);

  return tx(() => {
    for (const line of allocation.lines) {
      run(`UPDATE investment_orders SET status = 'allocated', allocated_amount = ?, units = ?, updated_at = ? WHERE id = ?`,
          [line.allocated, line.units, at, line.orderId]);

      if (line.allocated > 0) {
        // FR-505 — holdings are nominal; no market value is implied.
        run(`INSERT INTO holdings (id, pool_id, investor_id, units, invested_amount, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?)
             ON CONFLICT(pool_id, investor_id) DO UPDATE SET
               units = units + excluded.units,
               invested_amount = invested_amount + excluded.invested_amount,
               updated_at = excluded.updated_at`,
            [newId(), poolId, line.investorId, line.units, line.allocated, at, at]);
      }
      // BR-017 — the unallocated remainder of an oversubscribed pool is refunded.
      if (line.refund > 0) {
        run(`INSERT INTO refunds (id, pool_id, order_id, amount, reason, status, created_by, created_at)
             VALUES (?,?,?,?, 'oversubscription allocation remainder', 'requested', ?, ?)`,
            [newId(), poolId, line.orderId, line.refund, actorId, at]);
      }
      notify({ userId: line.investorId, templateCode: 'pool_funded',
               variables: { poolTitle: pool.title_ar, allocated: line.allocated / 1000, refund: line.refund / 1000 } });
    }
    run(`UPDATE investment_orders SET status = 'cancelled', cancelled_at = ?, updated_at = ?
          WHERE pool_id = ? AND status = 'pending'`, [at, at, poolId]);

    transition({ poolId, to: 'funded', reason, actorId,
                 payload: { allocatedTotal: allocation.allocatedTotal, rule: allocation.rule } });

    audit({ actorId, action: 'pool.funded', entityType: 'pool', entityId: poolId,
            after: { allocatedTotal: allocation.allocatedTotal, refundTotal: allocation.refundTotal,
                     rule: allocation.rule, investors: allocation.lines.filter((l) => l.allocated > 0).length },
            reason });
    track('pool_closed', null, { outcome: 'funded', allocatedTotal: allocation.allocatedTotal }, poolId);

    return {
      poolId, outcome: 'funded' as const, confirmedTotal,
      allocatedTotal: allocation.allocatedTotal, refundTotal: allocation.refundTotal,
      refundOrders: allocation.lines.filter((l) => l.refund > 0).length, allocation,
    };
  });
}

/** Pools whose window has ended or whose target is reached, awaiting a close decision. */
export function poolsDueForClosing(at: string = nowIso()) {
  return all<any>(
    `SELECT p.id, p.reference, p.title_ar, p.status, p.target_amount, p.min_amount, p.closes_at
       FROM pools p WHERE p.status IN ('funding','paused') AND p.closes_at <= ?`, [at],
  ).map((pool) => ({ ...pool, committed: committedToPool(pool.id) }));
}
