/**
 * Offline outbox: if there is no connection when a resident presses "Send",
 * the report (with its photo) is kept in IndexedDB on the phone and sent
 * automatically when the connection returns. The clientRef makes sure a
 * report is never created twice.
 */
import { createStore, del, entries, set, type UseStore } from 'idb-keyval';
import { createReportAction } from '@/actions/reports';
import { ActionFailure, call } from './action';
import { uploadPhoto } from './upload';

type QueuedReport = { data: Record<string, unknown> & { clientRef: string }; photo: Blob; queuedAt: number };

let store: UseStore | null | undefined;
function outbox(): UseStore | null {
  if (store === undefined) store = typeof indexedDB !== 'undefined' ? createStore('elbasani-raporton', 'outbox') : null;
  return store;
}

export function newClientRef(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function queueReport(data: QueuedReport['data'], photo: Blob): Promise<void> {
  const s = outbox();
  if (!s) throw new Error('offline storage unavailable');
  await set(data.clientRef, { data, photo, queuedAt: Date.now() } satisfies QueuedReport, s);
}

export async function pendingCount(): Promise<number> {
  const s = outbox();
  return s ? (await entries(s)).length : 0;
}

let flushing = false;
/** Sends everything waiting in the outbox. Returns the case numbers created. */
export async function flushQueue(): Promise<string[]> {
  const s = outbox();
  if (!s || flushing || !navigator.onLine) return [];
  flushing = true;
  const sent: string[] = [];
  try {
    for (const [key, item] of await entries<string, QueuedReport>(s)) {
      try {
        const photoKey = await uploadPhoto(item.photo);
        const res = await call(createReportAction({ ...item.data, photoKey }));
        sent.push(res.caseNumber);
        await del(key, s);
      } catch (err) {
        const status = err instanceof ActionFailure ? err.status : 0;
        if (status >= 400 && status < 500 && status !== 429) await del(key, s); // invalid: it will never succeed
        else break; // still offline or the server is busy: try later
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
