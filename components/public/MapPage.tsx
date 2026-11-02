'use client';
/**
 * Public map of reports. The category is chosen in the list; the statuses of the legend are
 * clickable (with how many reports each has), so a resident sees how the reports of that category
 * are going. Both live in the address (?category=&status=), so a filtered map can be shared.
 */
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { CasesMap, MapLegend } from '@/components/maps';
import { MAP_STATUSES, inMapStatus, type MapStatus } from '@/lib/shared/domain';
import { useCatalog } from '@/components/providers';
import { Spinner } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { MapPoint, PublicCard } from '@/lib/shared/types';
import { CaseCard } from './Cases';

export default function MapPage({ points, unplaced = [], status, category }: {
  points: MapPoint[] | null; unplaced?: PublicCard[]; status: MapStatus | null; category: string;
}) {
  const { t, lang } = useI18n();
  const { catalog } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<MapStatus | null>(status);

  const address = (next: { category: string; status: MapStatus | null }) => {
    const qs = new URLSearchParams({ ...(next.category ? { category: next.category } : {}), ...(next.status ? { status: next.status.toLowerCase() } : {}) });
    return qs.size ? `${pathname}?${qs}` : pathname;
  };
  // A new category is loaded from the server; a status only filters what is already on the page.
  function setCategory(next: string) {
    startTransition(() => router.replace(address({ category: next, status: selected }), { scroll: false }));
  }
  function selectStatus(next: MapStatus | null) {
    setSelected(next);
    window.history.replaceState(null, '', address({ category, status: next }));
  }

  const counts = useMemo(() => {
    const all = [...(points ?? []).map((p) => p.publicStatus), ...unplaced.map((u) => u.publicStatus)];
    return Object.fromEntries(MAP_STATUSES.map((s) => [s, all.filter((p) => inMapStatus(p, s)).length])) as Record<MapStatus, number>;
  }, [points, unplaced]);
  const visible = useMemo(() => (points && selected ? points.filter((p) => inMapStatus(p.publicStatus, selected)) : points), [points, selected]);
  const visibleUnplaced = selected ? unplaced.filter((u) => inMapStatus(u.publicStatus, selected)) : unplaced;

  return (
    <div className="page">
      <div className="container stack">
        <h1>{t('map.title')}</h1>
        <div className="filters">
          <div className="field">
            <label htmlFor="m-cat">{t('map.category')}</label>
            <select id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t('map.allCategories')}</option>
              {catalog.categories.map((c) => <option key={c.code} value={c.code}>{lang === 'en' ? c.nameEn : c.nameSq}</option>)}
            </select>
          </div>
          {visible && <p className="muted" style={{ margin: 0 }}>{t('map.count', { n: visible.length })}</p>}
        </div>
        {points && (
          <>
            <MapLegend counts={counts} total={points.length + unplaced.length} selected={selected} onSelect={selectStatus} />
            <p className="hint" style={{ marginTop: -4 }}>{t('map.statusHint')}</p>
          </>
        )}
        {points === null && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
        {pending ? <Spinner /> : visible && <CasesMap points={visible} />}
        {!pending && visibleUnplaced.length > 0 && (
          <section style={{ marginTop: 8 }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: 4 }}>{t('map.unplacedTitle', { n: visibleUnplaced.length })}</h2>
            <p className="small muted">{t('map.unplacedText')}</p>
            <div className="case-list">{visibleUnplaced.map((r) => <CaseCard key={r.caseNumber} item={r} />)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
