/**
 * Test environment. This module exists so the settings land *before* any other
 * module is evaluated: ESM hoists imports, so assigning process.env inside
 * helpers.ts would run after `config.ts` had already read it.
 */
process.env.HISSA_DB = ':memory:';
process.env.HISSA_STORAGE = '/tmp/hissa-test-objects';
process.env.NODE_ENV = 'test';
process.env.PARTNER_WEBHOOK_SECRET = 'test-webhook-secret';
// Suites drive dozens of accounts from one address; rateLimit() is unit-tested directly.
process.env.RATE_LIMIT_DISABLED = '1';
