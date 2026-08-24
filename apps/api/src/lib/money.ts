// Money is OMR with 3 decimals (PRD §10.1). All arithmetic is on integer baisa;
// floats are never used in financial calculations.
export const BAISA_PER_OMR = 1000;

export type Baisa = number;

export function omr(value: number): Baisa {
  return Math.round(value * BAISA_PER_OMR);
}

export function toOmrString(amount: Baisa): string {
  const negative = amount < 0;
  const abs = Math.abs(Math.trunc(amount));
  const whole = Math.floor(abs / BAISA_PER_OMR);
  const frac = abs % BAISA_PER_OMR;
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}.${String(frac).padStart(3, '0')}`;
}

export function parseOmr(input: string | number): Baisa {
  const text = String(input).trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,3})?$/.test(text)) {
    throw new Error(`invalid OMR amount: ${input}`);
  }
  const negative = text.startsWith('-');
  const [whole, frac = ''] = text.replace('-', '').split('.');
  const baisa = Number(whole) * BAISA_PER_OMR + Number(frac.padEnd(3, '0'));
  return negative ? -baisa : baisa;
}

/** Integer percentage in basis points, rounded half-up. */
export function applyBps(amount: Baisa, bps: number): Baisa {
  return Math.round((amount * bps) / 10_000);
}

/**
 * Deterministic largest-remainder pro-rata split (FR-306, BR-017).
 * Guarantees `sum(result) === total` with no float drift, and is reproducible
 * for audit: ties break on the caller-supplied order.
 */
export function proRata(total: Baisa, weights: number[]): Baisa[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return weights.map(() => 0);

  const base = weights.map((w) => Math.floor((total * w) / weightSum));
  let remainder = total - base.reduce((a, b) => a + b, 0);

  const order = weights
    .map((w, i) => ({ i, rem: total * w - Math.floor((total * w) / weightSum) * weightSum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);

  for (const { i } of order) {
    if (remainder <= 0) break;
    base[i] += 1;
    remainder -= 1;
  }
  return base;
}
