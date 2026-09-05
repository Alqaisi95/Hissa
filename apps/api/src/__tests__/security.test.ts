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
