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

/**
 * Every key is resolved through here, and a key that lands outside the storage
 * directory is refused rather than written.
 *
 * `path.join` normalises `..` away silently, so a key assembled from any
 * caller-supplied string was an arbitrary write: attachDocument built its key
 * from an unconstrained `category`, and a project owner uploading to their own
 * draft could put a file anywhere the process could write. Callers now build
 * keys from server-controlled values only — but this is the wall behind that,
 * because the next caller will not remember.
 *
 * An S3 driver keeps the same contract: object stores treat the key as
 * opaque, and a key with `..` in it is still not one we ever mean to write.
 */
function resolvePath(key: string): string {
  const root = path.resolve(config.storageDir);
  const target = path.resolve(root, key);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`storage key escapes the storage directory: ${key}`);
  }
  return target;
}

export function putObject(key: string, data: Buffer): StoredObject {
  const target = resolvePath(key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return {
    key,
    checksum: crypto.createHash('sha256').update(data).digest('hex'),
    sizeBytes: data.byteLength,
  };
}

export function getObject(key: string): Buffer | null {
  const target = resolvePath(key);
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
