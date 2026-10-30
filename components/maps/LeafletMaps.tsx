'use client';
/** Leaflet maps: a pin picker for reporting and a map of public cases. Loaded only in the browser (see ./index.tsx). */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import Icon from '@/components/Icon';
import { useSettings } from '@/components/providers';
import { useI18n } from '@/i18n';
import { ELBASAN_CENTER, formatDate, insideArea, key, type LatLng } from '@/lib/client/format';
import type { MapPoint } from '@/lib/shared/types';
import { STATUS_COLORS } from './colors';

// Neutral attribution prefix (the OpenStreetMap credit stays, as its licence requires).
L.Control.Attribution.prototype.options.prefix = '<a href="https://leafletjs.com">Leaflet</a>';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const pinIcon = L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [30, 30], iconAnchor: [15, 30] });

function ClickToMove({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ latitude: e.latlng.lat, longitude: e.latlng.lng }) });
  return null;
}

function Recenter({ position }: { position: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView([position.latitude, position.longitude], Math.max(map.getZoom(), 17));
  }, [position, map]);
  return null;
}

export interface LocationPickerProps {
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  error?: string | null;
  /** Ask for the GPS position as soon as the map opens (when no pin is set yet). */
  autoLocate?: boolean;
  /** The pin is outside the Municipality (decided by the caller, e.g. from the zone borders). */
  outside?: boolean;
  /** Where the map opens when there is no pin yet (e.g. the middle of the chosen zone). */
  center?: LatLng | null;
}

export function LocationPicker({ value, onChange, error, autoLocate = false, outside, center }: LocationPickerProps) {
  const { t } = useI18n();
  const { rules } = useSettings();
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [centerOn, setCenterOn] = useState<LatLng | null>(null);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoError(t('report.gpsUnavailable'));
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        onChange(p);
        setCenterOn(p);
        setLocating(false);
      },
      () => {
        setGeoError(t('report.gpsDenied'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  // Once, when the map opens with no pin: the resident chose "my location".
  const asked = useRef(false);
  useEffect(() => {
    if (autoLocate && !value && !asked.current) {
      asked.current = true;
      useMyLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLocate]);

  const markerHandlers = useMemo(() => ({
    dragend: (e: L.DragEndEvent) => {
      const ll = (e.target as L.Marker).getLatLng();
      onChange({ latitude: ll.lat, longitude: ll.lng });
    },
  }), [onChange]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={useMyLocation} disabled={locating}>
          <Icon name="gps" size={18} />{locating ? t('report.locating') : t('report.useMyLocation')}
        </button>
        <span className="hint" style={{ margin: 0 }}>{t('report.mapHint')}</span>
      </div>
      {geoError && <div className="alert alert-warn">{geoError}</div>}
      {value && (outside ?? !insideArea(value, rules.serviceArea)) && <div className="alert alert-error" role="alert">{t('report.outsideArea')}</div>}
      <div className={`map-box${error ? ' has-error' : ''}`}>
        <MapContainer
          center={value ? [value.latitude, value.longitude] : center ? [center.latitude, center.longitude] : ELBASAN_CENTER}
          zoom={value ? 17 : center ? 13 : 14} style={{ height: '100%' }} scrollWheelZoom={false}
        >
          <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
          <ClickToMove onPick={onChange} />
          <Recenter position={centerOn} />
          {value && <Marker position={[value.latitude, value.longitude]} icon={pinIcon} draggable eventHandlers={markerHandlers} />}
        </MapContainer>
      </div>
      {error && <div className="field-error" role="alert"><Icon name="alert" size={14} />{error}</div>}
      {value && <p className="hint">{t('report.pinSet', { lat: value.latitude.toFixed(5), lng: value.longitude.toFixed(5) })}</p>}
    </div>
  );
}

export interface CasesMapProps { points: MapPoint[]; tall?: boolean; linkPrefix?: string }

export function CasesMap({ points, tall = true, linkPrefix = '/ndiq' }: CasesMapProps) {
  const { t, lang } = useI18n();
  return (
    <div className={`map-box${tall ? ' tall' : ''}`}>
      <MapContainer center={ELBASAN_CENTER} zoom={14} style={{ height: '100%' }}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        {points.map((p) => (
          <CircleMarker
            key={p.caseNumber}
            center={[p.latitude, p.longitude]}
            radius={8}
            // An approximate point (address typed by hand) has a dashed dark ring and a lighter fill.
            pathOptions={p.approximate
              ? { color: '#1B2A1B', weight: 2, dashArray: '3 3', fillColor: STATUS_COLORS[key(p.publicStatus)] ?? '#777', fillOpacity: 0.55 }
              : { color: '#fff', weight: 2, fillColor: STATUS_COLORS[key(p.publicStatus)] ?? '#777', fillOpacity: 0.95 }}
          >
            <Popup>
              <strong className="case-number">{p.caseNumber}</strong><br />
              {lang === 'en' ? p.typeNameEn : p.typeNameSq}<br />
              <span className="small">{t(`status.${key(p.publicStatus)}`)} · {formatDate(p.createdAt, lang)}</span><br />
              {p.approximate && <><span className="small muted">{t('map.approximateNote')}</span><br /></>}
              <Link href={`${linkPrefix}/${p.caseNumber}`}>{t('common.details')} →</Link>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

export interface MiniMapProps { latitude: number | null; longitude: number | null }

export function MiniMap({ latitude, longitude }: MiniMapProps) {
  if (latitude === null || longitude === null) return null;
  return (
    <div className="map-box" style={{ height: 220 }}>
      <MapContainer center={[latitude, longitude]} zoom={16} style={{ height: '100%' }} scrollWheelZoom={false} dragging={false} zoomControl={false}>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <Marker position={[latitude, longitude]} icon={pinIcon} />
      </MapContainer>
    </div>
  );
}
