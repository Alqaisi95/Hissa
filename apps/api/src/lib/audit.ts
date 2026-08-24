import { all, run } from '../db/index.ts';
import { newId, nowIso } from './ids.ts';

export interface AuditInput {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ip?: string | null;
  correlationId?: string | null;
}

/**
 * FR-603 / NFR-009 — every sensitive action records who, when, what, before/after.
 * The table is append-only; SQLite triggers reject UPDATE and DELETE.
 */
export function audit(input: AuditInput): string {
  const id = newId();
  run(
    `INSERT INTO audit_events
       (id, actor_id, actor_role, action, entity_type, entity_id, before_json, after_json,
        reason, ip, correlation_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.actorId ?? null,
      input.actorRole ?? null,
      input.action,
      input.entityType,
      input.entityId,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.reason ?? null,
      input.ip ?? null,
      input.correlationId ?? null,
      nowIso(),
    ],
  );
  return id;
}

export function auditTrail(entityType: string, entityId: string) {
  return all(
    `SELECT * FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC`,
    [entityType, entityId],
  );
}
