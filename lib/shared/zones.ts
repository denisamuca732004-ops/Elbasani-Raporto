/**
 * The 13 administrative units ("zones") of the Municipality of Elbasan and
 * their borders, so the zone of a point on the map is found automatically:
 * a resident who uses GPS or taps the map never has to choose it, and can
 * never choose the wrong one.
 *
 * Borders: lib/shared/data/elbasan-zones.json, built by scripts/build-zones.py
 * from geoBoundaries (OpenStreetMap, © OpenStreetMap contributors, ODbL 1.0),
 * simplified to about 20 m. Points in the thin strips the simplification
 * leaves along a border go to the nearest zone (up to BORDER_TOLERANCE_M).
 *
 * Runs on the server and in the browser (9 KB gzipped), also offline.
 */
import data from './data/elbasan-zones.json';

type Ring = number[][]; // [longitude, latitude] pairs, first = last
type Polygon = Ring[]; // outer ring, then holes
interface ZoneShape { code: string; name: string; polygons: Polygon[] }

const SHAPES = (data as { zones: ZoneShape[] }).zones;

/** The codes of the zones that have a border (neighbourhoods.code). */
export const ZONE_CODES: readonly string[] = SHAPES.map((z) => z.code);

/** A point this close (in metres) to a zone, but outside every zone, still belongs to it. */
export const BORDER_TOLERANCE_M = 150;

function insideRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insidePolygon(lng: number, lat: number, polygon: Polygon): boolean {
  const [outer, ...holes] = polygon;
  return !!outer && insideRing(lng, lat, outer) && !holes.some((h) => insideRing(lng, lat, h));
}

/** Distance in metres from a point to the nearest edge of a zone (flat-earth, fine at this scale). */
function distanceToEdges(lng: number, lat: number, shape: ZoneShape): number {
  const mPerLat = 111_320;
  const mPerLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const polygon of shape.polygons) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [x1, y1] = ring[i] as [number, number];
        const [x2, y2] = ring[i + 1] as [number, number];
        const ax = (x1 - lng) * mPerLng; const ay = (y1 - lat) * mPerLat;
        const bx = (x2 - lng) * mPerLng; const by = (y2 - lat) * mPerLat;
        const dx = bx - ax; const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
}

/**
 * The code of the zone that contains the point ("elbasan", "gjinar", …), or
 * null when the point is outside the Municipality.
 */
export function zoneCodeAt(latitude: number, longitude: number): string | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  for (const shape of SHAPES) {
    if (shape.polygons.some((p) => insidePolygon(longitude, latitude, p))) return shape.code;
  }
  let nearest: { code: string; d: number } | null = null;
  for (const shape of SHAPES) {
    const d = distanceToEdges(longitude, latitude, shape);
    if (d <= BORDER_TOLERANCE_M && (!nearest || d < nearest.d)) nearest = { code: shape.code, d };
  }
  return nearest?.code ?? null;
}

/** Roughly the middle of a zone (centroid of its largest part), to centre a map on it. */
export function zoneCenter(code: string): { latitude: number; longitude: number } | null {
  const shape = SHAPES.find((z) => z.code === code);
  const outer = shape?.polygons.map((p) => p[0]!).sort((a, b) => b.length - a.length)[0];
  if (!outer) return null;
  let area = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < outer.length - 1; i += 1) {
    const [x1, y1] = outer[i] as [number, number];
    const [x2, y2] = outer[i + 1] as [number, number];
    const f = x1 * y2 - x2 * y1;
    area += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  return area ? { latitude: cy / (3 * area), longitude: cx / (3 * area) } : null;
}

/** Lower case, without accents and punctuation: "Kodër Bujaras" → "koder bujaras". */
const plain = (s: string) => ` ${s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Village names that are also everyday words, so they are never treated as a place in free text. */
const COMMON_WORDS = new Set(['thane', 'korre', 'kala', 'qafe', 'bene']);

export interface ZonePlaces {
  id: number;
  name: string;
  code: string | null;
  localities: Array<{ id: number; name: string }>;
}

/** The zone of the city; its lagje carry names of people and dates ("Skënderbej", "5 Maji"). */
export const CITY_ZONE_CODE = 'elbasan';

/**
 * For an address typed by hand: a place of ANOTHER zone named in the text
 * ("fshati Lleshan" while the zone is the city), so the resident is told to
 * choose the right zone. Zone names and village names of 5+ letters count.
 * "Elbasan" and the lagje of the city do not: their names (people, dates)
 * are also the names of schools and streets in the villages.
 */
export function otherZonePlace(text: string, zoneId: number, zones: ZonePlaces[]): { place: string; zone: string } | null {
  const haystack = plain(text);
  const chosen = zones.find((z) => z.id === zoneId);
  const ownNames = new Set([chosen?.name ?? '', ...(chosen?.localities.map((l) => l.name) ?? [])].map((n) => plain(n)));
  for (const zone of zones) {
    if (zone.id === zoneId) continue;
    const zoneName = zone.name.replace(/\s*\(.*\)\s*$/, '');
    const places = zone.code === CITY_ZONE_CODE ? [] : zone.localities.map((l) => l.name);
    for (const name of [zoneName, ...places]) {
      const key = plain(name);
      const bare = key.trim();
      if (bare.length < 5 || /^\d/.test(bare) || bare === 'elbasan' || COMMON_WORDS.has(bare) || ownNames.has(key)) continue;
      if (haystack.includes(key)) return { place: name, zone: zone.name };
    }
  }
  return null;
}
