'use client';
/**
 * The public map of reports (design v2): the filters on top (status: all / received / being
 * fixed / fixed, the area, the category), the map on the left and, next to it, the list of the
 * same reports with a search ("street, number or problem") and the order (newest / oldest first).
 * Every report of the last 180 days is on the page, so the filters work at once; they are kept in
 * the address (?status=&zone=&category=) so a filtered map can be shared.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { CasesMap } from '@/components/maps';
import { useCatalog } from '@/components/providers';
import { TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { timeAgo } from '@/lib/client/format';
import { MAP_STATUSES, mapStatusOf, type MapStatus } from '@/lib/shared/domain';
import type { MapPoint, PublicCard } from '@/lib/shared/types';

const STATUS_KEY: Record<MapStatus, 'received' | 'working' | 'fixed'> = { RECEIVED: 'received', IN_PROGRESS: 'working', RESOLVED: 'fixed' };
const PAGE = 50;

interface Item {
  caseNumber: string;
  status: MapStatus;
  typeSq: string | null;
  typeEn: string | null;
  categoryCode: string | null;
  zoneId: number | null;
  place: string | null;
  createdAt: string;
  isTest: boolean;
  /** A point on the map (else: a typed address the staff has not placed yet). */
  point: MapPoint | null;
}

/** Lower case, without accents: "Rruga Qemal Stafa" is found by "qemal" and "gropë" by "grope". */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function StatusMark({ status }: { status: MapStatus }) {
  return <span className={`status-mark ${STATUS_KEY[status]}`} aria-hidden="true">{status === 'RESOLVED' && <Icon name="check" size={10} strokeWidth={3.5} />}</span>;
}

export default function MapPage({ points, unplaced = [], initial }: {
  points: MapPoint[] | null; unplaced?: PublicCard[];
  initial: { status: MapStatus | null; category: string; zone: number | null };
}) {
  const { t, lang } = useI18n();
  const { catalog } = useCatalog();
  const pathname = usePathname();
  const [status, setStatus] = useState<MapStatus | null>(initial.status);
  const [category, setCategory] = useState(initial.category);
  const [zone, setZone] = useState<number | null>(initial.zone);
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');
  const [shown, setShown] = useState(PAGE);

  // The filters live in the address, so the same view can be shared.
  useEffect(() => {
    const qs = new URLSearchParams({
      ...(status ? { status: status.toLowerCase() } : {}), ...(zone ? { zone: String(zone) } : {}), ...(category ? { category } : {}),
    });
    window.history.replaceState(null, '', qs.size ? `${pathname}?${qs}` : pathname);
    setShown(PAGE);
  }, [status, zone, category, pathname]);

  const items = useMemo<Item[]>(() => {
    const zoneIdByName = new Map(catalog.neighbourhoods.map((n) => [n.name, n.id]));
    const fromPoints = (points ?? []).flatMap((p): Item[] => {
      const s = mapStatusOf(p.publicStatus);
      return s ? [{
        caseNumber: p.caseNumber, status: s, typeSq: p.typeNameSq, typeEn: p.typeNameEn, categoryCode: p.categoryCode,
        zoneId: p.zoneId, place: p.place, createdAt: p.createdAt, isTest: p.isTest, point: p,
      }] : [];
    });
    const fromUnplaced = unplaced.flatMap((u): Item[] => {
      const s = mapStatusOf(u.publicStatus);
      return s ? [{
        caseNumber: u.caseNumber, status: s, typeSq: u.type?.nameSq ?? null, typeEn: u.type?.nameEn ?? null, categoryCode: u.category?.code ?? null,
        zoneId: u.neighbourhood ? zoneIdByName.get(u.neighbourhood) ?? null : null,
        place: [u.address, u.neighbourhood].filter(Boolean).join(' · ') || null, createdAt: u.createdAt, isTest: u.isTest, point: null,
      }] : [];
    });
    return [...fromPoints, ...fromUnplaced];
  }, [points, unplaced, catalog.neighbourhoods]);

  const filtered = useMemo(() => {
    const words = fold(q.trim()).split(/\s+/).filter(Boolean);
    const list = items.filter((it) =>
      (!status || it.status === status)
      && (!category || it.categoryCode === category)
      && (!zone || it.zoneId === zone)
      && (!words.length || words.every((w) => fold(`${it.caseNumber} ${it.typeSq ?? ''} ${it.typeEn ?? ''} ${it.place ?? ''}`).includes(w))));
    return list.sort((a, b) => (order === 'newest' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
  }, [items, status, category, zone, q, order]);
  const onMap = useMemo(() => filtered.flatMap((it) => (it.point ? [it.point] : [])), [filtered]);

  return (
    <div className="page map-page">
      <div className="container">
        <h1>{t('map.title')}</h1>
        <div className="map-filters">
          <div>
            <span className="label" id="m-status">{t('map.status')}</span>
            <div className="status-toggle" role="group" aria-labelledby="m-status">
              <button type="button" aria-pressed={status === null} onClick={() => setStatus(null)}>{t('map.all')}</button>
              {MAP_STATUSES.map((s) => (
                <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(status === s ? null : s)}>
                  <StatusMark status={s} />{t(`map.groups.${STATUS_KEY[s]}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="m-zone">{t('map.zone')}</label>
            <select id="m-zone" value={zone ?? ''} onChange={(e) => setZone(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('map.allZones')}</option>
              {catalog.neighbourhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-cat">{t('map.category')}</label>
            <select id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t('map.allCategories')}</option>
              {catalog.categories.map((c) => <option key={c.code} value={c.code}>{lang === 'en' ? c.nameEn : c.nameSq}</option>)}
            </select>
          </div>
        </div>

        {points === null && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
        {points !== null && (
          <div className="map-layout">
            <div className="map-col">
              <CasesMap points={onMap} />
              <div className="map-key">
                {MAP_STATUSES.map((s) => <span key={s}><StatusMark status={s} />{t(`map.groups.${STATUS_KEY[s]}`)}</span>)}
                <span><span className="status-mark approx" aria-hidden="true" />{t('map.approximate')}</span>
              </div>
              <p className="hint">{t('map.keyNote')}</p>
            </div>

            <section className="map-list" aria-label={t('map.listLabel')}>
              <div className="map-list-tools">
                <div className="map-search">
                  <Icon name="search" size={20} />
                  <label htmlFor="m-q" className="sr-only">{t('map.search')}</label>
                  <input id="m-q" type="search" value={q} maxLength={80} placeholder={t('map.search')} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
                </div>
                <label htmlFor="m-order" className="sr-only">{t('map.order')}</label>
                <select id="m-order" value={order} onChange={(e) => setOrder(e.target.value as 'newest' | 'oldest')}>
                  <option value="newest">{t('map.newest')}</option>
                  <option value="oldest">{t('map.oldest')}</option>
                </select>
              </div>
              <p className="map-list-count" aria-live="polite">{t('map.listCount', { n: filtered.length })}</p>
              <div className="map-list-scroll">
                {filtered.length === 0 && <p className="muted">{t('map.none')}</p>}
                <ul>
                  {filtered.slice(0, shown).map((it) => (
                    <li key={it.caseNumber}>
                      <Link href={`/ndiq/${it.caseNumber}`} className="map-card">
                        <span className="map-card-head">
                          <strong>{(lang === 'en' ? it.typeEn : it.typeSq) ?? it.caseNumber}</strong>
                          <span className={`status-pill ${STATUS_KEY[it.status]}`}><StatusMark status={it.status} />{t(`map.groups.${STATUS_KEY[it.status]}`)}</span>
                        </span>
                        <span className="map-card-meta">
                          {it.place && <span>{it.place}</span>}
                          <span className="nowrap">{it.caseNumber}</span>
                          <span className="nowrap">{timeAgo(it.createdAt, t)}</span>
                          {!it.point && <span className="nowrap">{t('map.notPlaced')}</span>}
                          <TestBadge show={it.isTest} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {filtered.length > shown && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setShown(shown + PAGE)}>{t('map.more')}</button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
