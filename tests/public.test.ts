/** Resident side: strict reporting (no step can be skipped), photos, tracking, map, duplicates, feedback. */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import sharp from 'sharp';
import { getCatalog } from '@/lib/server/services/catalog';
import { getPublicSettings } from '@/lib/server/services/settings';
import {
  createCitizenReport, findNearbyOpen, followReport, getFeedbackInfo, getPublicCase, getPublicPhoto, listRecent, mapPoints,
  searchOpenByPlace, submitCitizenFeedback,
} from '@/lib/server/services/publicReport';
import { changeStatus, getReport, rejectReport, resolveReport } from '@/lib/server/services/report';
import { publicStats } from '@/lib/server/services/stats';
import { runDaily } from '@/lib/server/services/maintenance';
import { openStoredImage } from '@/lib/server/storage';
import { invalidate, CACHE_KEYS } from '@/lib/server/cache';
import { caseNumber as caseNumberSchema, mapSchema, recentSchema } from '@/lib/validation/report';
import type { Principal } from '@/lib/shared/types';
import {
  adminSession, citizenData, db, drainJobs, ELBASAN, jpeg, rejects, setupTestDb, submitReport, teardown, typeId, uploadPhoto,
} from './helpers';

let admin: Principal;
before(async () => {
  await setupTestDb();
  admin = await adminSession();
});
after(teardown);

const countReports = () => db.report.count();
async function problemsOf(input: unknown) {
  const err = await rejects(() => createCitizenReport(input));
  assert.equal(err.status, 400);
  assert.equal(err.code, 'REPORT_INCOMPLETE');
  return err.details as Array<{ field: string; code: string; step: string; message: string }>;
}
const fieldsOf = (problems: Array<{ field: string; code: string; step?: string }>, withStep = false) =>
  problems.map((p) => (withStep ? [p.field, p.code, p.step] : [p.field, p.code]));

describe('catalogue', () => {
  test('lists categories with types (each routed to a department), the 13 zones with their lagje and villages, and the departments', async () => {
    const catalog = await getCatalog();
    assert.ok(catalog.categories.length >= 8);
    const pothole = catalog.categories.flatMap((c) => c.types).find((t) => t.code === 'streets.pothole');
    assert.ok(pothole?.departmentId);
    assert.equal(catalog.neighbourhoods.length, 13);
    assert.ok(!catalog.neighbourhoods.some((n) => n.name === 'Mollas'), 'Mollas belongs to the Municipality of Cërrik');
    assert.ok(catalog.neighbourhoods.every((n) => n.code && n.localities.length > 0));
    assert.equal(catalog.departments.length, 7);
  });

  test('public settings include branding and the service area', async () => {
    const settings = await getPublicSettings();
    assert.equal(settings.branding.headerColor, '#06B006');
    assert.ok(settings.rules.serviceArea.minLat < ELBASAN.latitude && settings.rules.serviceArea.maxLat > ELBASAN.latitude);
  });
});

describe('strict reporting: a report is created only when every step is complete', () => {
  test('a complete report is created, routed to the department of its type and confirmed by email', async () => {
    const { result, report } = await submitReport();
    assert.match(result.caseNumber, /^EL-\d{4}-00001$/);
    assert.equal(result.publicStatus, 'RECEIVED');
    assert.equal(report.status, 'NEEDS_REVIEW'); // AI is off here → a person in the department checks it
    const infra = await db.department.findUniqueOrThrow({ where: { code: 'infrastructure' } });
    assert.equal(report.departmentId, infra.id);
    assert.equal(report.priority, 'MEDIUM');
    assert.equal(report.contactEmail, 'qytetar@example.com');
    assert.equal(await db.attachment.count({ where: { reportId: report.id } }), 1);
    const mail = await db.emailLog.findFirst({ where: { template: 'request_received', reportId: report.id } });
    assert.ok(mail);
    assert.match(mail.bodyText, new RegExp(result.caseNumber));
    assert.equal(mail.status, 'LOGGED', 'the background job delivered it (MAIL_DRIVER=log)');
  });

  test('without a photo nothing is created and the photo step is reported', async () => {
    const before = await countReports();
    const missing = await problemsOf(await citizenData({ photoKey: null }));
    assert.deepEqual(fieldsOf(missing, true), [['photo', 'required', 'photo']]);
    const unknownKey = await problemsOf(await citizenData({ photoKey: 'tmp/00000000-0000-4000-8000-000000000000.jpg' }));
    assert.deepEqual(fieldsOf(unknownKey, true), [['photo', 'required', 'photo']]);
    assert.equal(await countReports(), before);
  });

  test('without a description (or with a too short one) nothing is created', async () => {
    const before = await countReports();
    const data = await citizenData();
    delete (data as Record<string, unknown>).description;
    assert.ok((await problemsOf(data)).some((p) => p.field === 'description' && p.step === 'details'));
    assert.deepEqual(fieldsOf(await problemsOf(await citizenData({ description: 'Gropë' }))), [['description', 'too_short']]);
    assert.deepEqual(fieldsOf(await problemsOf(await citizenData({ description: '            ' }))), [['description', 'required']]);
    assert.equal(await countReports(), before);
  });

  test('a report with only a category reports every missing step at once', async () => {
    const problems = await problemsOf({ requestTypeId: await typeId('streets.pothole') });
    const steps = new Set(problems.map((p) => p.step));
    for (const step of ['location', 'photo', 'details', 'contact']) assert.ok(steps.has(step), `missing step ${step}`);
  });

  test('a pin on the map must be inside the Municipality (see tests/location.test.ts for both ways)', async () => {
    const outside = await problemsOf(await citizenData({ latitude: 41.3233, longitude: 19.4414 })); // Durrës
    assert.deepEqual(fieldsOf(outside, true), [['latitude', 'outside_area', 'location']]);
    await problemsOf(await citizenData({ latitude: 0, longitude: 0 }));
    const noPin = await citizenData();
    delete (noPin as Record<string, unknown>).latitude;
    delete (noPin as Record<string, unknown>).longitude;
    assert.equal((await problemsOf(noPin)).filter((p) => p.step === 'location').length, 1, 'reported once, not twice');
  });

  test('the contact step needs a name and an email or phone, or the explicit choice "anonymous"', async () => {
    const before = await countReports();
    assert.deepEqual(fieldsOf(await problemsOf(await citizenData({ contactName: '' })), true), [['contactName', 'required', 'contact']]);
    assert.deepEqual(fieldsOf(await problemsOf(await citizenData({ contactEmail: '', contactPhone: '' }))), [['contactEmail', 'contact_required']]);
    assert.deepEqual(fieldsOf(await problemsOf(await citizenData({ contactEmail: '', contactPhone: '12' }))), [['contactPhone', 'invalid']]);
    assert.ok((await problemsOf(await citizenData({ contactEmail: 'not-an-email' }))).some((p) => p.field === 'contactEmail'));
    const noChoice = await citizenData();
    delete (noChoice as Record<string, unknown>).anonymous;
    assert.ok((await problemsOf(noChoice)).some((p) => p.field === 'anonymous' && p.step === 'contact'));
    assert.equal(await countReports(), before);

    const phoneOnly = await submitReport({ contactEmail: '', contactPhone: '+355 69 123 4567' });
    assert.equal(phoneOnly.report.contactPhone, '+355 69 123 4567');
    assert.equal(phoneOnly.report.wantsUpdates, false);

    const anon = await submitReport({ anonymous: true, contactName: 'Emër', contactEmail: 'x@example.com', contactPhone: '069 000 0000' });
    assert.equal(anon.report.anonymous, true);
    assert.equal(anon.report.contactName, null);
    assert.equal(anon.report.contactEmail, null);
    assert.equal(anon.report.contactPhone, null);
  });

  test('an inactive or unknown report type is refused', async () => {
    const type = await db.requestType.update({ where: { code: 'streets.graffiti' }, data: { active: false } });
    assert.deepEqual(fieldsOf(await problemsOf(await citizenData({ requestTypeId: type.id })), true), [['requestTypeId', 'unknown', 'type']]);
    await db.requestType.update({ where: { id: type.id }, data: { active: true } });
  });

  test('extra fields (status, priority, department) are refused instead of trusted', async () => {
    const before = await countReports();
    const problems = await problemsOf(await citizenData({ status: 'CLOSED', priority: 'HIGH', departmentId: 1 }));
    assert.ok(problems.length > 0);
    assert.equal(await countReports(), before);
  });

  test('a file that is not an image is refused at the photo step', async () => {
    const key = await uploadPhoto(Buffer.from('this is not an image at all'));
    assert.deepEqual(fieldsOf(await problemsOf(await citizenData({ photoKey: key })), true), [['photo', 'invalid', 'photo']]);
  });

  test('photos are re-encoded without metadata (no GPS or device data is kept)', async () => {
    const withExif = await sharp({ create: { width: 200, height: 150, channels: 3, background: '#335533' } })
      .withExif({ IFD0: { Copyright: 'secret-device', Make: 'PhoneMaker' } })
      .jpeg()
      .toBuffer();
    assert.ok((await sharp(withExif).metadata()).exif);
    const { report } = await submitReport({ photoKey: await uploadPhoto(withExif) });
    const attachment = await db.attachment.findFirstOrThrow({ where: { reportId: report.id } });
    const { body } = await openStoredImage(attachment);
    assert.ok(Buffer.isBuffer(body));
    assert.equal((await sharp(body).metadata()).exif, undefined);
    assert.ok(!attachment.storageUrl.includes('tmp/'), 'the temporary upload was replaced by the clean copy');
  });

  test('sending the same offline report twice creates it only once', async () => {
    const data = await citizenData({ clientRef: 'offline-abc-123' });
    const first = await createCitizenReport(data);
    const second = await createCitizenReport({ ...data, photoKey: await uploadPhoto() });
    assert.equal(second.caseNumber, first.caseNumber);
    assert.equal(second.duplicateSubmission, true);
    await drainJobs();
  });
});

describe('tracking, map and duplicates', () => {
  test('the tracking page never shows contact details; description and photo appear once verified', async () => {
    const { result, report } = await submitReport({ contactEmail: 'private@example.com', contactPhone: '+355 68 999 9999' });
    const unverified = await getPublicCase(caseNumberSchema.parse(result.caseNumber.toLowerCase()));
    const text = JSON.stringify(unverified);
    assert.ok(!text.includes('private@example.com'));
    assert.ok(!text.includes('999 9999'));
    assert.ok(!text.includes('Qytetar Test'));
    assert.equal(unverified.publicStatus, 'RECEIVED');
    assert.equal(unverified.description, null);
    assert.equal(unverified.beforePhotoUrl, null);
    assert.ok(unverified.departmentSq);

    const attachment = await db.attachment.findFirstOrThrow({ where: { reportId: report.id } });
    assert.equal((await rejects(() => getPublicPhoto(attachment.id))).status, 404);

    await changeStatus(admin, report.id, { status: 'VERIFIED', publicNote: true });
    const verified = await getPublicCase(result.caseNumber);
    assert.equal(verified.publicStatus, 'OPEN');
    assert.ok(verified.description);
    assert.equal(verified.beforePhotoUrl, `/api/public/photos/${attachment.id}`);
    assert.equal((await getPublicPhoto(attachment.id)).mime, 'image/jpeg');
  });

  test('unknown case numbers are not found and malformed ones fail validation', async () => {
    assert.equal((await rejects(() => getPublicCase('EL-2026-99999'))).status, 404);
    assert.equal(caseNumberSchema.safeParse('hello').success, false);
  });

  test('the same problem nearby is offered, and following it adds a supporter', async () => {
    const { result, report } = await submitReport({ latitude: 41.115, longitude: 20.085 });
    await changeStatus(admin, report.id, { status: 'VERIFIED', publicNote: true });
    const nearby = await findNearbyOpen({ requestTypeId: await typeId('streets.sidewalk'), latitude: 41.11503, longitude: 20.08502 });
    const match = nearby.find((i) => i.caseNumber === result.caseNumber);
    assert.ok(match, 'same category within 50 m is offered');
    assert.ok(match.distanceMeters! <= 50);
    const far = await findNearbyOpen({ requestTypeId: await typeId('streets.pothole'), latitude: 41.12, longitude: 20.095 });
    assert.ok(!far.some((i) => i.caseNumber === result.caseNumber));
    const follow = await followReport(result.caseNumber, 'fqinji@example.com');
    assert.equal(follow.supporters, 1);
  });

  test('the map shows a report at once, with its status ("Marrë", then the next ones), rounded; never a rejected one', async () => {
    const { result, report } = await submitReport({ latitude: 41.112345, longitude: 20.082345 });
    let point = (await mapPoints(mapSchema.parse({ status: 'open' }))).find((p) => p.caseNumber === result.caseNumber);
    assert.equal(point?.publicStatus, 'RECEIVED');
    assert.equal(point.latitude, 41.1123);
    // Not verified yet: on the map, but without photo and description.
    const card = (await listRecent(recentSchema.parse({ status: 'open' }))).find((p) => p.caseNumber === result.caseNumber);
    assert.ok(card);
    assert.equal(card.photoUrl, null);
    await changeStatus(admin, report.id, { status: 'VERIFIED', publicNote: true });
    point = (await mapPoints(mapSchema.parse({ status: 'open' }))).find((p) => p.caseNumber === result.caseNumber);
    assert.equal(point?.publicStatus, 'OPEN');

    const rejected = await submitReport({ latitude: 41.1124, longitude: 20.0823 });
    await rejectReport(admin, rejected.report.id, { reason: 'Nuk është problem publik.' });
    assert.ok(!(await mapPoints(mapSchema.parse({ status: 'all' }))).some((p) => p.caseNumber === rejected.result.caseNumber));
  });

  test('public statistics exclude demo reports', async () => {
    await invalidate(CACHE_KEYS.publicStats);
    const before = (await publicStats()).totals.total;
    const { report } = await submitReport();
    await db.report.update({ where: { id: report.id }, data: { isTest: true } });
    await invalidate(CACHE_KEYS.publicStats);
    assert.equal((await publicStats()).totals.total, before);
  });
});

describe('the resident confirms after the department resolves the report', () => {
  async function resolvedReport() {
    const { result, report } = await submitReport({ contactEmail: 'konfirmo@example.com' });
    await resolveReport(admin, report.id, { note: 'U mbush gropa me asfalt.', photoKey: await uploadPhoto(await jpeg('#222222')) });
    await drainJobs();
    const mail = await db.emailLog.findFirst({ where: { template: 'resolved_confirm', reportId: report.id } });
    assert.ok(mail, 'the resident gets the "was it fixed?" email');
    const token = /\/konfirmo\/([A-Za-z0-9_-]+)/.exec(mail.bodyText)![1]!;
    return { result, report, token };
  }

  test('confirming closes the report with the rating; the link then stops working', async () => {
    const { report, token } = await resolvedReport();
    const info = await getFeedbackInfo(token);
    assert.equal(info.publicStatus, 'RESOLVED');
    assert.ok(info.afterPhotoUrl);
    await submitCitizenFeedback({ token, action: 'confirm', rating: 5 });
    const closed = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(closed.status, 'CLOSED');
    assert.equal(closed.citizenRating, 5);
    assert.ok(closed.closedAt);
    assert.equal((await rejects(() => getFeedbackInfo(token))).status, 404);
    assert.equal((await rejects(() => submitCitizenFeedback({ token, action: 'reopen' }))).status, 404);
  });

  test('reopening sends the report back to work and tells the department', async () => {
    const { report, token } = await resolvedReport();
    await submitCitizenFeedback({ token, action: 'reopen', comment: 'Gropa është ende aty.' });
    await drainJobs();
    const reopened = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(reopened.status, 'IN_PROGRESS');
    assert.equal(reopened.reopenCount, 1);
    assert.equal(reopened.resolvedAt, null);
    assert.equal(reopened.closingNote, null);
  });
});

describe('robustness', () => {
  test('reports left PENDING (a lost job) are checked again by the daily job', async () => {
    const { report } = await submitReport();
    await db.report.update({ where: { id: report.id }, data: { status: 'PENDING', createdAt: new Date(Date.now() - 3600_000) } });
    const result = await runDaily();
    assert.ok(result.rechecked >= 1);
    await drainJobs();
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: report.id } })).status, 'NEEDS_REVIEW');
  });
});

describe('privacy of the public page', () => {
  test('emails and phone numbers typed in the description are never shown publicly', async () => {
    const { report, result } = await submitReport({
      description: 'Gropë e madhe. Më telefononi në 069 123 4567 ose shkruani te emri.mbiemri@example.com. Data 28.10.2026.',
    });
    await changeStatus(admin, report.id, { status: 'VERIFIED', publicNote: true });
    const pub = await getPublicCase(result.caseNumber);
    assert.equal(pub.description, 'Gropë e madhe. Më telefononi në [telefon] ose shkruani te [email]. Data 28.10.2026.');
    const staffView = await getReport(admin, report.id);
    assert.match(staffView.description ?? '', /069 123 4567/);
  });
});

describe('home page search: open reports on a street', () => {
  test('finds open public reports by street, area or type, ignoring ë/ç and case; never by description', async () => {
    const verified = await submitReport({ address: 'Sheshi Skënderbej 4', description: 'Gropë e madhe, telefononi 069 555 1234' });
    await changeStatus(admin, verified.report.id, { status: 'VERIFIED', publicNote: true });
    const unverified = await submitReport({ address: 'Sheshi Skënderbej 9' });
    if (unverified.report.status === 'VERIFIED') await changeStatus(admin, unverified.report.id, { status: 'NEEDS_REVIEW', publicNote: false });
    const closed = await submitReport({ address: 'Sheshi Skënderbej 1' });
    await changeStatus(admin, closed.report.id, { status: 'CLOSED', note: 'U rregullua.', publicNote: true });

    const found = (q: string) => searchOpenByPlace(q).then((list) => list.map((c) => c.caseNumber).sort());
    const open = [verified.result.caseNumber, unverified.result.caseNumber].sort();
    assert.deepEqual(await found('skenderbej'), open, 'without ë, any case; the open ones, also the one just received, never the closed one');
    assert.deepEqual(await found('SKËNDERBEJ'), open);
    assert.deepEqual(await found('gropë skenderbej'), open, 'type + street');
    assert.deepEqual(await found('ndriçim skenderbej'), [], 'every word must match');
    assert.deepEqual(await found('069 555'), [], 'the description (and any phone in it) is not searched');
    assert.deepEqual(await found('%%'), [], 'LIKE wildcards are plain text');
    const card = (await searchOpenByPlace('skenderbej')).find((c) => c.caseNumber === verified.result.caseNumber)!;
    assert.equal(card.address, 'Sheshi Skënderbej 4');
    assert.equal('contactEmail' in card, false);
  });
});
