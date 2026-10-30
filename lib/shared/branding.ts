/**
 * The platform's and the municipality's names in the visitor's language:
 * "Elbasani Raporton / Bashkia Elbasan" in Albanian, "Elbasan Reports /
 * Municipality of Elbasan" in English. The admin can change both pairs at
 * /admin/appearance; an empty English name falls back to the Albanian one.
 */
import type { Branding } from './types';

export function brandNames(branding: Branding, lang: string): { app: string; municipality: string } {
  if (lang === 'en') {
    return { app: branding.appNameEn || branding.appName, municipality: branding.municipalityNameEn || branding.municipalityName };
  }
  return { app: branding.appName, municipality: branding.municipalityName };
}
