/**
 * The report catalogue (categories → report types), the areas and the
 * active departments. Every citizen page needs it, so it is cached in Redis;
 * every admin change invalidates it immediately (invalidateCatalog).
 */
import 'server-only';
import type { Catalog, NamedRef } from '@/lib/shared/types';
import { CACHE_KEYS, cached, invalidate } from '../cache';
import { db } from '../db';

const TTL_SECONDS = 3600;

export async function invalidateCatalog(): Promise<void> {
  await invalidate(CACHE_KEYS.catalog, CACHE_KEYS.departments);
}

export async function getCatalog(): Promise<Catalog> {
  return cached(CACHE_KEYS.catalog, TTL_SECONDS, async () => {
    const [categories, neighbourhoods, departments] = await Promise.all([
      db.category.findMany({
        where: { active: true },
        include: { requestTypes: { where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      db.neighbourhood.findMany({
        where: { active: true },
        include: { localities: { where: { active: true }, select: { id: true, name: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      db.department.findMany({ where: { active: true }, orderBy: { nameSq: 'asc' } }),
    ]);
    return {
      categories: categories
        .filter((c) => c.requestTypes.length > 0)
        .map((c) => ({
          id: c.id,
          code: c.code,
          icon: c.icon,
          nameSq: c.nameSq,
          nameEn: c.nameEn,
          types: c.requestTypes.map((t) => ({ id: t.id, code: t.code, nameSq: t.nameSq, nameEn: t.nameEn, kind: t.kind, departmentId: t.departmentId })),
        })),
      neighbourhoods: neighbourhoods.map((n) => ({
        id: n.id,
        name: n.name,
        code: n.code,
        localities: [...n.localities].sort((a, b) => a.name.localeCompare(b.name, 'sq', { numeric: true })),
      })),
      departments: departments.map((d) => ({ id: d.id, code: d.code, nameSq: d.nameSq, nameEn: d.nameEn, description: d.description })),
    };
  });
}

/** Active departments, e.g. for the "suggest a department" and "move to" lists. Cached. */
export async function activeDepartments(): Promise<NamedRef[]> {
  return cached(CACHE_KEYS.departments, TTL_SECONDS, async () =>
    (await db.department.findMany({ where: { active: true }, orderBy: { nameSq: 'asc' } }))
      .map((d) => ({ id: d.id, code: d.code, nameSq: d.nameSq, nameEn: d.nameEn })));
}
