'use client';
/** Public map of reports. Filters live in the address (?status=&category=), so a filtered map can be shared. */
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { CasesMap, MapLegend } from '@/components/maps';
import { useCatalog } from '@/components/providers';
import { Spinner } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { MapPoint } from '@/lib/shared/types';

export default function MapPage({ points, status, category }: { points: MapPoint[] | null; status: string; category: string }) {
  const { t, lang } = useI18n();
  const { catalog } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function setFilter(next: { status?: string; category?: string }) {
    const qs = new URLSearchParams({ status: next.status ?? status, ...((next.category ?? category) ? { category: next.category ?? category } : {}) });
    startTransition(() => router.replace(`${pathname}?${qs}`, { scroll: false }));
  }

  return (
    <div className="page">
      <div className="container stack">
        <h1>{t('map.title')}</h1>
        <div className="filters">
          <div className="field">
            <label htmlFor="m-status">{t('map.status')}</label>
            <select id="m-status" value={status} onChange={(e) => setFilter({ status: e.target.value })}>
              <option value="open">{t('map.open')}</option>
              <option value="closed">{t('map.closed')}</option>
              <option value="all">{t('map.all')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-cat">{t('map.category')}</label>
            <select id="m-cat" value={category} onChange={(e) => setFilter({ category: e.target.value })}>
              <option value="">{t('map.allCategories')}</option>
              {catalog.categories.map((c) => <option key={c.code} value={c.code}>{lang === 'en' ? c.nameEn : c.nameSq}</option>)}
            </select>
          </div>
          {points && <p className="muted" style={{ margin: 0 }}>{t('map.count', { n: points.length })}</p>}
        </div>
        <MapLegend />
        {points === null && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
        {pending ? <Spinner /> : points && <CasesMap points={points} />}
      </div>
    </div>
  );
}
