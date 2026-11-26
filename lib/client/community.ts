/**
 * "Ndihmo qytetin" in the browser: a random reference of this browser (no account),
 * the organiser's secret link of each action they created, and the position for the scan.
 */
const DEVICE_KEY = 'er-device-ref';
const ORG_KEY = (code: string) => `er-action-org-${code}`;

function random(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The same value on every visit from this browser (a new one if storage is blocked). */
export function deviceRef(): string {
  try {
    let v = localStorage.getItem(DEVICE_KEY);
    if (!v || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) {
      v = random();
      localStorage.setItem(DEVICE_KEY, v);
    }
    return v;
  } catch {
    return random();
  }
}

export function saveOrganizerToken(code: string, token: string): void {
  try { localStorage.setItem(ORG_KEY(code), token); } catch { /* the link in the message still works */ }
}
export function organizerToken(code: string): string | null {
  try { return localStorage.getItem(ORG_KEY(code)); } catch { return null; }
}

/** The phone's position once (for the scan on the spot). */
export function currentPosition(timeoutMs = 15_000): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject(new Error('unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? 'denied' : 'unavailable')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

/** A photo handed from the report form ("Këtë mund ta rregulloni edhe ju!") to the action form. */
/** `fix`: what the report already proposed (people, minutes, what to bring), so the action says the same. */
type Handed = { blob: Blob; key: string | null; notes: string; fix?: { people: number; minutes: number; bring: string } };
let pendingPhoto: Handed | null = null;
export function handOverPhoto(p: Handed): void {
  pendingPhoto = p;
}
export function takeHandedPhoto(): Handed | null {
  const p = pendingPhoto;
  pendingPhoto = null;
  return p;
}

const JOINED_KEY = (code: string) => `er-action-joined-${code}`;
const VOTED_KEY = (code: string) => `er-action-voted-${code}`;
export function markJoined(code: string): void { try { localStorage.setItem(JOINED_KEY(code), '1'); } catch { /* not kept */ } }
export function hasJoined(code: string): boolean { try { return localStorage.getItem(JOINED_KEY(code)) === '1'; } catch { return false; } }
export function markVoted(code: string): void { try { localStorage.setItem(VOTED_KEY(code), '1'); } catch { /* not kept */ } }
export function hasVoted(code: string): boolean { try { return localStorage.getItem(VOTED_KEY(code)) === '1'; } catch { return false; } }

/** "1 orë 30 min" / "45 min". */
export function durationText(minutes: number, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (minutes < 60) return t('community.minutes', { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? t('community.hoursMinutes', { h, m }) : t('community.hours', { n: h });
}
