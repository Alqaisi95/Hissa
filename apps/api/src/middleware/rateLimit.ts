import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.ts';
import { config } from '../config.ts';

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

/** NFR-006 — coarse in-process throttle on OTP, login and webhook endpoints. */
export function rateLimit(options: { windowMs: number; max: number; keyPrefix: string }) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!config.rateLimitEnabled) return next();
    const key = `${options.keyPrefix}:${req.ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    if (bucket.count >= options.max) {
      return next(new AppError(429, 'rate_limited',
        'عدد المحاولات كبير. حاول لاحقًا.', 'Too many attempts. Please try again later.'));
    }
    bucket.count += 1;
    next();
  };
}

export function resetRateLimits(): void {
  buckets.clear();
}
