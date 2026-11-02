/**
 * Address search for the "Vendndodhja" field of the report form, and the
 * address of a point on the map (when the pin is placed or dragged), from
 * OpenStreetMap data through a Photon server (GEOCODER_URL, by default the
 * public photon.komoot.io; "off" turns it off).
 *
 *  - Asked by OUR server, never by the browser: the resident's position is not
 *    sent to a third party with their IP, and the page keeps its strict CSP.
 *  - Only places inside the Municipality (the zone borders) are returned.
 *  - Answers are cached (a search for a week, a point for a month), so the
 *    public service is asked rarely; requests are rate-limited per IP too.
 *  - When the service is slow or down, nothing fails: the search still finds
 *    the lagje and villages (lib/shared/places.ts, in the browser) and the pin
 *    simply gets no street name. Failures are never cached.
 */
import 'server-only';
import { LIMITS } from '@/lib/shared/domain';
import { plainWords, type PlaceSuggestion } from '@/lib/shared/places';
import { cacheGet, cacheSet } from './cache';
import { config } from './env';
import { insideMunicipality } from './services/geo';

const USER_AGENT = 'ElbasaniRaporton/1.0 (civic reporting platform of the Municipality of Elbasan)';
const SEARCH_TTL = 7 * 86_400;
const REVERSE_TTL = 30 * 86_400;
const MAX_RESULTS = 6;

interface PhotonProperties {
  name?: string; street?: string; housenumber?: string; district?: string; locality?: string; city?: string; county?: string;
  type?: string; osm_key?: string; osm_value?: string;
}
interface PhotonFeature { geometry?: { type?: string; coordinates?: unknown }; properties?: PhotonProperties }

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** One request to the Photon server; null when it is off, slow or answers with an error. */
async function photon(path: '/api' | '/reverse', params: Record<string, string>): Promise<PhotonFeature[] | null> {
  const { url, timeoutMs } = config().geocoder;
  if (!url) return null;
  const target = new URL(`${url}${path}`);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  try {
    const res = await fetch(target, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { features?: unknown };
    return Array.isArray(body.features) ? (body.features as PhotonFeature[]) : [];
  } catch (err) {
    console.warn(`[geocoder] ${path} unavailable:`, (err as Error).message);
    return null;
  }
}

function pointOf(f: PhotonFeature): { latitude: number; longitude: number } | null {
  const c = f.geometry?.coordinates;
  if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
  return { latitude: Math.round(c[1] * 1e6) / 1e6, longitude: Math.round(c[0] * 1e6) / 1e6 };
}

/** "Rruga Qemal Stafa 12", "Shkolla 9-vjeçare, Rruga Kristoforidhi", "Rruga Qemal Stafa". */
function mainName(p: PhotonProperties): string {
  const name = text(p.name);
  const street = text(p.street);
  const number = text(p.housenumber);
  if (street && number) return name && name !== street ? `${name}, ${street} ${number}` : `${street} ${number}`;
  if (name && street && name !== street && p.osm_key !== 'highway') return `${name}, ${street}`;
  return name || street;
}

function kindOf(p: PhotonProperties): PlaceSuggestion['kind'] {
  if (p.type === 'house' || text(p.housenumber)) return 'house';
  if (p.type === 'street' || p.osm_key === 'highway') return 'street';
  return 'place';
}

/** The search result as the field shows it: the place, then where it is (lagje, village or town) unless already said. */
function searchLabel(p: PhotonProperties): string {
  const main = mainName(p);
  const where = [text(p.district), text(p.locality), text(p.city)].find((w) => w && !plainWords(main).includes(plainWords(w)));
  return [main, where].filter(Boolean).join(', ').slice(0, LIMITS.maxAddress);
}

/** Streets and places of the Municipality matching what was typed (OpenStreetMap). Empty when the service is off or down. */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const q = query.trim().replace(/\s+/g, ' ');
  if (plainWords(q).length < 3) return [];
  const key = `geo:search:v1:${plainWords(q)}`;
  const hit = await cacheGet<PlaceSuggestion[]>(key);
  if (hit) return hit;

  const area = config().rules.serviceArea;
  const features = await photon('/api', {
    q,
    limit: '15',
    bbox: `${area.minLng},${area.minLat},${area.maxLng},${area.maxLat}`,
    lat: '41.1125', lon: '20.0822', // results near the city first
  });
  if (!features) return [];
  const seen = new Set<string>();
  const results: PlaceSuggestion[] = [];
  for (const f of features) {
    const point = pointOf(f);
    const p = f.properties ?? {};
    const label = searchLabel(p);
    if (!point || !label || !insideMunicipality(point.latitude, point.longitude)) continue;
    const dedupe = plainWords(label);
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    results.push({ label, ...point, kind: kindOf(p) });
    if (results.length >= MAX_RESULTS) break;
  }
  await cacheSet(key, results, SEARCH_TTL);
  return results;
}

/**
 * The street (and number, or the name of the place) at a point of the Municipality, for the
 * "Vendndodhja" field after the pin is placed. null outside the Municipality, or when nothing is known.
 */
export async function placeAt(latitude: number, longitude: number): Promise<{ label: string | null }> {
  if (!insideMunicipality(latitude, longitude)) return { label: null };
  // About 11 m: points that close share the answer.
  const key = `geo:reverse:v1:${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const hit = await cacheGet<{ label: string | null }>(key);
  if (hit) return hit;
  const features = await photon('/reverse', { lat: String(latitude), lon: String(longitude), limit: '1', radius: '0.3' });
  if (!features) return { label: null };
  const p = features[0]?.properties;
  const result = { label: p ? mainName(p).slice(0, LIMITS.maxAddress) || null : null };
  await cacheSet(key, result, REVERSE_TTL);
  return result;
}
