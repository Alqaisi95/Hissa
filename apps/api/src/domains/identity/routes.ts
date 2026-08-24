/** Identity, KYC/KYB, classification, suitability and consent endpoints (FR-001..FR-008). */
import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx } from '../../db/index.ts';
import { newId, nowIso, plus, minutes, hours, days } from '../../lib/ids.ts';
import { hashPassword, verifyPassword, sha256, randomToken, numericCode, contentHash } from '../../lib/crypto.ts';
import { audit } from '../../lib/audit.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized, unprocessable } from '../../lib/errors.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { rateLimit } from '../../middleware/rateLimit.ts';
import { config } from '../../config.ts';
import { requiresMfa } from '../../lib/rbac.ts';
import { QUESTIONS, scoreSuitability, proposeClassification } from './suitability.ts';
import { screenIndividual, screenEntity, publicFailureMessage } from '../../integrations/ekyc.ts';
import { notify } from '../../integrations/notifications.ts';
import { track } from '../analytics/track.ts';
import { LEGAL_DOCUMENTS } from '../../lib/legal.ts';

export const identityRouter = Router();

const contact = z.object({
  email: z.string().email().optional(),
  phone: z.string().regex(/^(\+968)?[79]\d{7}$/, 'Oman mobile number expected').optional(),
}).refine((v) => v.email || v.phone, { message: 'email or phone is required' });

// ─────────────────────────── FR-001 registration + OTP ───────────────────────────

identityRouter.post('/register', rateLimit({ windowMs: minutes(15), max: 10, keyPrefix: 'register' }), (req, res) => {
  const body = contact.and(z.object({
    fullName: z.string().min(3).max(120),
    password: z.string().min(10, 'password must be at least 10 characters'),
    locale: z.enum(['ar', 'en']).default('ar'),
    accountType: z.enum(['investor', 'project_owner']).default('investor'),
  })).parse(req.body);

  const normalisedPhone = body.phone ? (body.phone.startsWith('+968') ? body.phone : `+968${body.phone}`) : null;

  const existing = get<any>(
    `SELECT id FROM users WHERE (email IS NOT NULL AND email = ?) OR (phone IS NOT NULL AND phone = ?)`,
    [body.email ?? null, normalisedPhone],
  );
  if (existing) {
    throw conflict('account_exists', 'يوجد حساب مسجل بهذه البيانات', 'An account already exists for these details');
  }

  const { hash, salt } = hashPassword(body.password);
  const userId = newId();
  const at = nowIso();

  const code = tx(() => {
    run(
      `INSERT INTO users (id, email, phone, full_name, password_hash, password_salt, locale, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, 'pending_verification', ?, ?)`,
      [userId, body.email ?? null, normalisedPhone, body.fullName, hash, salt, body.locale, at, at],
    );
    run(`INSERT INTO user_roles (user_id, role, granted_at) VALUES (?,?,?)`, [userId, body.accountType, at]);
    if (body.accountType === 'investor') {
      run(
        `INSERT INTO investor_profiles (id, user_id, classification, kyc_status, created_at, updated_at)
         VALUES (?,?, 'retail', 'not_started', ?, ?)`,
        [newId(), userId, at, at],
      );
    }
    return issueOtp(userId, body.email ? 'email' : 'sms', 'verify_contact');
  });

  audit({ actorId: userId, action: 'user.registered', entityType: 'user', entityId: userId,
          after: { accountType: body.accountType }, ip: req.ip });
  track('signup_started', userId, {});

  res.status(201).json({
    userId,
    // FR-001: the account is not active until one channel is verified.
    status: 'pending_verification',
    otpChannel: body.email ? 'email' : 'sms',
    ...(config.exposeOtp ? { devOtp: code } : {}),
  });
});

function issueOtp(userId: string, channel: 'email' | 'sms', purpose: string): string {
  const code = numericCode(6);
  run(
    `INSERT INTO otp_codes (id, user_id, channel, purpose, code_hash, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [newId(), userId, channel, purpose, sha256(code), plus(nowIso(), minutes(config.otpTtlMinutes)), nowIso()],
  );
  notify({ userId, templateCode: 'otp_code', channel, variables: { code, minutes: config.otpTtlMinutes } });
  return code;
}

identityRouter.post('/otp/request', rateLimit({ windowMs: minutes(10), max: 5, keyPrefix: 'otp' }), (req, res) => {
  const body = z.object({
    userId: z.string().uuid(),
    channel: z.enum(['email', 'sms']),
    purpose: z.enum(['verify_contact', 'mfa', 'password_reset', 'payment_change']).default('verify_contact'),
  }).parse(req.body);

  const user = get<any>(`SELECT id FROM users WHERE id = ?`, [body.userId]);
  if (!user) throw notFound();

  const code = issueOtp(body.userId, body.channel, body.purpose);
  res.json({ sent: true, ...(config.exposeOtp ? { devOtp: code } : {}) });
});

identityRouter.post('/otp/verify', rateLimit({ windowMs: minutes(10), max: 10, keyPrefix: 'otpv' }), (req, res) => {
  const body = z.object({
    userId: z.string().uuid(),
    code: z.string().length(6),
    purpose: z.enum(['verify_contact', 'mfa', 'password_reset', 'payment_change']).default('verify_contact'),
  }).parse(req.body);

  const otp = get<any>(
    `SELECT * FROM otp_codes WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [body.userId, body.purpose],
  );
  if (!otp) throw badRequest('otp_not_found', 'لا يوجد رمز تحقق نشط', 'No active verification code');
  if (new Date(otp.expires_at) < new Date()) {
    throw badRequest('otp_expired', 'انتهت صلاحية الرمز', 'The verification code has expired');
  }
  if (otp.attempts >= config.otpMaxAttempts) {
    throw forbidden('تجاوزت عدد المحاولات المسموحة', 'Too many verification attempts');
  }
  if (otp.code_hash !== sha256(body.code)) {
    run(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`, [otp.id]);
    throw badRequest('otp_invalid', 'رمز التحقق غير صحيح', 'Invalid verification code');
  }

  const at = nowIso();
  run(`UPDATE otp_codes SET consumed_at = ? WHERE id = ?`, [at, otp.id]);

  if (body.purpose === 'verify_contact') {
    const column = otp.channel === 'email' ? 'email_verified_at' : 'phone_verified_at';
    run(`UPDATE users SET ${column} = ?, status = 'active', updated_at = ? WHERE id = ?`, [at, at, body.userId]);
    audit({ actorId: body.userId, action: 'user.contact_verified', entityType: 'user', entityId: body.userId,
            after: { channel: otp.channel }, ip: req.ip });
  }
  res.json({ verified: true, purpose: body.purpose });
});

// ─────────────────────────── Sessions & MFA (FR-007) ───────────────────────────

identityRouter.post('/login', rateLimit({ windowMs: minutes(15), max: 10, keyPrefix: 'login' }), (req, res) => {
  const body = z.object({
    identifier: z.string().min(3),
    password: z.string().min(1),
  }).parse(req.body);

  const user = get<any>(`SELECT * FROM users WHERE email = ? OR phone = ?`, [body.identifier, body.identifier]);
  // Uniform failure message — account existence is never disclosed.
  const invalid = () => unauthorized('بيانات الدخول غير صحيحة', 'Invalid credentials');
  if (!user) throw invalid();

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw forbidden('الحساب مقفل مؤقتًا بسبب محاولات دخول متكررة', 'Account temporarily locked after repeated attempts');
  }
  if (!verifyPassword(body.password, user.password_hash, user.password_salt)) {
    const failed = user.failed_logins + 1;
    run(`UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?`,
        [failed, failed >= 5 ? plus(nowIso(), minutes(30)) : null, user.id]);
    throw invalid();
  }
  if (user.status === 'pending_verification') {
    throw forbidden('يلزم تفعيل الحساب عبر رمز التحقق', 'Verify your contact channel before signing in');
  }
  if (user.status === 'suspended' || user.status === 'closed') {
    throw forbidden('الحساب موقوف. تواصل مع الدعم.', 'Account suspended. Please contact support.');
  }

  const roles = all<{ role: string }>(`SELECT role FROM user_roles WHERE user_id = ?`, [user.id]).map((r) => r.role);
  const needsMfa = requiresMfa(roles) || user.mfa_enabled === 1;

  const token = randomToken();
  const sessionId = newId();
  const at = nowIso();
  run(
    `INSERT INTO sessions (id, user_id, token_hash, mfa_passed, ip, user_agent, created_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [sessionId, user.id, sha256(token), needsMfa ? 0 : 1, req.ip ?? null, req.header('user-agent') ?? null,
     at, plus(at, hours(config.sessionTtlHours))],
  );
  run(`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?`, [user.id]);
  audit({ actorId: user.id, action: 'session.created', entityType: 'session', entityId: sessionId, ip: req.ip });

  let devOtp: string | undefined;
  if (needsMfa) devOtp = issueOtp(user.id, user.email ? 'email' : 'sms', 'mfa');

  res.cookie?.('hissa_session', token, {
    httpOnly: true, sameSite: 'lax', secure: config.env === 'production',
    maxAge: hours(config.sessionTtlHours),
  });
  res.json({
    token, sessionId, mfaRequired: needsMfa, roles, locale: user.locale,
    ...(config.exposeOtp && devOtp ? { devOtp } : {}),
  });
});

identityRouter.post('/mfa/verify', requireAuthLoose, (req, res) => {
  const body = z.object({ code: z.string().length(6) }).parse(req.body);
  const auth = req.auth;
  if (!auth) throw unauthorized();

  const otp = get<any>(
    `SELECT * FROM otp_codes WHERE user_id = ? AND purpose = 'mfa' AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`, [auth.userId],
  );
  if (!otp || new Date(otp.expires_at) < new Date() || otp.code_hash !== sha256(body.code)) {
    if (otp) run(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?`, [otp.id]);
    throw badRequest('mfa_invalid', 'رمز التحقق غير صحيح أو منتهي', 'Invalid or expired code');
  }
  run(`UPDATE otp_codes SET consumed_at = ? WHERE id = ?`, [nowIso(), otp.id]);
  run(`UPDATE sessions SET mfa_passed = 1 WHERE id = ?`, [auth.sessionId]);
  run(`UPDATE users SET mfa_enabled = 1 WHERE id = ?`, [auth.userId]);
  audit({ actorId: auth.userId, action: 'session.mfa_passed', entityType: 'session', entityId: auth.sessionId });
  res.json({ mfaPassed: true });
});

/** MFA verification runs on an authenticated-but-not-yet-elevated session. */
function requireAuthLoose(req: any, _res: any, next: any) {
  if (!req.auth) return next(unauthorized());
  next();
}

identityRouter.post('/logout', requireAuthLoose, (req, res) => {
  run(`UPDATE sessions SET revoked_at = ? WHERE id = ?`, [nowIso(), req.auth!.sessionId]);
  audit({ actorId: req.auth!.userId, action: 'session.revoked', entityType: 'session', entityId: req.auth!.sessionId });
  res.clearCookie?.('hissa_session');
  res.json({ loggedOut: true });
});

identityRouter.get('/me', requireAuthLoose, (req, res) => {
  const auth = req.auth!;
  const user = get<any>(`SELECT id, full_name, email, phone, locale, status, mfa_enabled FROM users WHERE id = ?`, [auth.userId]);
  const profile = get<any>(`SELECT * FROM investor_profiles WHERE user_id = ?`, [auth.userId]);
  const entities = all<any>(
    `SELECT e.* FROM legal_entities e
      JOIN entity_people p ON p.entity_id = e.id
     WHERE p.user_id = ? AND p.role = 'authorised_rep'`, [auth.userId],
  );
  const consented = all<{ document_key: string; version: string }>(
    `SELECT document_key, version FROM consents WHERE user_id = ?`, [auth.userId],
  );

  res.json({
    user: { ...user, mfaEnabled: user.mfa_enabled === 1 },
    roles: auth.roles,
    mfaPassed: auth.mfaPassed,
    investorProfile: profile ? {
      classification: profile.classification,
      kycStatus: profile.kyc_status,
      suitabilityResult: profile.suitability_result,
      suitabilityTakenAt: profile.suitability_taken_at,
      kycExpiresAt: profile.kyc_expires_at,
    } : null,
    entities,
    consents: consented,
    // FR-008: what the user must still do before investing.
    outstanding: outstandingRequirements(auth.userId),
  });
});

export function outstandingRequirements(userId: string): string[] {
  const items: string[] = [];
  const profile = get<any>(`SELECT * FROM investor_profiles WHERE user_id = ?`, [userId]);
  if (!profile) return items;
  if (profile.kyc_status !== 'approved') items.push('kyc');
  if (!profile.suitability_taken_at) items.push('suitability');
  const consents = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM consents WHERE user_id = ? AND document_key IN ('terms','risk_disclosure','privacy')`,
    [userId],
  );
  if ((consents?.n ?? 0) < 3) items.push('consents');
  if (profile.kyc_expires_at && new Date(profile.kyc_expires_at) < new Date()) items.push('kyc_refresh');
  return items;
}

// ─────────────────────────── FR-006 consents ───────────────────────────

identityRouter.get('/legal-documents', (_req, res) => {
  res.json({ documents: LEGAL_DOCUMENTS.map((d) => ({ key: d.key, version: d.version, titleAr: d.titleAr, titleEn: d.titleEn })) });
});

identityRouter.get('/legal-documents/:key', (req, res) => {
  const doc = LEGAL_DOCUMENTS.find((d) => d.key === req.params.key);
  if (!doc) throw notFound();
  res.json(doc);
});

identityRouter.post('/consents', requireAuth, (req, res) => {
  const body = z.object({
    documentKey: z.string(),
    version: z.string(),
  }).parse(req.body);

  const doc = LEGAL_DOCUMENTS.find((d) => d.key === body.documentKey && d.version === body.version);
  if (!doc) throw badRequest('unknown_document', 'نسخة الوثيقة غير معروفة', 'Unknown document version');

  const id = newId();
  run(
    `INSERT INTO consents (id, user_id, document_key, version, content_hash, accepted_at, ip)
     VALUES (?,?,?,?,?,?,?)`,
    [id, req.auth!.userId, doc.key, doc.version, contentHash(doc.bodyAr + doc.bodyEn), nowIso(), req.ip ?? null],
  );
  audit({ actorId: req.auth!.userId, action: 'consent.accepted', entityType: 'consent', entityId: id,
          after: { key: doc.key, version: doc.version }, ip: req.ip });
  res.status(201).json({ consentId: id, documentKey: doc.key, version: doc.version });
});

// ─────────────────────────── FR-005 suitability ───────────────────────────

identityRouter.get('/suitability/questions', (_req, res) => {
  res.json({ questions: QUESTIONS });
});

identityRouter.post('/suitability', requireAuth, (req, res) => {
  const body = z.object({ answers: z.record(z.string()) }).parse(req.body);
  const outcome = scoreSuitability(body.answers);
  const at = nowIso();

  run(
    `UPDATE investor_profiles
        SET suitability_score = ?, suitability_result = ?, suitability_taken_at = ?, updated_at = ?
      WHERE user_id = ?`,
    [outcome.score, outcome.result, at, at, req.auth!.userId],
  );
  audit({ actorId: req.auth!.userId, action: 'suitability.completed', entityType: 'investor_profile',
          entityId: req.auth!.userId, after: { score: outcome.score, result: outcome.result, version: outcome.version } });
  track(outcome.result === 'restricted' ? 'quiz_restricted' : 'quiz_completed', req.auth!.userId, { score: outcome.score });

  res.json({
    score: outcome.score,
    result: outcome.result,
    version: outcome.version,
    // The result is shown; the investor learns which risks to revisit.
    reviewTopics: outcome.failedCodes,
    messageAr: outcome.result === 'restricted'
      ? 'نتيجة الاختبار تشير إلى الحاجة لمراجعة المخاطر قبل الاستثمار. يمكنك إعادة الاختبار بعد قراءة صفحة المخاطر.'
      : outcome.result === 'warn'
        ? 'يمكنك المتابعة، مع التنبيه إلى ضرورة مراجعة المخاطر والسيولة بعناية.'
        : 'اجتزت اختبار الملاءمة.',
  });
});

// ─────────────────────────── FR-002/FR-003 classification & KYC ───────────────────────────

identityRouter.post('/classification', requireAuth, (req, res) => {
  const body = z.object({
    netWorthOmr: z.number().nonnegative().optional(),
    annualIncomeOmr: z.number().nonnegative().optional(),
    professionalCertification: z.boolean().optional(),
    priorDeals: z.number().int().nonnegative().optional(),
  }).parse(req.body);

  const proposed = proposeClassification(body);
  const profile = get<any>(`SELECT * FROM investor_profiles WHERE user_id = ?`, [req.auth!.userId]);
  if (!profile) throw notFound();

  const at = nowIso();
  // Anything above retail needs compliance sign-off before it takes effect (FR-002).
  const effective = proposed === 'retail' ? proposed : profile.classification;

  run(`INSERT INTO investor_profile_versions (id, profile_id, classification, kyc_status, reason, actor_id, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [newId(), profile.id, effective, profile.kyc_status, `self-declared evidence → proposed ${proposed}`,
       req.auth!.userId, at]);
  run(`UPDATE investor_profiles SET classification = ?, classification_evidence = ?, classification_effective_from = ?, updated_at = ?
        WHERE id = ?`,
      [effective, JSON.stringify(body), at, at, profile.id]);

  audit({ actorId: req.auth!.userId, action: 'classification.declared', entityType: 'investor_profile',
          entityId: profile.id, before: { classification: profile.classification },
          after: { classification: effective, proposed } });

  res.json({
    classification: effective,
    proposed,
    pendingReview: proposed !== effective,
    messageAr: proposed !== effective
      ? 'تم استلام أدلة التصنيف. يسري التصنيف الأعلى بعد مراجعة الامتثال.'
      : 'تم تحديث التصنيف.',
  });
});

identityRouter.post('/kyc/start', requireAuth, (req, res) => {
  const body = z.object({
    fullName: z.string().min(3),
    idReference: z.string().min(4),
    dateOfBirth: z.string().optional(),
    nationality: z.string().optional(),
  }).parse(req.body);

  const profile = get<any>(`SELECT * FROM investor_profiles WHERE user_id = ?`, [req.auth!.userId]);
  if (!profile) throw notFound();

  track('kyc_started', req.auth!.userId, {});
  const result = screenIndividual(body);
  const at = nowIso();

  const status = result.decision === 'approved' ? 'approved'
    : result.decision === 'rejected' ? 'rejected' : 'in_review';

  run(
    `UPDATE investor_profiles
        SET kyc_status = ?, kyc_reference = ?, kyc_approved_at = ?, kyc_expires_at = ?,
            risk_rating = ?, pep_flag = ?, sanctions_flag = ?, updated_at = ?
      WHERE id = ?`,
    [status, result.reference, status === 'approved' ? at : null,
     status === 'approved' ? plus(at, days(365)) : null,
     result.riskRating, result.pep ? 1 : 0, result.sanctions ? 1 : 0, at, profile.id],
  );
  run(`INSERT INTO investor_profile_versions (id, profile_id, classification, kyc_status, reason, actor_id, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [newId(), profile.id, profile.classification, status, `eKYC ${result.decision}`, req.auth!.userId, at]);

  // Manual review and rejections become a compliance case (FR-602).
  if (status !== 'approved') {
    const caseId = newId();
    run(
      `INSERT INTO cases (id, reference, type, subject, body, severity, status, raised_by, related_type, related_id,
                          sla_due_at, created_at, updated_at)
       VALUES (?,?, 'kyc_review', ?, ?, ?, 'open', ?, 'investor_profile', ?, ?, ?, ?)`,
      [caseId, `CASE-${result.reference}`, `مراجعة تحقق هوية — ${body.fullName}`,
       result.internalNotes.join('; ') || 'automated review required',
       result.sanctions ? 'critical' : 'high', req.auth!.userId, profile.id, plus(at, hours(48)), at, at],
    );
  }

  audit({ actorId: req.auth!.userId, action: 'kyc.screened', entityType: 'investor_profile', entityId: profile.id,
          after: { status, riskRating: result.riskRating, reference: result.reference } });
  if (status === 'approved') track('kyc_completed', req.auth!.userId, {});
  else track('kyc_failed', req.auth!.userId, { decision: result.decision });

  res.json({
    status,
    reference: result.reference,
    ...(status === 'approved'
      ? { messageAr: 'تم اعتماد التحقق من الهوية.', messageEn: 'Identity verification approved.' }
      : publicFailureMessage()),
  });
});

// ─────────────────────────── FR-004 KYB & UBO ───────────────────────────

identityRouter.post('/entities', requireAuth, (req, res) => {
  const body = z.object({
    legalName: z.string().min(3),
    crNumber: z.string().min(4),
    activity: z.string().min(2),
    incorporatedOn: z.string(),
    governorate: z.string().optional(),
    people: z.array(z.object({
      fullName: z.string().min(3),
      role: z.enum(['ubo', 'director', 'authorised_rep']),
      ownershipBp: z.number().int().min(0).max(10_000).optional(),
      idReference: z.string().optional(),
    })).min(1),
  }).parse(req.body);

  if (get<any>(`SELECT id FROM legal_entities WHERE cr_number = ?`, [body.crNumber])) {
    throw conflict('entity_exists', 'السجل التجاري مسجل مسبقًا', 'This CR number is already registered');
  }
  // Every UBO must be identifiable and screenable (FR-004).
  const ubos = body.people.filter((p) => p.role === 'ubo');
  if (ubos.length === 0) {
    throw unprocessable('ubo_required', 'يلزم تسجيل المالك المستفيد النهائي', 'At least one ultimate beneficial owner is required');
  }

  const entityId = newId();
  const at = nowIso();
  const screening = screenEntity({ legalName: body.legalName, crNumber: body.crNumber });

  tx(() => {
    run(
      `INSERT INTO legal_entities (id, legal_name, cr_number, activity, incorporated_on, governorate,
                                   kyb_status, kyb_reference, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [entityId, body.legalName, body.crNumber, body.activity, body.incorporatedOn, body.governorate ?? null,
       screening.decision === 'approved' ? 'approved' : 'in_review', screening.reference, req.auth!.userId, at, at],
    );
    // The submitting user is always an authorised representative of the entity.
    run(`INSERT INTO entity_people (id, entity_id, user_id, full_name, role, created_at) VALUES (?,?,?,?,?,?)`,
        [newId(), entityId, req.auth!.userId,
         get<any>(`SELECT full_name FROM users WHERE id = ?`, [req.auth!.userId])!.full_name, 'authorised_rep', at]);

    for (const person of body.people) {
      const personScreen = screenIndividual({ fullName: person.fullName, idReference: person.idReference ?? '000' });
      run(
        `INSERT INTO entity_people (id, entity_id, full_name, role, ownership_bp, id_reference,
                                    screened_at, screening_result, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [newId(), entityId, person.fullName, person.role, person.ownershipBp ?? null, person.idReference ?? null,
         at, personScreen.decision === 'approved' ? 'clear' : personScreen.sanctions ? 'hit' : 'review', at],
      );
    }
  });

  audit({ actorId: req.auth!.userId, action: 'entity.registered', entityType: 'legal_entity', entityId,
          after: { legalName: body.legalName, crNumber: body.crNumber, kyb: screening.decision } });

  res.status(201).json({ entityId, kybStatus: screening.decision === 'approved' ? 'approved' : 'in_review' });
});

identityRouter.get('/entities/:id', requireAuth, (req, res) => {
  const entity = get<any>(`SELECT * FROM legal_entities WHERE id = ?`, [req.params.id]);
  if (!entity) throw notFound();

  const isRep = get<any>(
    `SELECT 1 FROM entity_people WHERE entity_id = ? AND user_id = ?`, [entity.id, req.auth!.userId]);
  const isStaff = req.auth!.roles.some((r) => ['compliance', 'investment_analyst', 'auditor', 'committee_member'].includes(r));
  if (!isRep && !isStaff) throw forbidden();

  const people = all<any>(`SELECT * FROM entity_people WHERE entity_id = ?`, [entity.id]);
  // Screening detail is compliance-only.
  res.json({ entity, people: isStaff ? people : people.map(({ screening_result, id_reference, ...p }) => p) });
});

// ─────────────────────────── Compliance review actions ───────────────────────────

identityRouter.post('/admin/kyc/:profileId/decision', requireAuth, requirePermission('identity.review_kyc'), (req, res) => {
  const body = z.object({
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().min(5),
  }).parse(req.body);

  const profile = get<any>(`SELECT * FROM investor_profiles WHERE id = ?`, [req.params.profileId]);
  if (!profile) throw notFound();

  const at = nowIso();
  run(
    `UPDATE investor_profiles SET kyc_status = ?, kyc_approved_at = ?, kyc_expires_at = ?, updated_at = ? WHERE id = ?`,
    [body.decision, body.decision === 'approved' ? at : null,
     body.decision === 'approved' ? plus(at, days(365)) : null, at, profile.id],
  );
  run(`INSERT INTO investor_profile_versions (id, profile_id, classification, kyc_status, reason, actor_id, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [newId(), profile.id, profile.classification, body.decision, body.reason, req.auth!.userId, at]);

  audit({ actorId: req.auth!.userId, actorRole: 'compliance', action: `kyc.${body.decision}`,
          entityType: 'investor_profile', entityId: profile.id,
          before: { kycStatus: profile.kyc_status }, after: { kycStatus: body.decision }, reason: body.reason });
  notify({ userId: profile.user_id, templateCode: body.decision === 'approved' ? 'kyc_approved' : 'kyc_rejected' });

  res.json({ profileId: profile.id, kycStatus: body.decision });
});

identityRouter.post('/admin/classification/:profileId', requireAuth, requirePermission('identity.classify'), (req, res) => {
  const body = z.object({
    classification: z.enum(['retail', 'angel', 'sophisticated']),
    reason: z.string().min(5),
  }).parse(req.body);

  const profile = get<any>(`SELECT * FROM investor_profiles WHERE id = ?`, [req.params.profileId]);
  if (!profile) throw notFound();
  const at = nowIso();

  run(`INSERT INTO investor_profile_versions (id, profile_id, classification, kyc_status, reason, actor_id, created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [newId(), profile.id, body.classification, profile.kyc_status, body.reason, req.auth!.userId, at]);
  run(`UPDATE investor_profiles SET classification = ?, classification_effective_from = ?, updated_at = ? WHERE id = ?`,
      [body.classification, at, at, profile.id]);
  audit({ actorId: req.auth!.userId, action: 'classification.approved', entityType: 'investor_profile',
          entityId: profile.id, before: { classification: profile.classification },
          after: { classification: body.classification }, reason: body.reason });

  res.json({ profileId: profile.id, classification: body.classification });
});

/** FR-008 — periodic or risk-driven re-verification moves the account to Restricted. */
identityRouter.post('/admin/users/:userId/restrict', requireAuth, requirePermission('identity.suspend'), (req, res) => {
  const body = z.object({
    status: z.enum(['active', 'restricted', 'suspended']),
    reason: z.string().min(5),
  }).parse(req.body);

  const user = get<any>(`SELECT * FROM users WHERE id = ?`, [req.params.userId]);
  if (!user) throw notFound();

  run(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`, [body.status, nowIso(), user.id]);
  if (body.status !== 'active') {
    run(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, [nowIso(), user.id]);
  }
  audit({ actorId: req.auth!.userId, action: `user.${body.status}`, entityType: 'user', entityId: user.id,
          before: { status: user.status }, after: { status: body.status }, reason: body.reason });

  res.json({ userId: user.id, status: body.status });
});

identityRouter.get('/admin/kyc/queue', requireAuth, requirePermission('identity.review_kyc'), (_req, res) => {
  const rows = all<any>(
    `SELECT p.id AS profile_id, p.kyc_status, p.risk_rating, p.pep_flag, p.sanctions_flag, p.updated_at,
            u.id AS user_id, u.full_name, u.email, u.status AS user_status
       FROM investor_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.kyc_status IN ('pending','in_review') OR p.sanctions_flag = 1 OR p.pep_flag = 1
      ORDER BY p.sanctions_flag DESC, p.pep_flag DESC, p.updated_at ASC`,
  );
  res.json({ items: rows, count: rows.length });
});
