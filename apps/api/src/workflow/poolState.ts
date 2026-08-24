/**
 * PRD §5 — Pool lifecycle. Every transition needs a reason, an authorised actor,
 * a timestamp and a copy of the related inputs. Reverse moves are never deleted:
 * they are recorded as new events.
 */
import { get, run } from '../db/index.ts';
import { newId, nowIso } from '../lib/ids.ts';
import { audit } from '../lib/audit.ts';
import { conflict } from '../lib/errors.ts';
import type { Permission } from '../lib/rbac.ts';

export type PoolState =
  | 'draft' | 'approved' | 'funding' | 'paused' | 'funded' | 'refunding'
  | 'disbursement' | 'operating' | 'default' | 'workout' | 'closed' | 'cancelled' | 'expired';

interface TransitionRule {
  to: PoolState[];
  /** Permission the actor needs to move the pool out of this state. */
  owner: Permission;
}

export const POOL_TRANSITIONS: Record<PoolState, TransitionRule> = {
  draft:        { to: ['approved', 'cancelled'],                      owner: 'pool.build' },
  approved:     { to: ['funding', 'expired', 'cancelled'],            owner: 'pool.publish' },
  funding:      { to: ['funded', 'paused', 'expired', 'cancelled', 'refunding'], owner: 'pool.publish' },
  paused:       { to: ['funding', 'cancelled', 'refunding'],          owner: 'pool.pause' },
  funded:       { to: ['disbursement', 'refunding'],                  owner: 'funds.approve' },
  refunding:    { to: ['cancelled', 'closed'],                        owner: 'funds.approve' },
  disbursement: { to: ['operating', 'workout'],                       owner: 'funds.approve' },
  operating:    { to: ['closed', 'default', 'workout'],               owner: 'pool.monitor' },
  default:      { to: ['workout', 'closed'],                          owner: 'pool.monitor' },
  workout:      { to: ['operating', 'closed', 'default'],             owner: 'pool.monitor' },
  closed:       { to: [],                                             owner: 'pool.monitor' },  // read-only terminal
  cancelled:    { to: [],                                             owner: 'pool.monitor' },
  expired:      { to: ['refunding', 'cancelled'],                     owner: 'funds.approve' },
};

export const canTransition = (from: PoolState, to: PoolState): boolean =>
  POOL_TRANSITIONS[from]?.to.includes(to) ?? false;

export const requiredPermission = (from: PoolState): Permission => POOL_TRANSITIONS[from].owner;

export interface TransitionInput {
  poolId: string;
  to: PoolState;
  reason: string;
  actorId: string;
  actorRole?: string;
  payload?: Record<string, unknown>;
}

/** Applies the transition and writes both a state event and an audit record. */
export function transition(input: TransitionInput): void {
  const pool = get<{ status: PoolState }>(`SELECT status FROM pools WHERE id = ?`, [input.poolId]);
  if (!pool) throw conflict('pool_not_found', 'الفرصة غير موجودة', 'Pool not found');

  const from = pool.status;
  if (!canTransition(from, input.to)) {
    throw conflict(
      'invalid_transition',
      `لا يمكن نقل الفرصة من ${from} إلى ${input.to}`,
      `Cannot move pool from ${from} to ${input.to}`,
      { from, to: input.to, allowed: POOL_TRANSITIONS[from].to },
    );
  }
  if (!input.reason?.trim()) {
    throw conflict('reason_required', 'يلزم ذكر سبب الانتقال', 'A transition reason is required');
  }

  const at = nowIso();
  const timestampColumn: Partial<Record<PoolState, string>> = {
    funding: 'published_at', funded: 'funded_at', closed: 'closed_at', cancelled: 'closed_at',
  };
  const column = timestampColumn[input.to];

  run(
    `UPDATE pools SET status = ?, updated_at = ?${column ? `, ${column} = COALESCE(${column}, ?)` : ''} WHERE id = ?`,
    column ? [input.to, at, at, input.poolId] : [input.to, at, input.poolId],
  );
  run(
    `INSERT INTO pool_state_events (id, pool_id, from_state, to_state, reason, payload, actor_id, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [newId(), input.poolId, from, input.to, input.reason, JSON.stringify(input.payload ?? {}), input.actorId, at],
  );
  audit({
    actorId: input.actorId, actorRole: input.actorRole, action: `pool.transition.${input.to}`,
    entityType: 'pool', entityId: input.poolId,
    before: { status: from }, after: { status: input.to }, reason: input.reason,
  });
}
