/**
 * "Më njoftoni në këtë telefon" in the browser (lib/server/services/push.ts):
 * permission when the resident ticks the box (a tap is needed for it), the
 * subscription once the report has its number.
 */
import { subscribePushAction } from '@/actions/reports';
import { call } from './action';

/** "yes": this browser can; "ios-install": an iPhone that can only after "Add to Home Screen"; "no". */
export function pushSupport(): 'yes' | 'ios-install' | 'no' {
  if (typeof window === 'undefined') return 'no';
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'yes';
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios-install' : 'no';
}

export async function askPushPermission(): Promise<boolean> {
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Subscribes this device to the report just sent. False when it did not work (the report is sent anyway). */
export async function subscribeToReport(p: { caseNumber: string; clientRef: string; key: string; lang: 'sq' | 'en' }): Promise<boolean> {
  try {
    if (Notification.permission !== 'granted') return false;
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    const reg = await navigator.serviceWorker.ready;
    const applicationServerKey = keyBytes(p.key);
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // A subscription made with another key cannot be reused.
      const current = sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (!current || current.length !== applicationServerKey.length || current.some((b, i) => b !== applicationServerKey[i])) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await call(subscribePushAction({ caseNumber: p.caseNumber, clientRef: p.clientRef, lang: p.lang, subscription: { endpoint: json.endpoint, keys: json.keys } }));
    return true;
  } catch {
    return false;
  }
}
