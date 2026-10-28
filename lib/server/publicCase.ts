/** Looks up a case for the public pages; a malformed or unknown number is "not found", never an error page. */
import 'server-only';
import type { CaseLookup } from '@/components/public/Track';
import { caseNumber as caseNumberSchema } from '@/lib/validation/report';
import { AppError } from './errors';
import { getPublicCase } from './services/publicReport';

export async function lookupCase(raw: string): Promise<CaseLookup> {
  const decoded = decodeURIComponent(raw).slice(0, 40);
  const parsed = caseNumberSchema.safeParse(decoded);
  if (!parsed.success) return { found: false, caseNumber: decoded };
  try {
    return { found: true, data: await getPublicCase(parsed.data) };
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return { found: false, caseNumber: parsed.data };
    console.error('[track] lookup failed', err);
    return { found: false, caseNumber: parsed.data, error: true };
  }
}
