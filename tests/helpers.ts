/**
 * Test helpers. Each test file runs in its own process against the test
 * database (DATABASE_URL in .env.test): setupTestDb() empties it, applies the
 * real migrations (prisma/migrations/*.sql) and seeds the reference data.
 * Background jobs wait in memory until drainJobs().
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { db, disconnectDb } from '@/lib/server/db';
import { clearMemoryCache } from '@/lib/server/cache';
import { config } from '@/lib/server/env';
import { drainJobs, setJobMode } from '@/lib/server/queue';
import { resetRateLimitsForTests } from '@/lib/server/ratelimit';
import { seedReferenceData } from '@/lib/server/referenceData';
import { loadPrincipal, setupFirstAdmin, changePassword, verifyCredentials } from '@/lib/server/services/auth';
import { createCitizenReport } from '@/lib/server/services/publicReport';
import { createUser } from '@/lib/server/services/users';
import { createUploadGrant, receiveSignedUpload } from '@/lib/server/storage';
import type { Principal } from '@/lib/shared/types';

export { db, drainJobs };

export async function setupTestDb(): Promise<void> {
  if (config().env !== 'test') throw new Error('Tests must run with APP_ENV=test');
  const client = new pg.Client({ connectionString: config().databaseUrl });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const dir = path.resolve('prisma/migrations');
    for (const name of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
      await client.query(fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
  fs.rmSync(path.resolve(config().storage.localDir), { recursive: true, force: true });
  await seedReferenceData(db);
  clearMemoryCache();
  resetRateLimitsForTests();
  setJobMode('manual');
}

export async function teardown(): Promise<void> {
  await drainJobs();
  await disconnectDb();
}

export async function jpeg(color = '#7a7a7a', width = 320, height = 240): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

/** Uploads a photo the way the browser does (local driver) and returns its temporary key. */
export async function uploadPhoto(photo?: Buffer): Promise<string> {
  const buffer = photo ?? (await jpeg());
  const grant = await createUploadGrant('image/jpeg', buffer.length);
  if (grant.driver !== 'server') throw new Error('Tests use the local storage driver');
  const url = new URL(grant.uploadUrl, 'http://localhost');
  const { key } = await receiveSignedUpload(url.searchParams, 'image/jpeg', buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  return key;
}

export const ELBASAN = { latitude: 41.1125, longitude: 20.0822 } as const;

export async function typeId(code: string): Promise<number> {
  return (await db.requestType.findUniqueOrThrow({ where: { code } })).id;
}

export async function departmentId(code: string): Promise<number> {
  return (await db.department.findUniqueOrThrow({ where: { code } })).id;
}

export async function firstAreaId(): Promise<number> {
  return (await db.neighbourhood.findFirstOrThrow({ orderBy: { sortOrder: 'asc' } })).id;
}

/** A complete, valid resident report (every wizard step filled in), photo included. */
export async function citizenData(overrides: Record<string, unknown> = {}) {
  return {
    requestTypeId: await typeId('streets.pothole'),
    ...ELBASAN,
    address: 'Rruga Qemal Stafa 12',
    neighbourhoodId: await firstAreaId(),
    description: 'Gropë e thellë në mes të rrugës, para shkollës.',
    anonymous: false,
    contactName: 'Qytetar Test',
    contactEmail: 'qytetar@example.com',
    contactPhone: '',
    photoKey: overrides.photoKey === undefined ? await uploadPhoto() : overrides.photoKey,
    ...overrides,
  };
}

/** Sends a resident report and runs the background check. */
export async function submitReport(overrides: Record<string, unknown> = {}) {
  const result = await createCitizenReport(await citizenData(overrides));
  await drainJobs();
  const report = await db.report.findUniqueOrThrow({ where: { caseNumber: result.caseNumber } });
  return { result, report };
}

export const ADMIN_PASSWORD = 'Admin-pass-123';

async function principalFor(email: string, password: string): Promise<Principal> {
  const signedIn = await verifyCredentials(email, password);
  if (!signedIn) throw new Error(`sign-in failed for ${email}`);
  const principal = await loadPrincipal(signedIn.id, signedIn.sessionVersion);
  if (!principal) throw new Error(`no panel access for ${email}`);
  return principal;
}

/** Creates the first admin and signs in. */
export async function adminSession(): Promise<Principal> {
  await setupFirstAdmin({ email: config().auth.adminEmail, password: ADMIN_PASSWORD, name: 'Admin Test' });
  return principalFor(config().auth.adminEmail, ADMIN_PASSWORD);
}

/**
 * The admin creates a department head; they sign in with the temporary
 * password and choose their own, exactly like in the panel.
 */
export async function staffSession(admin: Principal, opts: { email: string; departmentCode: string; name?: string }) {
  const { user, temporaryPassword } = await createUser(admin, {
    email: opts.email, name: opts.name ?? 'Përgjegjës Test', role: 'MUNICIPALITY_STAFF', departmentId: await departmentId(opts.departmentCode),
  } as never);
  const first = await principalFor(opts.email, temporaryPassword);
  const password = 'Sektori-pass-123';
  await changePassword(first, { currentPassword: temporaryPassword, newPassword: password });
  return { principal: await principalFor(opts.email, password), user, password };
}

/** Moves a report back in time (statistics and deadline tests). */
export async function backdate(id: string, days: number, fields: Array<'created_at' | 'resolved_at' | 'due_at' | 'closed_at'> = ['created_at']) {
  for (const f of fields) {
    await db.$executeRawUnsafe(`UPDATE reports SET ${f} = ${f} - ($1 * interval '1 day') WHERE id = $2::uuid`, days, id);
  }
}

/** Runs a function and returns the AppError it throws (or fails). */
export async function rejects(fn: () => Promise<unknown>): Promise<{ status: number; code: string; message: string; details?: unknown }> {
  try {
    await fn();
  } catch (err) {
    const e = err as { status?: number; code?: string; message: string; details?: unknown };
    if (typeof e.status === 'number') return { status: e.status, code: e.code ?? '', message: e.message, details: e.details };
    throw err;
  }
  throw new Error('Expected an error, but the call succeeded');
}
