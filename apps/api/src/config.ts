// Runtime configuration. Secrets come from the environment only (NFR-006).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  dbFile: process.env.HISSA_DB ?? path.join(here, '..', 'data', 'hissa.sqlite'),
  storageDir: process.env.HISSA_STORAGE ?? path.join(here, '..', 'data', 'objects'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 10),
  otpMaxAttempts: 5,
  webhookSecret: process.env.PARTNER_WEBHOOK_SECRET ?? 'dev-webhook-secret',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  timezone: 'Asia/Muscat',
  // Dev convenience only: echo OTP codes in API responses so the pilot team can
  // exercise the journey without a live SMS/Email provider. Never true in prod.
  exposeOtp: process.env.NODE_ENV !== 'production',
  // Automated suites drive many accounts from one address; the limiter itself is
  // covered directly in the unit tests. Never disabled outside a test run.
  rateLimitEnabled: !(process.env.RATE_LIMIT_DISABLED === '1' && process.env.NODE_ENV !== 'production'),
} as const;
