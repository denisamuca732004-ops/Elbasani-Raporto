/**
 * Data for server-rendered pages: settings and catalogue (with a safe
 * fallback so public pages still render if the database is briefly away),
 * and the signed-in staff member for /admin pages (redirects instead of
 * throwing, because a page cannot answer with JSON).
 */
import 'server-only';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { DEFAULT_SERVICE_AREA, LIMITS } from '@/lib/shared/domain';
import type { Catalog, Principal, PublicSettings } from '@/lib/shared/types';
import { config } from './env';
import { DEFAULT_SETTINGS } from './referenceData';
import { getCatalog } from './services/catalog';
import { getPublicSettings } from './services/settings';
import { getPrincipal } from './session';

export async function pageSettings(): Promise<PublicSettings> {
  // Every page is rendered per request (never while building), so the database is only touched at run time.
  await connection();
  try {
    return await getPublicSettings();
  } catch (err) {
    console.error('[page] settings unavailable', err);
    let maxUploadBytes = 8 * 1024 * 1024;
    try { maxUploadBytes = config().storage.maxBytes; } catch { /* configuration problem: keep the default */ }
    return {
      branding: DEFAULT_SETTINGS.branding,
      embed: DEFAULT_SETTINGS.embed,
      rules: { serviceArea: DEFAULT_SERVICE_AREA, minDescription: LIMITS.minDescription, minAddress: LIMITS.minAddress, maxUploadBytes },
    };
  }
}

export async function pageCatalog(): Promise<Catalog> {
  await connection();
  try {
    return await getCatalog();
  } catch (err) {
    console.error('[page] catalogue unavailable', err);
    return { categories: [], neighbourhoods: [], departments: [] };
  }
}

/** For /admin pages: signed in with a panel role and a permanent password. */
export async function pageStaff(path = '/admin'): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) redirect(`/hyrje?next=${encodeURIComponent(path)}`);
  if (principal.mustChangePassword) redirect('/hyrje/fjalekalimi');
  return principal;
}

/** For admin-only pages: a department head is sent back to the panel home. */
export async function pageAdmin(path = '/admin'): Promise<Principal> {
  const principal = await pageStaff(path);
  if (principal.role !== 'ADMIN') redirect('/admin');
  return principal;
}

/** Next.js searchParams → plain strings (first value of repeated keys). */
export function flatParams(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined && value !== '') out[k] = value;
  }
  return out;
}
