/** Shared test harness: an in-memory database plus a supertest-free HTTP client. */
import './env.ts';   // must be first — see the note in env.ts

import type { Server } from 'node:http';
import { createApp } from '../app.ts';
import { run, get } from '../db/index.ts';
import { newId, nowIso, plus, days } from '../lib/ids.ts';
import { hashPassword, contentHash, signPayload } from '../lib/crypto.ts';
import { omr } from '../lib/money.ts';
import { LEGAL_DOCUMENTS } from '../lib/legal.ts';
import { installTemplates } from '../lib/notificationTemplates.ts';
import { config } from '../config.ts';

let server: Server | null = null;
let baseUrl = '';

export async function startTestServer(): Promise<string> {
  if (baseUrl) return baseUrl;
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server!.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null; baseUrl = '';
}

export interface ApiResponse<T = any> { status: number; body: T }

export async function api<T = any>(
  method: string, path: string, options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

export async function partnerWebhook(event: Record<string, unknown>): Promise<ApiResponse> {
  const raw = JSON.stringify(event);
  const response = await fetch(`${baseUrl}/api/webhooks/partner`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hissa-signature': signPayload(raw, config.webhookSecret) },
    body: raw,
  });
  return { status: response.status, body: JSON.parse(await response.text()) };
}

const PASSWORD = 'TestPassword#2026';

export function makeUser(params: {
  fullName: string; email: string; roles: string[];
  investor?: { classification?: 'retail' | 'angel' | 'sophisticated'; kyc?: string; consents?: boolean };
}): string {
  // Idempotent: node:test may run the root `before` hook once per suite.
  const existing = get<{ id: string }>(`SELECT id FROM users WHERE email = ?`, [params.email]);
  if (existing) return existing.id;

  const { hash, salt } = hashPassword(PASSWORD);
  const id = newId();
  const at = nowIso();
  run(`INSERT INTO users (id, email, full_name, password_hash, password_salt, locale, status, email_verified_at, created_at, updated_at)
       VALUES (?,?,?,?,?, 'ar', 'active', ?, ?, ?)`, [id, params.email, params.fullName, hash, salt, at, at, at]);
  for (const role of params.roles) {
    run(`INSERT INTO user_roles (user_id, role, granted_at) VALUES (?,?,?)`, [id, role, at]);
  }
  if (params.investor) {
    run(`INSERT INTO investor_profiles (id, user_id, classification, suitability_score, suitability_result,
                                        suitability_taken_at, kyc_status, kyc_approved_at, kyc_expires_at, created_at, updated_at)
         VALUES (?,?,?,100,'pass',?,?,?,?,?,?)`,
        [newId(), id, params.investor.classification ?? 'retail', at, params.investor.kyc ?? 'approved',
         at, plus(at, days(365)), at, at]);
    if (params.investor.consents !== false) {
      for (const key of ['terms', 'risk_disclosure', 'privacy']) {
        const doc = LEGAL_DOCUMENTS.find((d) => d.key === key)!;
        run(`INSERT INTO consents (id, user_id, document_key, version, content_hash, accepted_at) VALUES (?,?,?,?,?,?)`,
            [newId(), id, key, doc.version, contentHash(doc.bodyAr), at]);
      }
    }
  }
  return id;
}

/** Signs a user in and clears MFA where the role requires it. */
export async function login(email: string): Promise<string> {
  const response = await api('POST', '/api/identity/login', { body: { identifier: email, password: PASSWORD } });
  if (response.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(response.body)}`);
  const { token, mfaRequired, devOtp } = response.body;
  if (mfaRequired) {
    const verified = await api('POST', '/api/identity/mfa/verify', { token, body: { code: devOtp } });
    if (verified.status !== 200) throw new Error(`mfa failed: ${JSON.stringify(verified.body)}`);
  }
  return token;
}

/** Creates a funding-stage pool with an entity, application and published disclosure. */
export function makePool(options: {
  target?: number; minAmount?: number; maxAmount?: number; minTicket?: number;
  allocationRule?: 'pro_rata' | 'first_confirmed'; createdBy: string; ownerUserId: string;
  closesInDays?: number; crNumber?: string;
} ): { poolId: string; entityId: string; disclosureId: string; applicationId: string } {
  const at = nowIso();
  const entityId = newId();
  run(`INSERT INTO legal_entities (id, legal_name, cr_number, activity, incorporated_on, kyb_status, created_by, created_at, updated_at)
       VALUES (?,?,?, 'تجزئة', '2020-01-01', 'approved', ?, ?, ?)`,
      [entityId, `كيان اختبار ${entityId.slice(0, 6)}`, options.crNumber ?? entityId.slice(0, 7), options.createdBy, at, at]);
  run(`INSERT INTO entity_people (id, entity_id, user_id, full_name, role, created_at)
       VALUES (?,?,?, 'ممثل مفوض', 'authorised_rep', ?)`, [newId(), entityId, options.ownerUserId, at]);

  const target = options.target ?? omr(50_000);
  const applicationId = newId();
  run(`INSERT INTO project_applications (id, reference, entity_id, owner_user_id, title_ar, sector,
                                         requested_amount, owner_contribution, tenor_months, use_of_funds, status, created_at, updated_at)
       VALUES (?,?,?,?, 'مشروع اختبار', 'تجزئة', ?, ?, 24, '[]', 'approved', ?, ?)`,
      [applicationId, `APP-T-${applicationId.slice(0, 6)}`, entityId, options.ownerUserId, target,
       Math.round(target * 0.25), at, at]);

  const poolId = newId();
  const unitPrice = omr(100);
  run(`INSERT INTO pools (id, reference, application_id, entity_id, title_ar, sector, total_units, unit_price,
                          target_amount, min_amount, max_amount, min_ticket, owner_contribution,
                          owner_contribution_received_at, tenor_months, allocation_rule, status, published_at,
                          closes_at, escrow_account_ref, created_by, created_at, updated_at)
       VALUES (?,?,?,?, 'فرصة اختبار', 'تجزئة', ?, ?, ?, ?, ?, ?, ?, ?, 24, ?, 'funding', ?, ?, ?, ?, ?, ?)`,
      [poolId, `POOL-T-${poolId.slice(0, 6)}`, applicationId, entityId, target / unitPrice, unitPrice,
       target, options.minAmount ?? Math.round(target * 0.8), options.maxAmount ?? target,
       options.minTicket ?? omr(100), Math.round(target * 0.25), at,
       options.allocationRule ?? 'pro_rata', at, plus(at, days(options.closesInDays ?? 20)),
       `ESCROW-T-${poolId.slice(0, 6)}`, options.createdBy, at, at]);

  const disclosureId = newId();
  const sections = { summary: {}, risks: {}, seeded: true };
  run(`INSERT INTO disclosure_versions (id, pool_id, version, sections, content_hash, status, created_by, published_at, created_at)
       VALUES (?,?,1,?,?, 'published', ?, ?, ?)`,
      [disclosureId, poolId, JSON.stringify(sections), contentHash(sections), options.createdBy, at, at]);

  return { poolId, entityId, disclosureId, applicationId };
}

export const ACKS = ['capital_loss', 'no_guarantee', 'illiquidity', 'disclosure_read', 'projections'];

/** Places an order and settles it through the partner webhook. */
export async function investAndConfirm(token: string, poolId: string, disclosureId: string, amount: number) {
  const order = await api('POST', '/api/orders', {
    token, body: { poolId, amount, disclosureVersionId: disclosureId, acknowledgements: ACKS },
  });
  if (order.status !== 201) throw new Error(`order failed: ${JSON.stringify(order.body)}`);

  await partnerWebhook({
    id: `evt-${order.body.orderId}`, type: 'payment.settled',
    providerRef: order.body.payment.providerRef, amount,
  });
  return order.body;
}

/** Installs the reviewed notification catalogue so delivery paths are exercised. */
export function installNotificationTemplates(approverId: string): void {
  installTemplates(approverId);
}
