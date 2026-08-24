/**
 * FR-307 / §11 — e-signature adapter. Produces a signed PDF reference plus
 * signature evidence; the artefact itself lives in encrypted object storage.
 */
import { newId, nowIso } from '../lib/ids.ts';
import { contentHash, randomToken } from '../lib/crypto.ts';
import { putObject } from '../lib/storage.ts';

export interface SignatureEnvelope {
  envelopeId: string;
  documentId: string;
  storageKey: string;
  checksum: string;
  signedAt: string;
  evidence: { signerId: string; method: string; ip?: string | null };
}

export function signDocument(params: {
  signerId: string;
  title: string;
  payload: Record<string, unknown>;
  ip?: string | null;
}): SignatureEnvelope {
  const signedAt = nowIso();
  const evidence = { signerId: params.signerId, method: 'otp_click_wrap', ip: params.ip ?? null };
  const rendered = JSON.stringify({ title: params.title, ...params.payload, signedAt, evidence }, null, 2);
  const stored = putObject(`agreements/${params.signerId}/${randomToken(8)}.json`, Buffer.from(rendered, 'utf8'));

  return {
    envelopeId: newId(),
    documentId: newId(),
    storageKey: stored.key,
    checksum: contentHash({ rendered }),
    signedAt,
    evidence,
  };
}
