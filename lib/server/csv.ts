/**
 * RFC 4180 CSV with a UTF-8 BOM, so Excel shows Albanian letters correctly.
 * Text that starts like a formula (= + - @) gets a leading apostrophe, so a
 * resident's text can never run as a formula in Excel ("CSV injection").
 */
export type CsvColumn<T> = { label: string; value: (row: T) => unknown };

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((c) => cell(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => cell(c.value(row))).join(','));
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}
