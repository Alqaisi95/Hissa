import crypto from 'node:crypto';

export const newId = (): string => crypto.randomUUID();

/** Human-readable business reference, e.g. POOL-2026-0007. */
export function makeReference(prefix: string, sequence: number, year = new Date().getUTCFullYear()): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

export const nowIso = (): string => new Date().toISOString();

export function plus(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export const hours = (n: number) => n * 3_600_000;
export const days = (n: number) => n * 86_400_000;
export const minutes = (n: number) => n * 60_000;

/** Presentation helper — Asia/Muscat is UTC+4 with no DST. */
export function toMuscat(iso: string): string {
  return new Date(new Date(iso).getTime() + hours(4)).toISOString().replace('Z', '+04:00');
}
