/**
 * Server configuration, read once from environment variables and validated
 * with Zod. Staging and production refuse to start while a secret is missing
 * or still a placeholder, and say exactly which one.
 */
import 'server-only';
import { z } from 'zod';

export type AppEnv = 'development' | 'staging' | 'production' | 'test';

const PLACEHOLDER = /^(SET_ON_SERVER|CHANGE_ME|change-me.*)$/i;

function appEnv(): AppEnv {
  const explicit = process.env.APP_ENV?.trim();
  if (explicit === 'development' || explicit === 'staging' || explicit === 'production' || explicit === 'test') return explicit;
  if (process.env.VERCEL_ENV === 'production') return 'production';
  if (process.env.VERCEL_ENV === 'preview') return 'staging';
  if (process.env.NODE_ENV === 'test') return 'test';
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = () => z.preprocess(blank, z.string().trim().optional());
function str(): ReturnType<typeof optStr>;
function str(fallback: string): z.ZodPipe<ReturnType<typeof optStr>, z.ZodTransform<string, string | undefined>>;
function str(fallback?: string) {
  return fallback === undefined ? optStr() : optStr().transform((v) => v ?? fallback);
}
const int = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(blank, z.coerce.number().int().min(min).max(max).default(fallback));
const bool = (fallback: boolean) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()) : v), z.boolean().default(fallback));
const list = (fallback: string) =>
  z.preprocess(blank, z.string().default(fallback)).transform((v) => v.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean));
const bbox = z.preprocess(blank, z.string().default('40.85,19.75,41.35,20.45')).transform((v, ctx) => {
  const [minLat, minLng, maxLat, maxLng] = v.split(',').map((p) => Number(p.trim()));
  const ok = [minLat, minLng, maxLat, maxLng].every((n) => Number.isFinite(n)) && minLat! < maxLat! && minLng! < maxLng!;
  if (!ok) {
    ctx.addIssue({ code: 'custom', message: 'must be "minLat,minLng,maxLat,maxLng"' });
    return z.NEVER;
  }
  return { minLat: minLat!, minLng: minLng!, maxLat: maxLat!, maxLng: maxLng! };
});

const EnvSchema = z.object({
  APP_URL: str(),
  /** Set by Vercel on every deployment, e.g. elbasani-raporto.vercel.app. Used when APP_URL is empty. */
  VERCEL_PROJECT_PRODUCTION_URL: str(),
  DATABASE_URL: str(),
  AUTH_SECRET: str(),
  SESSION_MAX_AGE_HOURS: int(12, 1, 24 * 30),
  ADMIN_EMAIL: str(''),
  BCRYPT_ROUNDS: int(11, 4, 15),
  BLOB_READ_WRITE_TOKEN: str(),
  /** Set by Vercel when a Blob store is connected with OIDC (the default since June 2026). */
  BLOB_STORE_ID: str(),
  LOCAL_UPLOAD_DIR: str('.uploads'),
  UPLOAD_MAX_MB: int(8, 1, 50),
  UPSTASH_REDIS_REST_URL: str(),
  UPSTASH_REDIS_REST_TOKEN: str(),
  KV_REST_API_URL: str(),
  KV_REST_API_TOKEN: str(),
  QSTASH_TOKEN: str(),
  QSTASH_URL: str(),
  QSTASH_CURRENT_SIGNING_KEY: str(),
  QSTASH_NEXT_SIGNING_KEY: str(),
  CRON_SECRET: str(),
  MAIL_DRIVER: z.preprocess(blank, z.enum(['log', 'smtp']).default('log')),
  MAIL_FROM: str('Elbasani Raporton <noreply@localhost>'),
  SMTP_HOST: str(),
  SMTP_PORT: int(587, 1, 65535),
  SMTP_SECURE: bool(false),
  SMTP_USER: str(),
  SMTP_PASS: str(),
  AI_ENABLED: bool(false),
  AI_BASE_URL: str('https://api.openai.com/v1'),
  AI_API_KEY: str(''),
  AI_MODEL: str('gpt-4o-mini'),
  AI_TIMEOUT_MS: int(20000, 1000, 120000),
  AI_VERIFY_THRESHOLD: int(85, 0, 100),
  AI_REVIEW_THRESHOLD: int(50, 0, 100),
  CASE_PREFIX: str('EL'),
  DUPLICATE_RADIUS_METERS: int(50, 5, 1000),
  AUTO_CLOSE_RESOLVED_DAYS: int(7, 1, 90),
  SERVICE_AREA_BBOX: bbox,
  RATE_LIMIT_REPORTS_PER_HOUR: int(10, 1),
  RATE_LIMIT_LOGINS_PER_15MIN: int(10, 1),
  EMBED_ALLOWED_ORIGINS: list('https://elbasani.gov.al,https://www.elbasani.gov.al'),
});

/**
 * Where photos go:
 *  - "token": Vercel Blob with a read-write token. The browser uploads straight to Blob with a one-file client token.
 *  - "oidc":  Vercel Blob connected with OIDC (no long-lived token; Vercel's default for new stores). The browser
 *             sends the photo to our signed /api/uploads/photo address and the server writes it to Blob. Vercel
 *             functions accept at most 4.5 MB per request, so photos are limited to 4 MB (the browser shrinks them first).
 *  - "local": a folder on disk, for development and tests.
 */
function storageConfig(e: z.output<typeof EnvSchema>, missing: (v: string | undefined) => boolean) {
  const blobToken = missing(e.BLOB_READ_WRITE_TOKEN) ? null : e.BLOB_READ_WRITE_TOKEN!;
  const blobStoreId = missing(e.BLOB_STORE_ID) ? null : e.BLOB_STORE_ID!;
  const driver: 'token' | 'oidc' | 'local' = blobToken ? 'token' : blobStoreId ? 'oidc' : 'local';
  const maxMb = driver === 'oidc' ? Math.min(e.UPLOAD_MAX_MB, 4) : e.UPLOAD_MAX_MB;
  return { driver, blobToken, blobStoreId, localDir: e.LOCAL_UPLOAD_DIR, maxBytes: maxMb * 1024 * 1024 };
}

function load() {
  const env = appEnv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration (APP_ENV=${env}):\n - ${lines.join('\n - ')}`);
  }
  const e = parsed.data;
  const strict = env === 'staging' || env === 'production';
  const redisUrl = e.UPSTASH_REDIS_REST_URL ?? e.KV_REST_API_URL;
  const appUrl = (e.APP_URL ?? (e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')).replace(/\/$/, '');
  const redisToken = e.UPSTASH_REDIS_REST_TOKEN ?? e.KV_REST_API_TOKEN;

  const problems: string[] = [];
  const missing = (v: string | undefined) => !v || PLACEHOLDER.test(v);
  if (missing(e.DATABASE_URL)) problems.push('DATABASE_URL is missing');
  if (missing(e.AUTH_SECRET)) problems.push('AUTH_SECRET is missing (npx auth secret)');
  else if (e.AUTH_SECRET!.length < 32) problems.push('AUTH_SECRET must be at least 32 characters');
  if (e.AI_ENABLED && missing(e.AI_API_KEY)) problems.push('AI_ENABLED=true but AI_API_KEY is missing');
  if (e.MAIL_DRIVER === 'smtp' && missing(e.SMTP_HOST)) problems.push('MAIL_DRIVER=smtp needs SMTP_HOST');
  if (strict) {
    if (missing(e.ADMIN_EMAIL)) problems.push('ADMIN_EMAIL is missing');
    if (missing(e.BLOB_READ_WRITE_TOKEN) && missing(e.BLOB_STORE_ID)) problems.push('Vercel Blob is not connected (BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID is missing)');
    if (missing(redisUrl) || missing(redisToken)) problems.push('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are missing');
    if (missing(e.CRON_SECRET)) problems.push('CRON_SECRET is missing');
    if (e.QSTASH_TOKEN && (missing(e.QSTASH_CURRENT_SIGNING_KEY) || missing(e.QSTASH_NEXT_SIGNING_KEY))) {
      problems.push('QSTASH_TOKEN is set but the QStash signing keys are missing');
    }
    if (!appUrl.startsWith('https://')) problems.push('APP_URL must start with https://');
  }
  if (problems.length) throw new Error(`Invalid configuration (APP_ENV=${env}):\n - ${problems.join('\n - ')}`);

  return Object.freeze({
    env,
    isStrict: strict,
    isTest: env === 'test',
    appUrl,
    databaseUrl: e.DATABASE_URL!,
    auth: {
      secret: e.AUTH_SECRET!,
      sessionMaxAgeSeconds: e.SESSION_MAX_AGE_HOURS * 3600,
      adminEmail: e.ADMIN_EMAIL.toLowerCase(),
      bcryptRounds: e.BCRYPT_ROUNDS,
    },
    storage: storageConfig(e, missing),
    redis: missing(redisUrl) || missing(redisToken) ? null : { url: redisUrl!, token: redisToken! },
    qstash: missing(e.QSTASH_TOKEN)
      ? null
      : {
          token: e.QSTASH_TOKEN!,
          baseUrl: e.QSTASH_URL,
          currentSigningKey: e.QSTASH_CURRENT_SIGNING_KEY ?? '',
          nextSigningKey: e.QSTASH_NEXT_SIGNING_KEY ?? '',
        },
    cronSecret: e.CRON_SECRET ?? null,
    mail: {
      driver: e.MAIL_DRIVER,
      from: e.MAIL_FROM,
      smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, pass: e.SMTP_PASS },
    },
    ai: {
      enabled: e.AI_ENABLED,
      baseUrl: e.AI_BASE_URL.replace(/\/$/, ''),
      apiKey: e.AI_API_KEY,
      model: e.AI_MODEL,
      timeoutMs: e.AI_TIMEOUT_MS,
      verifyThreshold: e.AI_VERIFY_THRESHOLD,
      reviewThreshold: e.AI_REVIEW_THRESHOLD,
    },
    rules: {
      casePrefix: e.CASE_PREFIX,
      duplicateRadiusMeters: e.DUPLICATE_RADIUS_METERS,
      autoCloseResolvedDays: e.AUTO_CLOSE_RESOLVED_DAYS,
      timezone: 'Europe/Tirane',
      serviceArea: e.SERVICE_AREA_BBOX,
    },
    rateLimit: { reportsPerHour: e.RATE_LIMIT_REPORTS_PER_HOUR, loginsPer15Min: e.RATE_LIMIT_LOGINS_PER_15MIN },
    embedOrigins: e.EMBED_ALLOWED_ORIGINS,
  });
}

export type Config = ReturnType<typeof load>;

let cached: Config | null = null;

/** The validated configuration. Throws a clear error the first time it is needed if something is wrong. */
export function config(): Config {
  cached ??= load();
  return cached;
}

/** Tests change environment variables between cases. */
export function resetConfigForTests(): void {
  cached = null;
}
