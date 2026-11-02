'use client';
/**
 * Maps are drawn only in the browser (Leaflet needs `window`); while the map
 * code loads, an empty box of the same size keeps the page from jumping.
 */
import dynamic from 'next/dynamic';
import { useI18n } from '@/i18n';
import { key } from '@/lib/client/format';
import { MAP_STATUSES, type MapStatus } from '@/lib/shared/domain';
import type { CasesMapProps, LocationPickerProps, MiniMapProps } from './LeafletMaps';
import { STATUS_COLORS } from './colors';

const placeholder = (className: string, height?: number) => {
  function MapPlaceholder() {
    return <div className={className} style={height ? { height } : undefined} aria-hidden="true" />;
  }
  return MapPlaceholder;
};

export const LocationPicker = dynamic<LocationPickerProps>(() => import('./LeafletMaps').then((m) => m.LocationPicker), {
  ssr: false, loading: placeholder('map-box'),
});
export const CasesMap = dynamic<CasesMapProps>(() => import('./LeafletMaps').then((m) => m.CasesMap), {
  ssr: false, loading: placeholder('map-box tall'),
});
const LazyMiniMap = dynamic<MiniMapProps>(() => import('./LeafletMaps').then((m) => m.MiniMap), {
  ssr: false, loading: placeholder('map-box', 220),
});
export function MiniMap(props: MiniMapProps) {
  return props.latitude === null || props.longitude === null ? null : <LazyMiniMap {...props} />;
}

/**
 * The legend of the map, clickable: each status (with its colour and how many reports are in it)
 * shows only those reports; pressed again, or "Të gjitha", shows them all.
 */
export function MapLegend({ counts, total, selected, onSelect }: {
  counts: Record<MapStatus, number>; total: number; selected: MapStatus | null; onSelect: (s: MapStatus | null) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="legend status-chips" role="group" aria-label={t('map.status')}>
      <button type="button" aria-pressed={selected === null} onClick={() => onSelect(null)}>
        {t('map.all')} <span className="chip-count">{total}</span>
      </button>
      {MAP_STATUSES.map((s) => (
        <button key={s} type="button" aria-pressed={selected === s} onClick={() => onSelect(selected === s ? null : s)}>
          <i style={{ background: STATUS_COLORS[key(s)], borderRadius: '50%' }} />{t(`status.${key(s)}`)} <span className="chip-count">{counts[s]}</span>
        </button>
      ))}
      <span className="legend-approx-note"><i className="legend-approx" />{t('map.approximate')}</span>
    </div>
  );
}
