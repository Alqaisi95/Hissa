// Runtime configuration. Secrets come from the environment only (NFR-006).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every switch below reads the environment once, through this function, so the
 * defaults can be tested rather than trusted.
 *
 * `env` defaults to 'production'. It used to default to 'development', which
 * meant a container started without NODE_ENV — the ordinary case, not an
 * exotic one — silently took the developer settings: OTP codes echoed in the
 * login response, `Secure` dropped from the session cookie, HSTS off. The
 * safest guess about an unlabelled environment is that it is the real one.
 */
export function buildConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = source.NODE_ENV ?? 'production';
  return {
    env,
    port: Number(source.PORT ?? 4000),
    dbFile: source.HISSA_DB ?? path.join(here, '..', 'data', 'hissa.sqlite'),
    storageDir: source.HISSA_STORAGE ?? path.join(here, '..', 'data', 'objects'),
    sessionTtlHours: Number(source.SESSION_TTL_HOURS ?? 12),
    otpTtlMinutes: Number(source.OTP_TTL_MINUTES ?? 10),
    otpMaxAttempts: 5,
    webhookSecret: source.PARTNER_WEBHOOK_SECRET ?? '',
    corsOrigins: (source.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
    timezone: 'Asia/Muscat',
    /* Echoing the OTP in the API response hands the second factor to whoever
       already has the password, in the same reply. It is a real convenience
       for a pilot team with no SMS provider, so it stays — but as something
       you switch on deliberately, never as the default for any environment
       that merely failed to name itself. */
    exposeOtp: source.HISSA_DEV_OTP === '1' && env !== 'production',
    /* Same reasoning: this read NODE_ENV directly, so an unlabelled
       environment with RATE_LIMIT_DISABLED set turned the limiter off on what
       was, for all anyone knew, production. */
    rateLimitEnabled: !(source.RATE_LIMIT_DISABLED === '1' && env !== 'production'),
  };
}

export const config = buildConfig();

/**
 * The webhook secret decides whether a settlement is real. It used to fall back
 * to a constant committed in this file, so an instance started without the
 * environment variable would happily verify events signed by anyone who had
 * read the repository — and a verified `payment.settled` confirms an order,
 * counts it toward the pool minimum and turns into holdings at close.
 *
 * An empty secret is not fail-closed on its own: HMAC over an empty key is a
 * perfectly valid HMAC. So the refusal has to happen here, at boot, before
 * anything is listening.
 *
 * Development is the one exemption, because a laptop with no partner sandbox
 * still has to start.
 */
export function assertBootConfig(c: { env: string; webhookSecret: string } = config): void {
  if (c.env === 'development') return;
  if (!c.webhookSecret) {
    throw new Error(
      'PARTNER_WEBHOOK_SECRET is required outside development: refusing to start with an unsigned webhook path.',
    );
  }
  if (c.webhookSecret === 'dev-webhook-secret') {
    throw new Error(
      'PARTNER_WEBHOOK_SECRET is set to the old committed default: refusing to start. Generate a new one.',
    );
  }
}
