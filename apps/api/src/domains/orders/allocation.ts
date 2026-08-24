/**
 * FR-306 / BR-017 — deterministic, explainable allocation when a pool is
 * oversubscribed. The rule is declared in the disclosure before publication
 * (OD-10), and the result is reproducible for audit and review.
 */
import { proRata, type Baisa } from '../../lib/money.ts';

export interface AllocatableOrder {
  id: string;
  reference: string;
  investor_id: string;
  amount: Baisa;
  created_at: string;
}

export interface AllocationLine {
  orderId: string;
  reference: string;
  investorId: string;
  requested: Baisa;
  allocated: Baisa;
  refund: Baisa;
  units: number;
}

export interface AllocationResult {
  rule: 'pro_rata' | 'first_confirmed';
  target: Baisa;
  ceiling: Baisa;
  requestedTotal: Baisa;
  allocatedTotal: Baisa;
  refundTotal: Baisa;
  oversubscribed: boolean;
  lines: AllocationLine[];
}

export function allocate(
  pool: { target_amount: Baisa; max_amount: Baisa | null; unit_price: Baisa; allocation_rule: string; min_ticket: Baisa },
  orders: AllocatableOrder[],
): AllocationResult {
  const ceiling = pool.max_amount ?? pool.target_amount;
  const requestedTotal = orders.reduce((sum, o) => sum + o.amount, 0);
  const rule = (pool.allocation_rule as AllocationResult['rule']) ?? 'pro_rata';

  // Not oversubscribed: everyone is allocated in full.
  if (requestedTotal <= ceiling) {
    const lines = orders.map((o) => ({
      orderId: o.id, reference: o.reference, investorId: o.investor_id,
      requested: o.amount, allocated: o.amount, refund: 0,
      units: Math.floor(o.amount / pool.unit_price),
    }));
    return { rule, target: pool.target_amount, ceiling, requestedTotal,
             allocatedTotal: requestedTotal, refundTotal: 0, oversubscribed: false, lines };
  }

  let allocations: Baisa[];

  if (rule === 'first_confirmed') {
    // Earliest confirmed commitments fill the pool; the rest are refunded in full.
    let remaining = ceiling;
    allocations = orders.map((order) => {
      if (remaining <= 0) return 0;
      // A partial fill below the minimum ticket is refunded rather than issued.
      const take = Math.min(order.amount, remaining);
      const granted = take < pool.min_ticket ? 0 : take;
      remaining -= granted;
      return granted;
    });
  } else {
    // Pro-rata by requested amount, with the largest-remainder method so the
    // allocated total ties exactly to the ceiling — no rounding drift.
    allocations = proRata(ceiling, orders.map((o) => o.amount));

    // Anything scaled below the minimum ticket is refunded, and the freed amount
    // is redistributed among the remaining orders. Repeats until stable.
    for (let pass = 0; pass < orders.length; pass += 1) {
      const belowMin = allocations
        .map((amount, index) => ({ amount, index }))
        .filter((a) => a.amount > 0 && a.amount < pool.min_ticket);
      if (belowMin.length === 0) break;

      for (const entry of belowMin) allocations[entry.index] = 0;
      const eligible = allocations.map((a, i) => (a > 0 ? orders[i].amount : 0));
      if (eligible.every((w) => w === 0)) break;
      allocations = proRata(ceiling, eligible);
    }
  }

  const lines = orders.map((order, index) => {
    const allocated = Math.min(allocations[index], order.amount);
    return {
      orderId: order.id, reference: order.reference, investorId: order.investor_id,
      requested: order.amount, allocated, refund: order.amount - allocated,
      units: Math.floor(allocated / pool.unit_price),
    };
  });

  const allocatedTotal = lines.reduce((sum, l) => sum + l.allocated, 0);
  return {
    rule, target: pool.target_amount, ceiling, requestedTotal, allocatedTotal,
    refundTotal: requestedTotal - allocatedTotal, oversubscribed: true, lines,
  };
}
