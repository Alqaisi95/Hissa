/**
 * The four findings that made the API fail *open* rather than closed, and the
 * contracts that stop each from coming back.
 *
 * Each of these was reachable without a bug in anyone's code — a missing
 * environment variable, an unconstrained string, a status update with no
 * precondition. That is what makes them worth a test rather than a comment.
 */
import './env.ts';   // must be first — see the note in env.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { config, assertBootConfig } from '../config.ts';

test('the partner webhook secret — the app refuses to start without a real one', async (t) => {
  await t.test('a missing secret stops the boot outside development', () => {
    assert.throws(
      () => assertBootConfig({ env: 'production', webhookSecret: '' }),
      /PARTNER_WEBHOOK_SECRET is required/,
    );
    assert.throws(
      () => assertBootConfig({ env: 'test', webhookSecret: '' }),
      /PARTNER_WEBHOOK_SECRET is required/,
    );
  });

  await t.test('the old committed default is refused even when set explicitly', () => {
    // Someone reading the git history and pasting the constant back into the
    // environment would otherwise sail straight past the check above.
    assert.throws(
      () => assertBootConfig({ env: 'production', webhookSecret: 'dev-webhook-secret' }),
      /old committed default/,
    );
  });

  await t.test('development still starts, because a laptop has no partner sandbox', () => {
    assert.doesNotThrow(() => assertBootConfig({ env: 'development', webhookSecret: '' }));
  });

  await t.test('a real secret boots', () => {
    assert.doesNotThrow(() => assertBootConfig({ env: 'production', webhookSecret: 'a-real-one' }));
  });

  await t.test('config carries no fallback of its own', () => {
    // The source is the assertion here on purpose: the value is read once at
    // import, so a fallback reintroduced later would not show up in `config`
    // under a test environment that sets the variable.
    const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'config.ts'), 'utf8');
    assert.ok(
      /webhookSecret: source\.PARTNER_WEBHOOK_SECRET \?\? '',/.test(source),
      'config.ts must not give the webhook secret a literal fallback',
    );
    assert.equal(config.webhookSecret, 'test-webhook-secret');
  });
});

test('an unlabelled environment is treated as the real one', async (t) => {
  const { buildConfig } = await import('../config.ts');

  await t.test('NODE_ENV absent means production, not development', () => {
    assert.equal(buildConfig({}).env, 'production');
  });

  await t.test('the OTP echo is off unless asked for by name', () => {
    // The dangerous case: no NODE_ENV at all. This used to be `true`, so the
    // login response carried the second factor beside the token it protects.
    assert.equal(buildConfig({}).exposeOtp, false);
    assert.equal(buildConfig({ NODE_ENV: 'development' }).exposeOtp, false);
    assert.equal(buildConfig({ HISSA_DEV_OTP: '1' }).exposeOtp, false, 'production ignores the opt-in');
    assert.equal(buildConfig({ NODE_ENV: 'development', HISSA_DEV_OTP: '1' }).exposeOtp, true);
  });

  await t.test('the rate limiter cannot be switched off by an unlabelled environment', () => {
    assert.equal(buildConfig({ RATE_LIMIT_DISABLED: '1' }).rateLimitEnabled, true);
    assert.equal(buildConfig({ RATE_LIMIT_DISABLED: '1', NODE_ENV: 'production' }).rateLimitEnabled, true);
    assert.equal(buildConfig({ RATE_LIMIT_DISABLED: '1', NODE_ENV: 'test' }).rateLimitEnabled, false);
  });
});

test('verifying a contact channel is not a way back into a shut account', async (t) => {
  const { startTestServer, stopTestServer, api, makeUser } = await import('./helpers.ts');
  const { get, run } = await import('../db/index.ts');
  const { nowIso } = await import('../lib/ids.ts');

  await startTestServer();
  t.after(() => stopTestServer());

  const statusOf = (id: string) => get<{ status: string }>(`SELECT status FROM users WHERE id = ?`, [id])!.status;

  await t.test('a suspended account is refused a code at all', async () => {
    const id = makeUser({ fullName: 'موقوف', email: 'suspended@test.om', roles: ['investor'] });
    run(`UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?`, [nowIso(), id]);

    const asked = await api('POST', '/api/identity/otp/request',
      { body: { userId: id, channel: 'email', purpose: 'verify_contact' } });
    assert.equal(asked.status, 403);
    assert.equal(statusOf(id), 'suspended');
  });

  await t.test('a restricted account that still holds a code stays restricted after using it', async () => {
    // The two halves are guarded separately: a code issued before the
    // restriction lands must not become a way back either.
    const id = makeUser({ fullName: 'مقيَّد', email: 'restricted-otp@test.om', roles: ['investor'] });
    const asked = await api('POST', '/api/identity/otp/request',
      { body: { userId: id, channel: 'email', purpose: 'verify_contact' } });
    assert.equal(asked.status, 200);
    const code = get<{ id: string }>(
      `SELECT id FROM otp_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, [id])!;
    assert.ok(code);

    run(`UPDATE users SET status = 'restricted', updated_at = ? WHERE id = ?`, [nowIso(), id]);

    // Replay the code the account already had. It must verify the channel and
    // change nothing else.
    const otp = get<any>(`SELECT * FROM otp_codes WHERE id = ?`, [code.id]);
    assert.ok(otp);
    const verified = await api('POST', '/api/identity/otp/verify',
      { body: { userId: id, code: asked.body.devOtp, purpose: 'verify_contact' } });
    assert.equal(verified.status, 200);
    assert.equal(statusOf(id), 'restricted', 'the account promoted itself back to active');
    assert.ok(
      get<any>(`SELECT email_verified_at FROM users WHERE id = ?`, [id])!.email_verified_at,
      'the channel should still be recorded as proven',
    );
  });

  await t.test('an account that never finished sign-up is still promoted', async () => {
    const id = makeUser({ fullName: 'جديد', email: 'pending-otp@test.om', roles: ['investor'] });
    run(`UPDATE users SET status = 'pending_verification', updated_at = ? WHERE id = ?`, [nowIso(), id]);

    const asked = await api('POST', '/api/identity/otp/request',
      { body: { userId: id, channel: 'email', purpose: 'verify_contact' } });
    const verified = await api('POST', '/api/identity/otp/verify',
      { body: { userId: id, code: asked.body.devOtp, purpose: 'verify_contact' } });
    assert.equal(verified.status, 200);
    assert.equal(statusOf(id), 'active');
  });
});

test('an upload cannot write outside the storage directory', async (t) => {
  const { startTestServer, stopTestServer, makeUser } = await import('./helpers.ts');
  const { putObject, getObject } = await import('../lib/storage.ts');
  const { attachDocument } = await import('../lib/documents.ts');
  const { get } = await import('../db/index.ts');

  await startTestServer();
  t.after(() => stopTestServer());

  const root = path.resolve(config.storageDir);
  const escapee = path.join(path.dirname(root), 'hissa-escape-probe');

  await t.test('putObject refuses a key that climbs out', () => {
    assert.throws(() => putObject('../hissa-escape-probe', Buffer.from('x')), /escapes the storage directory/);
    assert.throws(() => putObject('application/x/../../../hissa-escape-probe', Buffer.from('x')),
      /escapes the storage directory/);
    assert.equal(fs.existsSync(escapee), false, 'a file was created outside the storage root');
  });

  await t.test('getObject refuses to read back out of it', () => {
    assert.throws(() => getObject('../../etc/hostname'), /escapes the storage directory/);
  });

  await t.test('an ordinary key still round-trips', () => {
    const stored = putObject('application/abc/doc-v1', Buffer.from('hello'));
    assert.equal(getObject(stored.key)!.toString(), 'hello');
  });

  await t.test('a hostile category never reaches the path', () => {
    // The reachable route: a project owner uploading to their own draft. The
    // category was unconstrained (z.string().min(2)) and went straight into
    // path.join, so `..` segments resolved out of the storage root.
    const uploader = makeUser({ fullName: 'مالك', email: 'traversal@test.om', roles: ['project_owner'] });
    const doc = attachDocument({
      ownerType: 'application',
      ownerId: 'app-traversal',
      category: '../../../../hissa-escape-probe',
      fileName: 'cr.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.4 test').toString('base64'),
      uploadedBy: uploader,
    });

    const row = get<{ storage_key: string }>(
      `SELECT storage_key FROM documents WHERE id = ?`, [doc.documentId])!;
    assert.ok(!row.storage_key.includes('..'), `storage key still carries the category: ${row.storage_key}`);
    assert.equal(row.storage_key, `application/app-traversal/${doc.documentId}-v1`);
    assert.equal(fs.existsSync(escapee), false, 'the upload landed outside the storage root');

    // The category is not lost — it is recorded where it belongs, on the row.
    const kept = get<{ category: string }>(`SELECT category FROM documents WHERE id = ?`, [doc.documentId])!;
    assert.equal(kept.category, '../../../../hissa-escape-probe');
  });
});

test('a second factor the user switched on is actually required', async (t) => {
  const { startTestServer, stopTestServer, api, makeUser } = await import('./helpers.ts');
  const { run } = await import('../db/index.ts');

  await startTestServer();
  t.after(() => stopTestServer());

  await t.test('an investor with MFA enabled cannot act on the token alone', async () => {
    const id = makeUser({
      fullName: 'مستثمر بعامل ثانٍ', email: 'mfa-investor@test.om', roles: ['investor'],
      investor: { classification: 'retail' },
    });
    run(`UPDATE users SET mfa_enabled = 1 WHERE id = ?`, [id]);

    const signedIn = await api('POST', '/api/identity/login',
      { body: { identifier: 'mfa-investor@test.om', password: 'TestPassword#2026' } });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.body.mfaRequired, true);

    // The token is real and the session exists — the question is whether the
    // server honours the flag it just set.
    const beforeMfa = await api('GET', '/api/portfolio', { token: signedIn.body.token });
    assert.equal(beforeMfa.status, 403, 'the token worked without the second factor');

    const cleared = await api('POST', '/api/identity/mfa/verify',
      { token: signedIn.body.token, body: { code: signedIn.body.devOtp } });
    assert.equal(cleared.status, 200);

    const afterMfa = await api('GET', '/api/portfolio', { token: signedIn.body.token });
    assert.equal(afterMfa.status, 200);
  });

  await t.test('an investor without it is unaffected', async () => {
    makeUser({
      fullName: 'مستثمر عادي', email: 'plain-investor@test.om', roles: ['investor'],
      investor: { classification: 'retail' },
    });
    const signedIn = await api('POST', '/api/identity/login',
      { body: { identifier: 'plain-investor@test.om', password: 'TestPassword#2026' } });
    assert.equal(signedIn.body.mfaRequired, false);
    const straight = await api('GET', '/api/portfolio', { token: signedIn.body.token });
    assert.equal(straight.status, 200);
  });
});

test('reading across customers costs a second factor, whatever the role', async (t) => {
  const { ROLES, ROLE_PERMISSIONS, MFA_REQUIRED_ROLES } = await import('../lib/rbac.ts');

  await t.test('every role that can read another customer is on the list', () => {
    // Stated as the rule rather than the list: `auditor` was missing, and it
    // holds order.read_any, case.read_any and the entire audit trail. A list
    // is something to forget; a rule catches the next role that is added.
    const readsAcrossCustomers = (role: string) =>
      (ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] ?? [])
        .some((p: string) => p.endsWith('.read_any') || p === 'audit.read');

    const missing = ROLES.filter((r) => readsAcrossCustomers(r) && !MFA_REQUIRED_ROLES.includes(r));
    assert.deepEqual(missing, [], `these roles read across customers with one factor: ${missing.join(', ')}`);
  });

  await t.test('and an investor still is not asked for one', () => {
    assert.ok(!MFA_REQUIRED_ROLES.includes('investor'));
    assert.ok(!MFA_REQUIRED_ROLES.includes('project_owner'));
  });
});

test('a read-only role cannot set money in motion', async (t) => {
  const { startTestServer, stopTestServer, api, makeUser, login } = await import('./helpers.ts');
  const { ROLE_PERMISSIONS } = await import('../lib/rbac.ts');

  await startTestServer();
  t.after(() => stopTestServer());

  await t.test('the job runner is not reachable with audit.read', async () => {
    makeUser({ fullName: 'مدقّق', email: 'auditor-jobs@test.om', roles: ['auditor'] });
    const token = await login('auditor-jobs@test.om');

    // pools.sweep_closings moves pools to refunding, inserts refund rows and
    // cancels pending orders. The auditor is defined as read-only.
    const ran = await api('POST', '/api/admin/jobs/pools.sweep_closings/run', { token });
    assert.equal(ran.status, 403);
  });

  await t.test('system_admin still can', async () => {
    makeUser({ fullName: 'مدير نظام', email: 'sysadmin-jobs@test.om', roles: ['system_admin'] });
    const token = await login('sysadmin-jobs@test.om');
    const ran = await api('POST', '/api/admin/jobs/notifications.dispatch/run', { token });
    assert.equal(ran.status, 200);
  });

  await t.test('and no role that cannot approve money holds the permission', () => {
    const holders = Object.entries(ROLE_PERMISSIONS)
      .filter(([, perms]) => (perms as string[]).includes('ops.run_jobs'))
      .map(([role]) => role);
    assert.deepEqual(holders, ['system_admin']);
  });
});

test('the way to pay survives a refresh', async (t) => {
  const {
    startTestServer, stopTestServer, api, makeUser, login, makePool, ACKS, partnerWebhook,
  } = await import('./helpers.ts');
  const { omr } = await import('../lib/money.ts');

  await startTestServer();
  t.after(() => stopTestServer());

  const staff = makeUser({ fullName: 'محفظة', email: 'pf-pay@test.om', roles: ['portfolio_ops'] });
  const owner = makeUser({ fullName: 'مالك', email: 'owner-pay@test.om', roles: ['project_owner'] });
  makeUser({
    fullName: 'مستثمر', email: 'investor-pay@test.om', roles: ['investor'],
    investor: { classification: 'retail' },
  });
  const token = await login('investor-pay@test.om');
  const { poolId, disclosureId } = makePool({ createdBy: staff, ownerUserId: owner });

  const created = await api('POST', '/api/orders', {
    token, body: { poolId, amount: omr(200), disclosureVersionId: disclosureId, acknowledgements: ACKS },
  });
  assert.equal(created.status, 201);
  const orderId = created.body.orderId;

  await t.test('GET /orders/:id carries the checkout link while payment is pending', async () => {
    // The only thing a fresh page load has. Before this, the link existed
    // solely in the router state of the redirect that created the order, so a
    // refresh left the investor told to pay with nothing to press.
    const fetched = await api('GET', `/api/orders/${orderId}`, { token });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.payment.providerRef, created.body.payment.providerRef);
    assert.equal(fetched.body.payment.redirectUrl, created.body.payment.redirectUrl);
    assert.ok(fetched.body.payment.redirectUrl.includes(created.body.payment.providerRef));
  });

  await t.test('and withholds it once the money has moved', async () => {
    await partnerWebhook({
      id: `evt-pay-${orderId}`, type: 'payment.settled',
      providerRef: created.body.payment.providerRef, amount: omr(200),
    });
    const fetched = await api('GET', `/api/orders/${orderId}`, { token });
    assert.equal(fetched.body.payment.status, 'settled');
    assert.equal(fetched.body.payment.redirectUrl, null, 'offered a way to pay something already paid');
  });
});
