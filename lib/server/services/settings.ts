/** Branding and the embedding allow-list, stored in the database and cached. */
import 'server-only';
import type { AppSettings, Branding, PublicSettings } from '@/lib/shared/types';
import { LIMITS } from '@/lib/shared/domain';
import type { SettingsInput } from '@/lib/validation/admin';
import { CACHE_KEYS, cached, invalidate } from '../cache';
import { db } from '../db';
import { config } from '../env';
import { DEFAULT_SETTINGS } from '../referenceData';

export async function getSettings(): Promise<AppSettings> {
  return cached(CACHE_KEYS.settings, 600, async () => {
    const rows = await db.setting.findMany();
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, Record<string, unknown> | undefined>;
    const embed = stored.embed as { allowedOrigins?: string[] } | undefined;
    return {
      branding: { ...DEFAULT_SETTINGS.branding, ...(stored.branding as Partial<Branding> | undefined) },
      embed: { allowedOrigins: embed?.allowedOrigins ?? config().embedOrigins },
    };
  });
}

/** What the public website needs: branding plus the rules the forms check in the browser. */
export async function getPublicSettings(): Promise<PublicSettings> {
  const settings = await getSettings();
  const c = config();
  return {
    ...settings,
    rules: {
      serviceArea: c.rules.serviceArea,
      minDescription: LIMITS.minDescription,
      minAddress: LIMITS.minAddress,
      maxUploadBytes: c.storage.maxBytes,
    },
  };
}

export async function updateSettings(patch: SettingsInput): Promise<AppSettings> {
  const current = await getSettings();
  await db.$transaction(async (tx) => {
    if (patch.branding) {
      const value = { ...current.branding, ...patch.branding };
      await tx.setting.upsert({ where: { key: 'branding' }, create: { key: 'branding', value }, update: { value } });
    }
    if (patch.embed) {
      const value = { allowedOrigins: [...new Set(patch.embed.allowedOrigins)] };
      await tx.setting.upsert({ where: { key: 'embed' }, create: { key: 'embed', value }, update: { value } });
    }
  });
  await invalidate(CACHE_KEYS.settings);
  return getSettings();
}
