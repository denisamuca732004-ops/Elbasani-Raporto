/**
 * Cache for read-heavy data (catalogue, departments, settings, session state),
 * in Upstash Redis over HTTP. Without Redis (development, tests) an in-memory
 * map is used instead. The cache never breaks a request: if Redis fails, the
 * value is read from the database.
 */
import 'server-only';
import { Redis } from '@upstash/redis';
import { config } from './env';

export const CACHE_KEYS = {
  catalog: 'catalog:v1',
  departments: 'departments:active:v1',
  settings: 'settings:v1',
  publicStats: 'stats:public:v1',
  userState: (userId: string) => `user:${userId}:state:v1`,
} as const;

let redis: Redis | null | undefined;
function client(): Redis | null {
  if (redis === undefined) {
    const r = config().redis;
    redis = r ? new Redis({ url: r.url, token: r.token, automaticDeserialization: true }) : null;
  }
  return redis;
}

const memory = new Map<string, { value: unknown; expires: number }>();
const ns = (key: string) => `er:${config().env}:${key}`;

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const r = client();
  if (!r) {
    const hit = memory.get(ns(key));
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      memory.delete(ns(key));
      return undefined;
    }
    return structuredClone(hit.value) as T;
  }
  try {
    const value = await r.get<T>(ns(key));
    return value ?? undefined;
  } catch (err) {
    console.warn(`[cache] read failed for ${key}:`, (err as Error).message);
    return undefined;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const r = client();
  if (!r) {
    memory.set(ns(key), { value: structuredClone(value), expires: Date.now() + ttlSeconds * 1000 });
    return;
  }
  try {
    await r.set(ns(key), value, { ex: ttlSeconds });
  } catch (err) {
    console.warn(`[cache] write failed for ${key}:`, (err as Error).message);
  }
}

/** Removes keys after the data behind them changed. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (!keys.length) return;
  const r = client();
  if (!r) {
    for (const k of keys) memory.delete(ns(k));
    return;
  }
  try {
    await r.del(...keys.map(ns));
  } catch (err) {
    console.warn(`[cache] invalidate failed for ${keys.join(', ')}:`, (err as Error).message);
  }
}

/**
 * Returns the cached value, or loads it and caches it for ttlSeconds.
 * Dates do not survive JSON, so cached values must not rely on Date objects.
 */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

/** Tests start every file with an empty cache. */
export function clearMemoryCache(): void {
  memory.clear();
}

export function redisClient(): Redis | null {
  return client();
}
