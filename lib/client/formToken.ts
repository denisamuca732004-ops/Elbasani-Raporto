/**
 * The signed token of the report form (lib/server/botGuard.ts): asked for when
 * the form opens, sent with the report. The server refuses a report sent
 * sooner than a person could fill in the form, so a token just fetched waits
 * those few seconds before it is used.
 */
import { reportFormTokenAction } from '@/actions/reports';
import { call } from './action';

const MIN_AGE_MS = 4_500;
let current: { token: string; at: number } | null = null;
let pending: Promise<{ token: string; at: number }> | null = null;

async function fetchToken(): Promise<{ token: string; at: number }> {
  if (current) return current;
  pending ??= call(reportFormTokenAction()).then(({ token }) => (current = { token, at: Date.now() })).finally(() => { pending = null; });
  return pending;
}

/** Fetches the token in the background when the form opens (errors are ignored: it is fetched again when sending). */
export function prefetchFormToken(): void {
  fetchToken().catch(() => {});
}

/** The token, old enough to be accepted. Throws when the server cannot be reached. */
export async function formToken(): Promise<string> {
  const { token, at } = await fetchToken();
  const wait = at + MIN_AGE_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return token;
}
