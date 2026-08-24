import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { config } from './config.ts';
import { db, all, get } from './db/index.ts';
import { correlation, errorHandler, notFoundHandler } from './middleware/error.ts';
import { loadSession, requireAuth, requirePermission } from './middleware/auth.ts';
import { rateLimit } from './middleware/rateLimit.ts';
import { verifySignature } from './lib/crypto.ts';
import { badRequest } from './lib/errors.ts';
import { identityRouter } from './domains/identity/routes.ts';
import { originationRouter } from './domains/origination/routes.ts';
import { poolsRouter } from './domains/pools/routes.ts';
import { ordersRouter, handlePartnerEvent } from './domains/orders/routes.ts';
import { fundsRouter } from './domains/funds/routes.ts';
import { portfolioRouter } from './domains/portfolio/routes.ts';
import { casesRouter } from './domains/cases/routes.ts';
import { adminRouter } from './domains/admin/routes.ts';
import { publicRouter } from './domains/public/routes.ts';
import { kpiSnapshot, track } from './domains/analytics/track.ts';
import { inbox } from './integrations/notifications.ts';
import { ALL_JOBS } from './workflow/scheduler.ts';
import { nowIso } from './lib/ids.ts';

export function createApp() {
  db();   // open the database and apply the schema
  const app = express();

  app.set('trust proxy', 1);
  app.use(correlation);
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(cookieParser());

  // NFR-006 — baseline security headers; a WAF/CDN adds the rest in production.
  app.use((_req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('permissions-policy', 'geolocation=(), camera=(), microphone=()');
    if (config.env === 'production') {
      res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // §11.1 — webhooks are verified against the raw body before JSON parsing.
  app.post('/api/webhooks/partner',
    express.raw({ type: '*/*', limit: '1mb' }),
    rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'webhook' }),
    (req, res, next) => {
      try {
        const raw = (req.body as Buffer).toString('utf8');
        const signature = req.header('x-hissa-signature') ?? '';
        if (!verifySignature(raw, signature, config.webhookSecret)) {
          // A bad signature is logged and rejected — never processed.
          res.status(401).json({ error: { code: 'invalid_signature', messageAr: 'توقيع غير صالح', messageEn: 'Invalid signature' } });
          return;
        }
        const event = z.object({
          id: z.string().min(1),
          type: z.string().min(1),
          providerRef: z.string().min(1),
          amount: z.number().int().optional(),
        }).parse(JSON.parse(raw));

        res.json(handlePartnerEvent({ ...event, payload: JSON.parse(raw) }));
      } catch (error) { next(error); }
    });

  app.use(express.json({ limit: '25mb' }));
  app.use(loadSession);

  // NFR-012 — liveness and readiness for monitoring.
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok', time: nowIso(), timezone: config.timezone, env: config.env,
      db: get<{ n: number }>(`SELECT 1 AS n`)?.n === 1 ? 'up' : 'down',
    });
  });

  app.use('/api/public', publicRouter);
  app.use('/api/identity', identityRouter);
  app.use('/api/origination', originationRouter);
  app.use('/api/pools', poolsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/funds', fundsRouter);
  app.use('/api/portfolio', portfolioRouter);
  app.use('/api/cases', casesRouter);
  app.use('/api/admin', adminRouter);

  app.get('/api/notifications', requireAuth, (req, res) => {
    res.json({ items: inbox(req.auth!.userId) });
  });

  // §14 — client-side funnel events, pseudonymised on the way in.
  app.post('/api/analytics/events', (req, res) => {
    const body = z.object({
      name: z.string().min(2).max(60),
      poolId: z.string().uuid().optional(),
      properties: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    }).parse(req.body);
    track(body.name, req.auth?.userId ?? null, body.properties, body.poolId);
    res.status(202).json({ accepted: true });
  });

  app.get('/api/analytics/kpis', requireAuth, requirePermission('reports.export'), (req, res) => {
    const windowDays = z.coerce.number().int().min(1).max(365).default(30).parse(req.query.windowDays ?? 30);
    res.json(kpiSnapshot(windowDays));
  });

  /** Manual job trigger for operations and UAT (the scheduler runs them automatically). */
  app.post('/api/admin/jobs/:name/run', requireAuth, requirePermission('audit.read'), (req, res) => {
    const job = ALL_JOBS[req.params.name as keyof typeof ALL_JOBS];
    if (!job) throw badRequest('unknown_job', 'المهمة غير معروفة', 'Unknown job', { available: Object.keys(ALL_JOBS) });
    res.json({ job: req.params.name, result: job(req.auth!.userId as any) });
  });

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
