/**
 * PRD §10.1 — documents live in object storage with metadata, checksum and a
 * malware scan. The local driver below mirrors that contract on disk for the
 * sandbox; the production driver swaps the two functions for an S3-compatible client.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.ts';

export interface StoredObject { key: string; checksum: string; sizeBytes: number }

export function putObject(key: string, data: Buffer): StoredObject {
  const target = path.join(config.storageDir, key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return {
    key,
    checksum: crypto.createHash('sha256').update(data).digest('hex'),
    sizeBytes: data.byteLength,
  };
}

export function getObject(key: string): Buffer | null {
  const target = path.join(config.storageDir, key);
  return fs.existsSync(target) ? fs.readFileSync(target) : null;
}

const ALLOWED_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
]);

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;   // FR-102 size cap

export function validateUpload(mimeType: string, sizeBytes: number): { ok: boolean; reason?: string } {
  if (!ALLOWED_MIME.has(mimeType)) return { ok: false, reason: 'unsupported_type' };
  if (sizeBytes > MAX_UPLOAD_BYTES) return { ok: false, reason: 'too_large' };
  if (sizeBytes <= 0) return { ok: false, reason: 'empty_file' };
  return { ok: true };
}

/** FR-102 — stand-in malware scan; production wires an AV service here. */
export function scanForMalware(data: Buffer): 'clean' | 'infected' {
  const signature = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR';   // EICAR test string
  return data.includes(signature) ? 'infected' : 'clean';
}
