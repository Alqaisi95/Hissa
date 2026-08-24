/** CSV serialisation for regulatory exports (FR-606). UTF-8 with a BOM so Excel renders Arabic. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '﻿';
  const headers = Object.keys(rows[0]);

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return `﻿${[headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\r\n')}`;
}
