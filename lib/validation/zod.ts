/**
 * Zod helpers: Albanian error messages and one error format for every form.
 * Server Actions call parseInput() before anything touches the database.
 */
import { z } from 'zod';
import type { FieldError } from '@/lib/shared/result';

type Issue = z.core.$ZodRawIssue;

/** Albanian messages for the issues that can reach a person filling a form. */
const MISSING_CODES = new Set(['invalid_type', 'invalid_value', 'invalid_union']);
const isMissing = (issue: { code?: string; input?: unknown }) =>
  MISSING_CODES.has(issue.code ?? '') && (issue.input === undefined || issue.input === null);

export const albanianErrors: z.core.$ZodErrorMap = (issue: Issue) => {
  if (isMissing(issue)) return 'Kjo fushë është e detyrueshme.';
  switch (issue.code) {
    case 'invalid_type':
      return 'Vlera nuk është e saktë.';
    case 'too_small':
      if (issue.origin === 'string') return `Duhet të ketë të paktën ${issue.minimum} shkronja.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Zgjidhni të paktën ${issue.minimum}.`;
      return `Vlera duhet të jetë të paktën ${issue.minimum}.`;
    case 'too_big':
      if (issue.origin === 'string') return `Mund të ketë deri në ${issue.maximum} shkronja.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Lejohen deri në ${issue.maximum}.`;
      return `Vlera duhet të jetë deri në ${issue.maximum}.`;
    case 'invalid_format':
      if (issue.format === 'email') return 'Emaili nuk është i saktë.';
      return 'Formati nuk është i saktë.';
    case 'invalid_value':
      return 'Zgjidhni një nga vlerat e lejuara.';
    case 'unrecognized_keys':
      return `Fusha të panjohura: ${issue.keys.join(', ')}.`;
    default:
      return 'Vlera nuk është e saktë.';
  }
};

function codeOf(issue: z.core.$ZodIssue): string {
  if (isMissing(issue)) return 'required';
  if (issue.code === 'too_small') return 'too_short';
  if (issue.code === 'too_big') return 'too_long';
  if (issue.code === 'unrecognized_keys') return 'unknown_field';
  if (issue.code === 'custom' && typeof issue.params?.code === 'string') return issue.params.code;
  return 'invalid';
}

export function fieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.') || (issue.code === 'unrecognized_keys' ? issue.keys.join(',') : ''),
    code: codeOf(issue),
    message: issue.message,
  }));
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: FieldError[] };

/** Validates without throwing. */
export function check<S extends z.ZodType>(schema: S, input: unknown): ParseResult<z.output<S>> {
  const result = schema.safeParse(input, { error: albanianErrors, reportInput: true });
  return result.success ? { ok: true, data: result.data } : { ok: false, errors: fieldErrors(result.error) };
}

/* ── Reusable pieces ── */

/** Trims, and turns "" into undefined, so empty optional fields are simply absent. */
export const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v), z.string().max(max).optional());
export const requiredText = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(min).max(max));
/** Collapses runs of spaces too: names, addresses. */
export const singleLine = (min: number, max: number) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v), z.string().min(min).max(max));
export const email = z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.email().max(200));
export const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().toLowerCase()) : v ?? undefined),
  z.email().max(200).optional(),
);
export const phone = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().replace(/\s+/g, ' ')) : v ?? undefined),
  z
    .string()
    .max(40)
    .regex(/^[0-9 +()-]+$/)
    .refine((s) => s.replace(/\D/g, '').length >= 6, { params: { code: 'invalid' } })
    .optional(),
);
export const id = z.coerce.number().int().min(1);
export const nullableId = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(1).nullable());
export const uuid = z.uuid();
export const latitude = z.coerce.number().min(-90).max(90);
export const longitude = z.coerce.number().min(-180).max(180);
export const password = z.string().min(8).max(128);
/** "true"/"1"/true → true, anything else → false. For query strings and checkboxes. */
export const flag = z.preprocess((v) => v === true || v === 'true' || v === '1' || v === 'on', z.boolean());
