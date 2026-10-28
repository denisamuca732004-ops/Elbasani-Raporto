/** Formatting for the interface (dates in Albanian time, numbers, names). */
import type { Translate } from '@/i18n/translate';
import type { Lang } from '@/i18n/translate';

const MONTHS_SQ = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'korr', 'gush', 'sht', 'tet', 'nën', 'dhj'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_SQ = ['Die', 'Hën', 'Mar', 'Mër', 'Enj', 'Pre', 'Sht'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n: string | number) => String(n).padStart(2, '0');

function tiranaParts(value: string | number | Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Tirane', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
}

/** "27 tet 2026, 22:21" in Albanian time (Europe/Tirane), "27 Oct 2026, 22:21" in English. */
export function formatDate(value: string | Date | null | undefined, lang: Lang = 'sq', withTime = false): string {
  if (!value) return '–';
  const parts = tiranaParts(value);
  const month = (lang === 'en' ? MONTHS_EN : MONTHS_SQ)[Number(parts.month) - 1];
  const date = `${Number(parts.day)} ${month} ${parts.year}`;
  return withTime ? `${date}, ${pad(parts.hour ?? 0)}:${pad(parts.minute ?? 0)}` : date;
}

/** Label of a dashboard column: "2026-10-27" → "27 tet" (day) or "tet 2026" (month). */
export function formatBucket(bucket: string, unit: 'day' | 'month', lang: Lang = 'sq', { withWeekday = false, withYear = false } = {}): string {
  const [y = 0, m = 1, d = 1] = bucket.split('-').map(Number);
  const months = lang === 'en' ? MONTHS_EN : MONTHS_SQ;
  if (unit === 'month') return withYear || m === 1 ? `${months[m - 1]} ${y}` : months[m - 1]!;
  const weekday = (lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_SQ)[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `${d} ${months[m - 1]}`;
  return withWeekday ? `${weekday} ${base}` : withYear ? `${base} ${y}` : base;
}

export function timeAgo(value: string | Date, t: Translate): string {
  const min = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (min < 1) return t('time.now');
  if (min < 60) return t('time.minutes', { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('time.hours', { n: h });
  return t('time.days', { n: Math.round(h / 24) });
}

type Named = { nameSq: string; nameEn: string } | null | undefined;
export const typeName = (type: Named, lang: Lang): string => (type ? (lang === 'en' ? type.nameEn : type.nameSq) : '–');
export const departmentName = (d: Named, lang: Lang): string | null => (d ? (lang === 'en' ? d.nameEn : d.nameSq) : null);

export function distanceLabel(m: number | null | undefined): string {
  if (m === null || m === undefined) return '';
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * 1284.5 → "1 284,5" (Albanian) / "1,284.5" (English), at most one decimal.
 * Written by hand on purpose: browsers do not all carry Albanian number data,
 * and the server and the browser must print exactly the same text.
 */
export function formatNumber(n: number | null | undefined, lang: Lang = 'sq'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const rounded = Math.round(n * 10) / 10;
  const [whole = '0', decimals] = Math.abs(rounded).toFixed(Number.isInteger(rounded) ? 0 : 1).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : '\u00A0');
  return `${rounded < 0 ? '-' : ''}${grouped}${decimals ? `${lang === 'en' ? '.' : ','}${decimals}` : ''}`;
}

/** Change against the previous period: { pct, direction } (pct null when there is no base). */
export function delta(current: number, previous: number): { pct: number | null; direction: 'up' | 'down' | 'flat' } {
  if (!previous) return { pct: null, direction: current > 0 ? 'up' : 'flat' };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

/** Lower-case key for translations: 'IN_PROGRESS' → 'in_progress'. */
export const key = (value: string): string => value.toLowerCase();

export const ELBASAN_CENTER: [number, number] = [41.1125, 20.0822];
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const phoneDigits = (s: string | null | undefined): number => String(s ?? '').replace(/\D/g, '').length;

export type LatLng = { latitude: number; longitude: number };
export type Area = { minLat: number; minLng: number; maxLat: number; maxLng: number };
export const insideArea = (p: LatLng | null | undefined, area: Area): boolean =>
  Boolean(p) && p!.latitude >= area.minLat && p!.latitude <= area.maxLat && p!.longitude >= area.minLng && p!.longitude <= area.maxLng;
