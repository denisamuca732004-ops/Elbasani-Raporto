/**
 * "Më njoftoni në këtë telefon": free notifications on the resident's phone at three moments
 * (in work, fixed with the "A u rregullua?" link, refused), only for the device of the resident
 * who sent the report. The push service itself is replaced by a recorder.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { changeStatus, rejectReport, resolveReport } from '@/lib/server/services/report';
import { setPushSenderForTests, subscribeToReport, vapidKeys } from '@/lib/server/services/push';
import type { Principal } from '@/lib/shared/types';
import { adminSession, db, drainJobs, rejects, setupTestDb, submitReport, teardown } from './helpers';

const sent: Array<{ endpoint: string; message: { title: string; body: string; url: string } }> = [];
let gone = new Set<string>();
let admin: Principal;
const SUB = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });

before(async () => {
  await setupTestDb();
  admin = await adminSession();
  setPushSenderForTests(async (sub, payload) => {
    if (gone.has(sub.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload) });
  });
});
after(teardown);

async function reportWithPhone(ref: string, device = 1) {
  const { result, report } = await submitReport({ clientRef: ref, description: 'Gropë e thellë para shkollës' });
  await subscribeToReport({ caseNumber: result.caseNumber, clientRef: ref, subscription: SUB(device), lang: 'sq' });
  return { caseNumber: result.caseNumber, id: report.id };
}

describe('notifications on the resident\'s phone', () => {
  test('the keys are a stable P-256 pair (no configuration needed)', () => {
    const k = vapidKeys();
    assert.equal(Buffer.from(k.publicKey, 'base64url').length, 65);
    assert.equal(Buffer.from(k.publicKey, 'base64url')[0], 4);
    assert.deepEqual(vapidKeys(), k);
  });

  test('only the browser that sent the report can subscribe, only to a real push service', async () => {
    const { result } = await submitReport({ clientRef: 'ref-owner-0001' });
    assert.equal((await rejects(() => subscribeToReport({ caseNumber: result.caseNumber, clientRef: 'someone-else-01', subscription: SUB(9), lang: 'sq' }))).status, 404);
    assert.equal((await rejects(() => subscribeToReport({ caseNumber: result.caseNumber, clientRef: 'ref-owner-0001', subscription: { ...SUB(9), endpoint: 'https://evil.example/hook' }, lang: 'sq' }))).status, 400);
    await subscribeToReport({ caseNumber: result.caseNumber, clientRef: 'ref-owner-0001', subscription: SUB(9), lang: 'sq' });
    await subscribeToReport({ caseNumber: result.caseNumber, clientRef: 'ref-owner-0001', subscription: SUB(9), lang: 'en' });
    assert.equal(await db.pushSubscription.count({ where: { report: { caseNumber: result.caseNumber } } }), 1, 'the same device once');
  });

  test('in work, then fixed with the "A u rregullua?" link (even without an e-mail)', async () => {
    const r = await reportWithPhone('ref-flow-00001', 1);
    sent.length = 0;
    await changeStatus(admin, r.id, { status: 'IN_PROGRESS', note: 'Ekipi del nesër.', publicNote: true });
    await drainJobs();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.message.title, 'Raportimi juaj është në punë');
    assert.match(sent[0]!.message.body, new RegExp(`${r.caseNumber}.*Ekipi del nesër`));
    assert.match(sent[0]!.message.url, new RegExp(`/ndiq/${r.caseNumber}$`));

    await resolveReport(admin, r.id, { note: 'Gropa u mbush.' });
    await drainJobs();
    assert.equal(sent.length, 2);
    assert.match(sent[1]!.message.body, /A u rregullua vërtet/);
    assert.match(sent[1]!.message.url, /\/konfirmo\/[A-Za-z0-9_-]+$/, 'the confirmation link');
    const report = await db.report.findUniqueOrThrow({ where: { id: r.id } });
    assert.ok(report.citizenTokenHash, 'the link works');
  });

  test('refused: the reason is sent, then the subscription is deleted', async () => {
    const r = await reportWithPhone('ref-reject-0001', 2);
    sent.length = 0;
    await rejectReport(admin, r.id, { reason: 'Rruga është private, nuk i përket Bashkisë.' });
    await drainJobs();
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.message.body, /Rruga është private/);
    assert.equal(await db.pushSubscription.count({ where: { reportId: r.id } }), 0);
  });

  test('nobody subscribed: nothing is sent; a device that is gone is deleted', async () => {
    const { report } = await submitReport({ clientRef: 'ref-nobody-0001' });
    sent.length = 0;
    await changeStatus(admin, report.id, { status: 'IN_PROGRESS', publicNote: true });
    await drainJobs();
    assert.equal(sent.length, 0);

    const r = await reportWithPhone('ref-gone-000001', 3);
    gone = new Set([SUB(3).endpoint]);
    await changeStatus(admin, r.id, { status: 'IN_PROGRESS', publicNote: true });
    await drainJobs();
    assert.equal(await db.pushSubscription.count({ where: { reportId: r.id } }), 0);
  });
});
