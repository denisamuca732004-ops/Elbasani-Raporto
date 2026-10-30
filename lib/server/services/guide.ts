/**
 * The search guide ("Ask or search"): the questions and answers residents
 * get while typing in the search box at the top of the menu, on every page.
 * The public list (active entries only) is cached; every admin change clears
 * the cache, so an edit or a hidden question shows on the site at once.
 */
import 'server-only';
import type { GuideItem } from '@/lib/shared/guide';
import type { Principal } from '@/lib/shared/types';
import type { GuideEntryInput, GuideEntryPatch } from '@/lib/validation/admin';
import { CACHE_KEYS, cached, invalidate } from '../cache';
import { Prisma, db } from '../db';
import { notFound } from '../errors';
import { assertAdmin } from './access';

const TTL_SECONDS = 3600;
const ORDER = [{ sortOrder: 'asc' }, { id: 'asc' }] satisfies Prisma.GuideEntryOrderByWithRelationInput[];

type Row = Awaited<ReturnType<typeof db.guideEntry.findFirstOrThrow>>;

const toItem = (r: Row): GuideItem => ({
  id: r.id,
  questionSq: r.questionSq,
  questionEn: r.questionEn,
  answerSq: r.answerSq,
  answerEn: r.answerEn,
  keywords: r.keywords,
  action: r.action,
  emergency: r.emergency,
});

/** What residents see: active entries, in the admin's order. */
export async function getGuide(): Promise<GuideItem[]> {
  return cached(CACHE_KEYS.guide, TTL_SECONDS, async () =>
    (await db.guideEntry.findMany({ where: { active: true }, orderBy: ORDER })).map(toItem));
}

export async function invalidateGuide(): Promise<void> {
  await invalidate(CACHE_KEYS.guide);
}

export type GuideAdminRow = GuideItem & { code: string | null; sortOrder: number; active: boolean; updatedAt: string };

export async function listGuideEntries(admin: Principal): Promise<GuideAdminRow[]> {
  assertAdmin(admin);
  const rows = await db.guideEntry.findMany({ orderBy: [{ active: 'desc' }, ...ORDER] });
  return rows.map((r) => ({ ...toItem(r), code: r.code, sortOrder: r.sortOrder, active: r.active, updatedAt: r.updatedAt.toISOString() }));
}

export async function createGuideEntry(admin: Principal, input: GuideEntryInput): Promise<GuideItem> {
  assertAdmin(admin);
  const row = await db.guideEntry.create({ data: { ...input, keywords: input.keywords ?? null } });
  await invalidateGuide();
  return toItem(row);
}

/** Only the fields that were sent change; the others keep their value. */
export async function updateGuideEntry(admin: Principal, id: number, input: GuideEntryPatch): Promise<GuideItem> {
  assertAdmin(admin);
  try {
    const row = await db.guideEntry.update({
      where: { id },
      data: { ...input, ...('keywords' in input ? { keywords: input.keywords ?? null } : {}) },
    });
    await invalidateGuide();
    return toItem(row);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw notFound('Pyetja nuk u gjet.');
    throw err;
  }
}
