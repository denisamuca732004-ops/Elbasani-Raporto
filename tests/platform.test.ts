/**
 * The building blocks of the new stack: Zod validation, signed photo uploads,
 * the Redis cache (memory driver here), rate limits and the email job.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { CACHE_KEYS, cacheGet } from '@/lib/server/cache';
import { resetConfigForTests } from '@/lib/server/env';
import { deliverEmails, queueEmails } from '@/lib/server/mail';
import { pendingJobCount } from '@/lib/server/queue';
import { enforceRateLimit, resetRateLimitsForTests } from '@/lib/server/ratelimit';
import * as adminService from '@/lib/server/services/admin';
import { getCatalog } from '@/lib/server/services/catalog';
import { createUploadGrant, receiveSignedUpload } from '@/lib/server/storage';
import type { Principal } from '@/lib/shared/types';
import { statusChangeSchema, reportListSchema, prioritySchema, transferDecisionSchema } from '@/lib/validation/report';
import { departmentPatchSchema, requestTypePatchSchema } from '@/lib/validation/admin';
import { uploadRequestSchema } from '@/lib/validation/upload';
import { check } from '@/lib/validation/zod';
import { adminSession, db, drainJobs, jpeg, rejects, setupTestDb, teardown } from './helpers';

let admin: Principal;
before(async () => {
  process.env.RATE_LIMIT_REPORTS_PER_HOUR = '2';
  resetConfigForTests();
  await setupTestDb();
  admin = await adminSession();
});
after(teardown);

describe('Zod validation before anything touches the database', () => {
  test('a status or priority can only be one of the allowed values', () => {
    assert.equal(statusChangeSchema.safeParse({ status: 'IN_PROGRESS' }).success, true);
    for (const status of ['DONE', 'in-progress', '', 'RESOLVED; DROP TABLE reports']) {
      assert.equal(statusChangeSchema.safeParse({ status }).success, false, status);
    }
    assert.equal(prioritySchema.safeParse({ priority: 'HIGH' }).success, true);
    assert.equal(prioritySchema.safeParse({ priority: 'CRITICAL' }).success, false);
  });

  test('unknown fields are refused, not silently trusted', () => {
    assert.equal(statusChangeSchema.safeParse({ status: 'VERIFIED', departmentId: 3 }).success, false);
    assert.equal(transferDecisionSchema.safeParse({ decision: 'approve', isAdmin: true }).success, false);
  });

  test('list filters from the URL are parsed into safe values', () => {
    const q = reportListSchema.parse({ status: 'open', page: '2', pageSize: '50', includeTest: 'true' });
    assert.ok(q.status?.includes('PENDING') && q.status.includes('IN_PROGRESS'));
    assert.equal(q.page, 2);
    assert.equal(reportListSchema.safeParse({ status: 'whatever' }).success, false);
    assert.equal(reportListSchema.safeParse({ pageSize: '1000' }).success, false);
  });

  test('an admin PATCH changes only the fields it sends (no hidden defaults)', async () => {
    const pothole = await db.requestType.findUniqueOrThrow({ where: { code: 'streets.pothole' } });
    assert.ok(pothole.departmentId, 'the pothole type is routed to a department');
    const patch = requestTypePatchSchema.parse({ nameSq: 'Gropë në asfalt' });
    assert.deepEqual(patch, { nameSq: 'Gropë në asfalt' });
    await adminService.updateRequestType(admin, pothole.id, patch);
    const after = await db.requestType.findUniqueOrThrow({ where: { id: pothole.id } });
    assert.equal(after.departmentId, pothole.departmentId, 'the department stays');
    assert.equal(after.slaDays, pothole.slaDays, 'the deadline stays');
    assert.equal(after.defaultPriority, pothole.defaultPriority, 'the priority stays');
    assert.equal(after.active, pothole.active);
    assert.deepEqual(departmentPatchSchema.parse({ nameEn: 'Roads' }), { nameEn: 'Roads' }, 'a renamed department is not re-activated');
  });

  test('error messages are in Albanian, one per field', () => {
    const r = check(statusChangeSchema, {});
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.deepEqual(r.errors, [{ field: 'status', code: 'required', message: 'Kjo fushë është e detyrueshme.' }]);
  });
});

describe('photo uploads', () => {
  test('only images, only up to the size limit', async () => {
    assert.equal(uploadRequestSchema.safeParse({ contentType: 'image/svg+xml', size: 100 }).success, false);
    assert.equal(uploadRequestSchema.safeParse({ contentType: 'application/pdf', size: 100 }).success, false);
    assert.equal((await rejects(() => createUploadGrant('image/jpeg', 500 * 1024 * 1024))).code, 'PHOTO_INVALID');
  });

  test('a signed upload address cannot be changed, reused or used late', async () => {
    const photo = await jpeg();
    const grant = await createUploadGrant('image/jpeg', photo.length);
    assert.equal(grant.driver, 'server');
    if (grant.driver !== 'server') return;
    const params = new URL(grant.uploadUrl, 'http://localhost').searchParams;
    const body = new Uint8Array(photo).buffer;

    const otherKey = new URLSearchParams(params);
    otherKey.set('key', 'tmp/11111111-1111-4111-8111-111111111111.jpg');
    assert.equal((await rejects(() => receiveSignedUpload(otherKey, 'image/jpeg', body))).status, 403, 'another file name');
    const later = new URLSearchParams(params);
    later.set('exp', String(Date.now() + 365 * 86400_000));
    assert.equal((await rejects(() => receiveSignedUpload(later, 'image/jpeg', body))).status, 403, 'a longer validity');
    assert.equal((await rejects(() => receiveSignedUpload(params, 'image/png', body))).status, 400, 'another file type');

    await receiveSignedUpload(params, 'image/jpeg', body);
    assert.equal((await rejects(() => receiveSignedUpload(params, 'image/jpeg', body))).status, 409, 'used only once');

    const expired = new URLSearchParams(params);
    expired.set('exp', String(Date.now() - 1000));
    assert.equal((await rejects(() => receiveSignedUpload(expired, 'image/jpeg', body))).status, 403);
  });
});

describe('Vercel Blob connected with OIDC (no read-write token)', () => {
  test('photos go through the signed app address, limited to what a Vercel function accepts', async () => {
    const saved = { id: process.env.BLOB_STORE_ID, mb: process.env.UPLOAD_MAX_MB };
    try {
      process.env.BLOB_STORE_ID = 'store_test123';
      process.env.UPLOAD_MAX_MB = '8';
      resetConfigForTests();
      const grant = await createUploadGrant('image/jpeg', 1024);
      assert.equal(grant.driver, 'server');
      if (grant.driver !== 'server') return;
      assert.match(grant.uploadUrl, /^\/api\/uploads\/photo\?/);
      assert.equal(grant.maxBytes, 4 * 1024 * 1024, 'at most 4 MB through a function');
      assert.equal((await rejects(() => createUploadGrant('image/jpeg', 5 * 1024 * 1024))).code, 'PHOTO_INVALID');
    } finally {
      if (saved.id === undefined) delete process.env.BLOB_STORE_ID; else process.env.BLOB_STORE_ID = saved.id;
      if (saved.mb === undefined) delete process.env.UPLOAD_MAX_MB; else process.env.UPLOAD_MAX_MB = saved.mb;
      resetConfigForTests();
    }
  });
});

describe('cache (Upstash Redis in production)', () => {
  test('the catalogue is cached and cleared when the admin changes it', async () => {
    await getCatalog();
    assert.ok(await cacheGet(CACHE_KEYS.catalog), 'cached after the first read');
    const pothole = await db.requestType.findUniqueOrThrow({ where: { code: 'streets.pothole' } });
    await adminService.updateRequestType(admin, pothole.id, { nameSq: 'Gropë e madhe në rrugë' });
    assert.equal(await cacheGet(CACHE_KEYS.catalog), undefined, 'cleared by the change');
    const fresh = await getCatalog();
    assert.ok(fresh.categories.flatMap((c) => c.types).some((t) => t.nameSq === 'Gropë e madhe në rrugë'));
  });
});

describe('rate limits', () => {
  test('too many new reports from one address in an hour are refused with 429', async () => {
    resetRateLimitsForTests();
    await enforceRateLimit('report', '203.0.113.7');
    await enforceRateLimit('report', '203.0.113.7');
    assert.equal((await rejects(() => enforceRateLimit('report', '203.0.113.7'))).status, 429);
    await enforceRateLimit('report', '203.0.113.8'); // another address is not affected
  });
});

describe('emails in the background (QStash in production)', () => {
  test('an email is written first and sent by the job; running the job twice sends it once', async () => {
    await drainJobs();
    const ids = await queueEmails(['Someone@Example.com', 'someone@example.com', ''], { template: 'test', subject: 'Test', text: 'Hello' });
    assert.equal(ids.length, 1, 'duplicates and empty addresses are dropped');
    assert.equal(pendingJobCount(), 1, 'the delivery waits for the background job');
    assert.equal((await db.emailLog.findUniqueOrThrow({ where: { id: BigInt(ids[0]!) } })).status, 'QUEUED');
    await drainJobs();
    const sent = await db.emailLog.findUniqueOrThrow({ where: { id: BigInt(ids[0]!) } });
    assert.equal(sent.status, 'LOGGED');
    assert.equal(sent.attempts, 1);
    await deliverEmails(ids);
    assert.equal((await db.emailLog.findUniqueOrThrow({ where: { id: BigInt(ids[0]!) } })).attempts, 1, 'not sent again');
  });
});
