import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.ts';
import { newId, nowIso } from '../lib/ids.ts';

export function correlation(req: Request, res: Response, next: NextFunction): void {
  req.correlationId = req.header('x-correlation-id') ?? newId();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}

/** Uniform, bilingual error envelope. Internals never leak to the client (§13.1). */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const correlationId = req.correlationId ?? 'n/a';

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        messageAr: 'البيانات المدخلة غير صحيحة',
        messageEn: 'Invalid input',
        fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        correlationId,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        messageAr: err.messageAr,
        messageEn: err.messageEn,
        details: err.details,
        correlationId,
      },
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  // Domain invariants thrown as plain errors map to a stable client contract.
  const mapped: Record<string, { status: number; ar: string; en: string }> = {
    dual_control_violation: { status: 409, ar: 'لا يمكن لنفس المستخدم الإنشاء والاعتماد', en: 'The maker cannot approve their own request' },
    retroactive_setting_not_allowed: { status: 422, ar: 'لا يجوز تطبيق الإعداد بأثر رجعي', en: 'Settings cannot be applied retroactively' },
  };
  if (mapped[message]) {
    const m = mapped[message];
    res.status(m.status).json({ error: { code: message, messageAr: m.ar, messageEn: m.en, correlationId } });
    return;
  }

  console.error(`[${nowIso()}] unhandled ${correlationId}:`, err);
  res.status(500).json({
    error: {
      code: 'internal_error',
      messageAr: 'حدث خطأ غير متوقع. تم تسجيل الحادثة.',
      messageEn: 'An unexpected error occurred. The incident has been logged.',
      correlationId,
    },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', messageAr: 'المسار غير موجود', messageEn: 'Route not found' } });
}
