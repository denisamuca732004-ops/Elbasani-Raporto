/**
 * Shared plumbing for Server Actions (not an action file itself).
 * Every action follows the same order:
 *   1. who is asking (requireStaff / requireAdmin, or a rate limit for the public),
 *   2. Zod validation of everything that came from the browser (parseInput),
 *   3. the service call (Prisma, Vercel Blob, emails queued for QStash),
 *   4. revalidation of the pages that show the changed data.
 * Errors come back as { ok: false, error } in Albanian, never as a stack trace.
 */
import 'server-only';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import { Prisma } from '@/lib/server/db';
import { AppError, invalid } from '@/lib/server/errors';
import type { ActionError, ActionResult } from '@/lib/shared/result';
import { check } from '@/lib/validation/zod';

export function toActionError(err: unknown): ActionError {
  if (err instanceof AppError) return err.toJSON();
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return { code: 'CONFLICT', message: 'Kjo vlerë përdoret tashmë.', status: 409 };
    if (err.code === 'P2025') return { code: 'NOT_FOUND', message: 'Nuk u gjet.', status: 404 };
    if (err.code === 'P2003') return { code: 'CONFLICT', message: 'Ky element përdoret ende diku tjetër.', status: 409 };
  }
  console.error('[action] unexpected error', err);
  return { code: 'INTERNAL', message: 'Diçka shkoi keq. Provoni përsëri.', status: 500 };
}

/** Runs the action body and turns any error into { ok: false }. Next.js redirects pass through. */
export async function run<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await body() };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: toActionError(err) };
  }
}

/** Zod validation; throws a VALIDATION_ERROR with one entry per field. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = check(schema, input);
  if (!result.ok) throw invalid(result.errors);
  return result.data;
}

/** The visitor's IP address, for rate limits (Vercel sets x-forwarded-for). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}
