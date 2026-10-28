/** Small geographic helpers (no PostGIS needed for city-scale distances). */
import { zoneCodeAt } from '@/lib/shared/zones';
import { db } from '../db';
import { config } from '../env';

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Bounding box that contains a circle of `meters` around a point (fast index pre-filter). */
export function boundingBox(lat: number, lng: number, meters: number) {
  const dLat = (meters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos(toRad(lat));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/** Public coordinates are rounded to about 10 m so exact home positions are not exposed. */
export function roundCoord(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : Math.round(value * 1e4) / 1e4;
}

export function insideServiceArea(latitude: number, longitude: number): boolean {
  const a = config().rules.serviceArea;
  return latitude >= a.minLat && latitude <= a.maxLat && longitude >= a.minLng && longitude <= a.maxLng;
}

/** Inside the Municipality: the configured box AND the border of one of its zones (lib/shared/zones.ts). */
export function insideMunicipality(latitude: number, longitude: number): boolean {
  return insideServiceArea(latitude, longitude) && zoneCodeAt(latitude, longitude) !== null;
}

/** The active zone a point belongs to, found from the zone borders (null outside, or if that zone was deactivated). */
export async function zoneOfPoint(latitude: number, longitude: number): Promise<{ id: number; name: string } | null> {
  const code = zoneCodeAt(latitude, longitude);
  if (!code) return null;
  return db.neighbourhood.findFirst({ where: { code, active: true }, select: { id: true, name: true } });
}

/** Centre of Elbasan, used for sample data and as the default map position. */
export const ELBASAN_CENTER = { latitude: 41.1125, longitude: 20.0822 } as const;
