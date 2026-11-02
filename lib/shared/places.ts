/**
 * The "Vendndodhja" search of the report form, the part that needs no
 * internet: the lagje of the city and the villages of every zone. The server
 * adds streets and places from OpenStreetMap (lib/server/geocoder.ts).
 * The same wording is used for the address the server saves for a report
 * placed at a lagje or village, so the form and the panel say the same thing.
 */
import { CITY_ZONE_CODE, zoneCenter } from './zones';

/** Lower case, without ë / ç and other accents, punctuation as spaces. */
export function plainWords(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "Lagjja Kala" (city), "fshati Gracen" (village named like its zone), "fshati Lleshan, njësia Gjinar". */
export function localityPlace(zone: { name: string; code: string | null }, locality: { name: string }): string {
  if (zone.code === CITY_ZONE_CODE) return `Lagjja ${locality.name}`;
  if (plainWords(locality.name) === plainWords(zone.name)) return `fshati ${locality.name}`;
  return `fshati ${locality.name}, njësia ${zone.name}`;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface PlaceSuggestion {
  /** What the field shows once it is chosen. */
  label: string;
  latitude: number;
  longitude: number;
  /** A lagje or village of the Municipality (its point is approximate), or a street / place from OpenStreetMap. */
  kind: 'locality' | 'street' | 'house' | 'place';
  /** Only for a lagje or village: so an unchanged choice is saved as "this village", not as an exact point. */
  zoneId?: number;
  localityId?: number;
}

interface ZoneLike {
  id: number;
  name: string;
  code: string | null;
  localities: Array<{ id: number; name: string; latitude?: number | null; longitude?: number | null }>;
}

/**
 * Lagje and villages whose name matches what was typed (accents and case ignored), names that start
 * with it first. The point is the lagje / village when known, else the middle of its zone.
 */
export function searchLocalities(query: string, zones: ZoneLike[], limit = 5): PlaceSuggestion[] {
  const q = plainWords(query);
  if (q.length < 2) return [];
  const hits: Array<{ s: PlaceSuggestion; rank: number }> = [];
  for (const zone of zones) {
    for (const l of zone.localities) {
      const name = plainWords(l.name);
      const words = name.split(' ');
      const rank = name.startsWith(q) ? 0 : words.some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : -1;
      if (rank < 0) continue;
      const point = l.latitude != null && l.longitude != null ? { latitude: l.latitude, longitude: l.longitude } : zone.code ? zoneCenter(zone.code) : null;
      if (!point) continue;
      hits.push({ rank, s: { label: capitalise(localityPlace(zone, l)), ...point, kind: 'locality', zoneId: zone.id, localityId: l.id } });
    }
  }
  return hits.sort((a, b) => a.rank - b.rank || a.s.label.localeCompare(b.s.label, 'sq')).slice(0, limit).map((h) => h.s);
}
