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
