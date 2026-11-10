/**
 * Protection of the public report form against scripts that send reports in
 * bulk, without bothering real residents (no puzzles, no "I am not a robot"):
 *  - a hidden field ("website") that people never see and bots fill in;
 *  - a form token signed by the server when the form opens: a report needs
 *    one, and it cannot be sent sooner than a person could fill in the form;
 *  - limits per address (hourly and daily) and per form token
 *    (actions/reports.ts), on top of the upload limits.
 * Reports queued offline keep their token and are sent when the connection
 * returns, so the token has no expiry; the limit per token stops a script
 * from reusing one token for many reports.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './env';
import { AppError, badRequest } from './errors';

/** A person needs at least this long from opening the form to sending it. */
export const MIN_FORM_SECONDS = 4;

const sign = (issuedAt: number) => createHmac('sha256', config().auth.secret).update(`report-form:${issuedAt}`).digest('base64url').slice(0, 32);

export function issueFormToken(now = Date.now()): string {
  return `${now}.${sign(now)}`;
}

/** When the token was issued, or null when it is missing or not signed by this server. */
export function formTokenTime(token: unknown, now = Date.now()): number | null {
  if (typeof token !== 'string') return null;
  const match = /^(\d{13})\.([A-Za-z0-9_-]{32})$/.exec(token);
  if (!match) return null;
  const issuedAt = Number(match[1]);
  const expected = Buffer.from(sign(issuedAt));
  const given = Buffer.from(match[2]!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (issuedAt > now + 60_000) return null; // from the future
  return issuedAt;
}

/** Throws when the report looks sent by a script. */
export function checkFormGuard(input: { website?: unknown; formToken?: unknown }, now = Date.now()): void {
  if (typeof input.website === 'string' && input.website.trim() !== '') {
    throw badRequest('Raportimi nuk u pranua.');
  }
  const issuedAt = formTokenTime(input.formToken, now);
  if (issuedAt === null) {
    throw new AppError(400, 'FORM_EXPIRED', 'Formulari ka skaduar. Rifreskoni faqen dhe provoni përsëri.');
  }
  if (now - issuedAt < MIN_FORM_SECONDS * 1000) {
    throw new AppError(429, 'TOO_FAST', 'Prisni pak sekonda dhe provoni përsëri.');
  }
}
