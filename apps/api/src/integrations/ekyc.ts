/**
 * FR-003 / FR-004 — eKYC, KYB, liveness, sanctions and PEP screening.
 * Sandbox adapter: deterministic outcomes driven by test fixtures so the pilot
 * team can exercise approve / review / reject paths without a live provider.
 * Failure reasons returned to the user are non-revealing (§11 "سبب فشل غير كاشف").
 */
import { randomToken } from '../lib/crypto.ts';

export interface ScreeningResult {
  reference: string;
  decision: 'approved' | 'manual_review' | 'rejected';
  riskRating: 'low' | 'medium' | 'high';
  pep: boolean;
  sanctions: boolean;
  /** Internal detail for the compliance queue only. */
  internalNotes: string[];
}

export function screenIndividual(input: {
  fullName: string; idReference: string; dateOfBirth?: string; nationality?: string;
}): ScreeningResult {
  const notes: string[] = [];
  const name = input.fullName.toLowerCase();

  // Sandbox triggers, replaced by the provider response in production.
  const sanctions = name.includes('sanctioned') || input.idReference.startsWith('999');
  const pep = name.includes('minister') || input.idReference.startsWith('888');
  const needsReview = input.idReference.startsWith('777');

  if (sanctions) notes.push('sanctions list match — escalate to MLRO');
  if (pep) notes.push('PEP match — enhanced due diligence required');
  if (needsReview) notes.push('document quality below threshold — manual review');

  const decision: ScreeningResult['decision'] =
    sanctions ? 'rejected' : (pep || needsReview) ? 'manual_review' : 'approved';

  return {
    reference: `KYC-${randomToken(8).toUpperCase()}`,
    decision,
    riskRating: sanctions ? 'high' : pep ? 'high' : needsReview ? 'medium' : 'low',
    pep, sanctions, internalNotes: notes,
  };
}

export function screenEntity(input: { legalName: string; crNumber: string }): ScreeningResult {
  const needsReview = input.crNumber.startsWith('777');
  return {
    reference: `KYB-${randomToken(8).toUpperCase()}`,
    decision: needsReview ? 'manual_review' : 'approved',
    riskRating: needsReview ? 'medium' : 'low',
    pep: false, sanctions: false,
    internalNotes: needsReview ? ['CR record requires manual verification'] : [],
  };
}

/** Investor-facing wording never reveals why screening failed (§11). */
export const publicFailureMessage = () => ({
  messageAr: 'تعذر إكمال التحقق آليًا. سيتواصل معك فريق الامتثال خلال يومي عمل.',
  messageEn: 'Automated verification could not be completed. Compliance will contact you within two business days.',
});
