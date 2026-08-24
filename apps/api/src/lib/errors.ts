/**
 * Bilingual application errors. Messages are safe for the client: they never
 * reveal internal rule thresholds or compliance reasoning (FR-108, FR-301, AT-07).
 */
export class AppError extends Error {
  status: number;
  code: string;
  messageAr: string;
  messageEn: string;
  details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    messageAr: string,
    messageEn: string,
    details?: Record<string, unknown>,
  ) {
    super(messageEn);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.messageAr = messageAr;
    this.messageEn = messageEn;
    this.details = details;
  }
}

export const badRequest = (code: string, ar: string, en: string, details?: Record<string, unknown>) =>
  new AppError(400, code, ar, en, details);

export const unauthorized = (ar = 'يلزم تسجيل الدخول', en = 'Authentication required') =>
  new AppError(401, 'unauthorized', ar, en);

export const forbidden = (ar = 'لا تملك صلاحية لهذا الإجراء', en = 'You are not permitted to perform this action') =>
  new AppError(403, 'forbidden', ar, en);

export const notFound = (ar = 'العنصر غير موجود', en = 'Not found') =>
  new AppError(404, 'not_found', ar, en);

export const conflict = (code: string, ar: string, en: string, details?: Record<string, unknown>) =>
  new AppError(409, code, ar, en, details);

export const unprocessable = (code: string, ar: string, en: string, details?: Record<string, unknown>) =>
  new AppError(422, code, ar, en, details);
