/**
 * FR-102 / FR-206 — classified document storage with version, expiry, malware
 * scan, checksum and access logging. Restricted files are withheld from users
 * who are not eligible to see them.
 */
import { all, get, run } from '../db/index.ts';
import { newId, nowIso } from './ids.ts';
import { putObject, getObject, validateUpload, scanForMalware, MAX_UPLOAD_BYTES } from './storage.ts';
import { audit } from './audit.ts';
import { badRequest, forbidden, notFound } from './errors.ts';

export interface AttachInput {
  ownerType: string;
  ownerId: string;
  category: string;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  uploadedBy: string;
  expiresOn?: string;
  visibility?: 'internal' | 'investor_verified' | 'public';
}

export function attachDocument(input: AttachInput) {
  const data = Buffer.from(input.contentBase64, 'base64');
  const validation = validateUpload(input.mimeType, data.byteLength);
  if (!validation.ok) {
    const reasons: Record<string, [string, string]> = {
      unsupported_type: ['نوع الملف غير مدعوم. المسموح: PDF و JPG و PNG و XLSX.', 'Unsupported file type. Allowed: PDF, JPG, PNG, XLSX.'],
      too_large: [`حجم الملف يتجاوز الحد المسموح (${MAX_UPLOAD_BYTES / 1024 / 1024} م.ب)`, `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`],
      empty_file: ['الملف فارغ', 'The file is empty'],
    };
    const [ar, en] = reasons[validation.reason!];
    throw badRequest(validation.reason!, ar, en);
  }

  const scan = scanForMalware(data);
  if (scan === 'infected') {
    audit({ actorId: input.uploadedBy, action: 'document.malware_blocked', entityType: input.ownerType, entityId: input.ownerId });
    throw badRequest('malware_detected', 'تعذر قبول الملف بعد الفحص الأمني', 'The file was rejected by the security scan');
  }

  // Re-uploading the same category supersedes the prior version rather than replacing it.
  const previous = get<{ version: number }>(
    `SELECT MAX(version) AS version FROM documents WHERE owner_type = ? AND owner_id = ? AND category = ?`,
    [input.ownerType, input.ownerId, input.category],
  );
  const version = (previous?.version ?? 0) + 1;

  const id = newId();
  /* The key is built from server-controlled values only. It used to carry
     `category`, a caller-supplied string with no charset constraint, straight
     into path.join — see the note on resolvePath in storage.ts. The category
     is a property of the document, not of where its bytes live, and it is
     already recorded in the column below (and read by the MAX(version) lookup
     above), so nothing is lost by keeping it there. */
  const stored = putObject(`${input.ownerType}/${input.ownerId}/${id}-v${version}`, data);
  run(
    `INSERT INTO documents (id, owner_type, owner_id, category, file_name, mime_type, size_bytes, storage_key,
                            checksum, version, expires_on, malware_scan, visibility, uploaded_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'clean', ?,?,?)`,
    [id, input.ownerType, input.ownerId, input.category, input.fileName, input.mimeType, stored.sizeBytes,
     stored.key, stored.checksum, version, input.expiresOn ?? null, input.visibility ?? 'internal',
     input.uploadedBy, nowIso()],
  );
  audit({ actorId: input.uploadedBy, action: 'document.uploaded', entityType: 'document', entityId: id,
          after: { ownerType: input.ownerType, ownerId: input.ownerId, category: input.category, version } });

  return { documentId: id, version, checksum: stored.checksum, sizeBytes: stored.sizeBytes };
}

export function listDocuments(ownerType: string, ownerId: string, visibility?: string[]) {
  const rows = all<any>(
    `SELECT id, category, file_name, mime_type, size_bytes, version, expires_on, visibility, created_at
       FROM documents WHERE owner_type = ? AND owner_id = ?
       ${visibility ? `AND visibility IN (${visibility.map(() => '?').join(',')})` : ''}
      ORDER BY category, version DESC`,
    visibility ? [ownerType, ownerId, ...visibility] : [ownerType, ownerId],
  );
  return rows;
}

/** FR-206 — every view or download is logged, including denials. */
export function readDocument(documentId: string, userId: string, allowed: boolean, ip?: string | null) {
  const doc = get<any>(`SELECT * FROM documents WHERE id = ?`, [documentId]);
  if (!doc) throw notFound();

  run(`INSERT INTO document_access_log (id, document_id, user_id, action, ip, created_at) VALUES (?,?,?,?,?,?)`,
      [newId(), documentId, userId, allowed ? 'download' : 'denied', ip ?? null, nowIso()]);

  if (!allowed) throw forbidden('هذا الملف متاح للمستثمرين المؤهلين فقط', 'This file is restricted to eligible investors');

  const data = getObject(doc.storage_key);
  if (!data) throw notFound();
  return { doc, data };
}
