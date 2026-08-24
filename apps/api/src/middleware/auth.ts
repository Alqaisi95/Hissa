import type { NextFunction, Request, Response } from 'express';
import { all, get, run } from '../db/index.ts';
import { sha256 } from '../lib/crypto.ts';
import { nowIso } from '../lib/ids.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';
import { hasPermission, requiresMfa, type Permission } from '../lib/rbac.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        roles: string[];
        mfaPassed: boolean;
        locale: 'ar' | 'en';
        status: string;
      };
      correlationId?: string;
    }
  }
}

function readToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return (req as any).cookies?.hissa_session ?? null;
}

/** Attaches the session if one is present. Does not enforce — see requireAuth. */
export function loadSession(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (!token) return next();

  const session = get<any>(
    `SELECT s.*, u.status AS user_status, u.locale
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    [sha256(token), nowIso()],
  );
  if (!session) return next();

  const roles = all<{ role: string }>(`SELECT role FROM user_roles WHERE user_id = ?`, [session.user_id])
    .map((r) => r.role);

  req.auth = {
    userId: session.user_id,
    sessionId: session.id,
    roles,
    mfaPassed: session.mfa_passed === 1,
    locale: session.locale,
    status: session.user_status,
  };
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());
  if (req.auth.status === 'suspended' || req.auth.status === 'closed') {
    return next(forbidden('الحساب موقوف. تواصل مع الدعم.', 'Account suspended. Please contact support.'));
  }
  // FR-007 — privileged roles must clear MFA on the session before acting.
  if (requiresMfa(req.auth.roles) && !req.auth.mfaPassed) {
    return next(forbidden('يلزم إكمال التحقق بخطوتين لهذه الجلسة.', 'This session requires multi-factor verification.'));
  }
  next();
}

/**
 * AT-07 — an unauthorised call returns 403 and logs the attempt without
 * disclosing the protected data or the rule that blocked it.
 */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorized());
    if (!hasPermission(req.auth.roles, permission)) {
      run(
        `INSERT INTO audit_events (id, actor_id, actor_role, action, entity_type, entity_id, reason, ip, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, 'access.denied', 'permission', ?, ?, ?, ?)`,
        [req.auth.userId, req.auth.roles.join(','), permission, `${req.method} ${req.path}`, req.ip ?? null, nowIso()],
      );
      return next(forbidden());
    }
    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorized());
    if (!req.auth.roles.some((r) => roles.includes(r))) return next(forbidden());
    next();
  };
}
