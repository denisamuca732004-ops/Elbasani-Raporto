/**
 * Rate limits against abuse: new reports, log-in attempts, uploads.
 * Upstash Ratelimit (sliding window) when Redis is configured, otherwise a
 * simple in-memory counter (development and tests).
 */
import 'server-only';
import { Ratelimit } from '@upstash/ratelimit';
import { redisClient } from './cache';
import { config } from './env';
import { tooMany } from './errors';

type Rule = { limit: number; windowSeconds: number };

const RULES = {
  report: () => ({ limit: config().rateLimit.reportsPerHour, windowSeconds: 3600 }),
  reportDay: () => ({ limit: config().rateLimit.reportsPerDay, windowSeconds: 86_400 }),
  // One opened form sends one report (a few more: "Raporto një tjetër" reloads the page, a retry after an error does not).
  reportToken: () => ({ limit: 6, windowSeconds: 86_400 }),
  login: () => ({ limit: config().rateLimit.loginsPer15Min, windowSeconds: 900 }),
  upload: () => ({ limit: config().rateLimit.reportsPerHour * 3, windowSeconds: 3600 }),
  // Each check can be an AI call: as many as photos may be uploaded.
  photoCheck: () => ({ limit: config().rateLimit.reportsPerHour * 3, windowSeconds: 3600 }),
  photoAnalyze: () => ({ limit: config().rateLimit.reportsPerHour * 3, windowSeconds: 3600 }),
  // AI drafts of notes in the panel, per staff account.
  draft: () => ({ limit: 60, windowSeconds: 3600 }),
  textCheck: () => ({ limit: config().rateLimit.reportsPerHour * 5, windowSeconds: 3600 }),
  follow: () => ({ limit: 30, windowSeconds: 3600 }),
  search: () => ({ limit: 120, windowSeconds: 600 }),
  geocode: () => ({ limit: 300, windowSeconds: 600 }),
  // "Ndiq raportimin" by name + phone: few tries, so a phone number cannot be guessed.
  trackContact: () => ({ limit: 20, windowSeconds: 3600 }),
  // The report link of a sector that works by e-mail (actions and photos).
  sector: () => ({ limit: 120, windowSeconds: 600 }),
  feedback: () => ({ limit: 20, windowSeconds: 3600 }),
  setup: () => ({ limit: 10, windowSeconds: 3600 }),
  register: () => ({ limit: 10, windowSeconds: 3600 }),
} satisfies Record<string, () => Rule>;
export type RateRule = keyof typeof RULES;

const limiters = new Map<string, Ratelimit>();
const counters = new Map<string, { count: number; resetAt: number }>();

/** Throws 429 when `identifier` used rule `name` too often. */
export async function enforceRateLimit(name: RateRule, identifier: string): Promise<void> {
  const rule = RULES[name]();
  const redis = redisClient();
  if (redis) {
    let limiter = limiters.get(name);
    if (!limiter) {
      limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(rule.limit, `${rule.windowSeconds} s`),
        prefix: `er:${config().env}:rl:${name}`,
        analytics: false,
      });
      limiters.set(name, limiter);
    }
    try {
      const { success } = await limiter.limit(identifier);
      if (!success) throw tooMany();
      return;
    } catch (err) {
      if ((err as { code?: string }).code === 'RATE_LIMITED') throw err;
      console.warn(`[ratelimit] ${name} check failed, allowing the request:`, (err as Error).message);
      return;
    }
  }
  const key = `${name}:${identifier}`;
  const now = Date.now();
  const entry = counters.get(key);
  if (!entry || entry.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > rule.limit) throw tooMany();
}

export function resetRateLimitsForTests(): void {
  counters.clear();
}
