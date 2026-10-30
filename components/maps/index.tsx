'use client';
/**
 * Maps are drawn only in the browser (Leaflet needs `window`); while the map
 * code loads, an empty box of the same size keeps the page from jumping.
 */
import dynamic from 'next/dynamic';
import { useI18n } from '@/i18n';
import { key } from '@/lib/client/format';
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

export function MapLegend() {
  const { t } = useI18n();
  return (
    <div className="legend">
      {['RECEIVED', 'OPEN', 'IN_PROGRESS', 'RESOLVED'].map((s) => (
        <span key={s}><i style={{ background: STATUS_COLORS[key(s)], borderRadius: '50%' }} />{t(`status.${key(s)}`)}</span>
      ))}
      <span><i className="legend-approx" />{t('map.approximate')}</span>
    </div>
  );
}
