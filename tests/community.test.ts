/**
 * "Ndihmo qytetin": an action residents organise, joined by scanning a QR that changes
 * every 30 seconds on the spot, closed by the organiser with the "after" photo, and ONE
 * prize for the group (by its size, within the budget, one a month per organiser).
 * The AI is a small fake server; the push service is a recorder.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import { resetConfigForTests } from '@/lib/server/env';
import {
  cancelStaleActions, checkClosedAction, getActionForDevice, choosePrize, closeAction, createAction, decideAction, getOrganizerAction, getPrize,
  getPublicAction, joinAction, joinTokenAt, listPublicActions, normalizePhone, prizeForPeople, redeemPrize, setSpotCheckForTests,
  updateCommunitySettings, voteAction,
} from '@/lib/server/services/community';
import { setPushSenderForTests } from '@/lib/server/services/push';
import type { Principal } from '@/lib/shared/types';
import { ELBASAN, adminSession, db, drainJobs, rejects, setupTestDb, teardown, uploadPhoto } from './helpers';

// What the fake AI answers next, by the kind of question.
const ai = { check: { safe: true, appropriate: true, confidence: 92, reasonSq: 'Pastrim i thjeshtë në park.' } as Record<string, unknown>, close: { samePlace: true, done: true, confidence: 95, reasonSq: 'Zona është pastruar.' } as Record<string, unknown> };
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const sys = String(JSON.parse(raw).messages?.[0]?.content ?? '');
    const answer = sys.includes('Compare their two photos') ? ai.close
      : sys.includes('You check an action') ? ai.check
        : sys.includes('invite neighbours') ? { citizensCanDo: true, titleSq: 'Pastrojmë parkun', descriptionSq: 'Bashkohuni për të mbledhur mbeturinat në park.', peopleNeeded: 4, minutes: 60, bringSq: 'Doreza dhe thasë' }
          : { ok: true };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 500, completion_tokens: 50 } }));
  });
});

const sent: Array<{ endpoint: string; title: string }> = [];
const SUB = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/dev-${n}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
const NEAR = { latitude: ELBASAN.latitude + 0.0005, longitude: ELBASAN.longitude }; // ~55 m
let admin: Principal;
let phoneN = 0;

before(async () => {
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  process.env.AI_ENABLED = 'true';
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_MODEL = 'fake-model';
  process.env.AI_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  resetConfigForTests();
  await setupTestDb();
  admin = await adminSession();
  setPushSenderForTests(async (sub, payload) => { sent.push({ endpoint: sub.endpoint, title: JSON.parse(payload).title }); });
});
after(async () => {
  await teardown();
  fake.close();
});
beforeEach(() => {
  ai.check = { safe: true, appropriate: true, confidence: 92, reasonSq: 'Pastrim i thjeshtë në park.' };
  ai.close = { samePlace: true, done: true, confidence: 95, reasonSq: 'Zona është pastruar.' };
  setSpotCheckForTests(() => false);
});

async function newAction(overrides: Partial<Parameters<typeof createAction>[0]> = {}) {
  phoneN++;
  return createAction({
    photoKey: await uploadPhoto(), title: 'Pastrojmë parkun e lagjes', description: 'Mbledhim mbeturinat e shpërndara në park bashkë.',
    bring: 'Doreza', place: 'Parku te shkolla', ...ELBASAN, startsAt: new Date(Date.now() + 5 * 60_000), minutes: 60, peopleNeeded: 3,
    organizerName: 'Ana Hoxha', organizerPhone: `069 ${String(1000000 + phoneN).slice(0, 7)}`, deviceRef: `organizer-device-${phoneN}-xxxx`,
    push: SUB(100 + phoneN), lang: 'sq', ...overrides,
  });
}

async function join(code: string, n: number, over: Partial<Parameters<typeof joinAction>[0]> = {}) {
  const a = await db.communityAction.findUniqueOrThrow({ where: { code } });
  return joinAction({ code, token: joinTokenAt(a.joinSecret, Date.now()), deviceRef: `participant-${code}-${n}-yy`, ...NEAR, name: `Person${n}`, push: SUB(n), lang: 'sq', ...over });
}

describe('creating an action', () => {
  test('a clear, safe action is published at once; the phone is never public', async () => {
    const { code, status, organizerToken } = await newAction();
    assert.equal(status, 'PUBLISHED');
    assert.match(code, /^AK-\d{4}-\d{4}$/);
    const pub = await getPublicAction(code);
    assert.equal(pub.organizerName, 'Ana');
    assert.equal(pub.people, 1);
    assert.ok(pub.beforePhotoUrl);
    assert.doesNotMatch(JSON.stringify(pub), /069/);
    const org = await getOrganizerAction(code, organizerToken);
    assert.ok(org.joinToken, 'the QR shows around the action’s time');
    assert.equal((await rejects(() => getOrganizerAction(code, 'x'.repeat(32)))).status, 403);
    assert.ok((await listPublicActions()).upcoming.some((c) => c.code === code));
  });

  test('a doubtful action waits for the admin and is not public until approved', async () => {
    ai.check = { safe: false, appropriate: true, confidence: 85, reasonSq: 'Punë me rrymë.' };
    const { code, status } = await newAction({ title: 'Ndërrojmë llambën e rrugës' });
    assert.equal(status, 'REVIEW');
    assert.equal((await rejects(() => getPublicAction(code))).status, 404);
    const row = await db.communityAction.findUniqueOrThrow({ where: { code } });
    assert.match(row.reviewReason ?? '', /rrezikshme/);
    sent.length = 0;
    await decideAction(admin, row.id, 'publish', '');
    await drainJobs();
    assert.equal((await getPublicAction(code)).status, 'PUBLISHED');
    assert.ok(sent.some((m) => m.title.includes('u publikua')));
  });

  test('one phone cannot keep many actions open; places outside the municipality are refused', async () => {
    const phone = '+355 68 777 1234';
    await newAction({ organizerPhone: phone });
    await newAction({ organizerPhone: '068 777 1234' });
    assert.equal((await rejects(() => newAction({ organizerPhone: '0687771234' }))).status, 429);
    assert.equal(normalizePhone(phone), '0687771234');
    assert.equal((await rejects(() => newAction({ latitude: 41.9981, longitude: 21.4254 }))).status, 400);
  });
});

describe('joining with the QR', () => {
  test('only on the spot, with a fresh code, once per device; the organiser is counted by himself', async () => {
    const { code } = await newAction();
    const a = await db.communityAction.findUniqueOrThrow({ where: { code } });
    const old = joinTokenAt(a.joinSecret, Date.now() - 5 * 60_000);
    assert.equal((await rejects(() => joinAction({ code, token: old, deviceRef: 'late-scanner-device-1', ...NEAR, name: '', lang: 'sq' }))).code, 'QR_EXPIRED');
    assert.equal((await rejects(() => join(code, 1, { latitude: ELBASAN.latitude + 0.01 }))).code, 'TOO_FAR');
    assert.equal((await rejects(() => join(code, 1, { deviceRef: a.organizerDevice }))).status, 409);
    await join(code, 1);
    await join(code, 1); // the same phone again: still one person
    const pub = await join(code, 2, { name: '' });
    assert.equal(pub.people, 3);
    assert.deepEqual(pub.names, ['Person1']);
  });

  test('scanning is closed long before the start', async () => {
    const { code } = await newAction({ startsAt: new Date(Date.now() + 5 * 3600_000) });
    assert.equal((await getPublicAction(code)).joinOpen, false);
    assert.equal((await rejects(() => join(code, 1))).status, 409);
  });
});

describe('closing, the prize and the partners', () => {
  test('a sure AI comparison verifies at once: the group of 3 gets 300 lek, the organiser chooses once, the partner redeems once', async () => {
    const { code, organizerToken } = await newAction();
    await join(code, 1);
    await join(code, 2);
    sent.length = 0;
    const closed = await closeAction({ code, token: organizerToken, photoKey: await uploadPhoto() });
    assert.equal(closed.status, 'VERIFIED');
    assert.equal(closed.prize?.amount, 300);
    await drainJobs();
    assert.equal(sent.filter((m) => m.title.includes('300 lekë')).length, 3, 'the organiser and both people who scanned');

    await updateCommunitySettings(admin, { enabled: true, tiers: [{ minPeople: 1, amount: 200 }, { minPeople: 3, amount: 300 }, { minPeople: 6, amount: 500 }], coffeePartner: 'Kafe Skampa', marketPartner: 'Market X', monthlyBudget: 20000, checkFrom: 500, partnerPin: '4321' });
    const chosen = await choosePrize({ code, token: organizerToken, choice: 'COFFEE' });
    assert.equal(chosen.prize?.choice, 'COFFEE');
    assert.equal(chosen.prize?.partner, 'Kafe Skampa');
    assert.ok(chosen.prizeCode);
    assert.equal((await rejects(() => choosePrize({ code, token: organizerToken, choice: 'MARKET' }))).status, 409);
    assert.equal((await getPublicAction(code)).prize, null, 'others never see money');
    assert.equal((await getActionForDevice(code, `participant-${code}-1-yy`)).prize?.choice, 'COFFEE', 'those who took part see the reward');

    assert.equal((await rejects(() => redeemPrize(chosen.prizeCode!, '0000'))).status, 403);
    const used = await redeemPrize(chosen.prizeCode!, '4321');
    assert.ok(used.redeemedAt);
    assert.equal((await rejects(() => redeemPrize(chosen.prizeCode!, '4321'))).status, 409);
    assert.equal((await getPrize(chosen.prizeCode!)).amount, 300);
  });

  test('an unsure comparison, a valuable prize or a random check waits for the admin', async () => {
    ai.close = { samePlace: true, done: true, confidence: 60, reasonSq: 'Nuk duket qartë.' };
    const unsure = await newAction();
    assert.equal((await closeAction({ code: unsure.code, token: unsure.organizerToken, photoKey: await uploadPhoto() })).status, 'CLOSING');

    ai.close = { samePlace: true, done: true, confidence: 97 };
    const big = await newAction({ peopleNeeded: 6 });
    for (let i = 1; i <= 5; i++) await join(big.code, i);
    const bigClosed = await closeAction({ code: big.code, token: big.organizerToken, photoKey: await uploadPhoto() });
    assert.equal(bigClosed.status, 'CLOSING');
    const row = await db.communityAction.findUniqueOrThrow({ where: { code: big.code } });
    assert.match(row.reviewReason ?? '', /500 lekë/);
    await decideAction(admin, row.id, 'verify', '');
    assert.equal((await getOrganizerAction(big.code, big.organizerToken)).prize?.amount, 500);

    setSpotCheckForTests(() => true);
    const spot = await newAction();
    assert.equal((await closeAction({ code: spot.code, token: spot.organizerToken, photoKey: await uploadPhoto() })).status, 'CLOSING');
    const spotRow = await db.communityAction.findUniqueOrThrow({ where: { code: spot.code } });
    await decideAction(admin, spotRow.id, 'not_verified', 'Fotot nuk tregojnë të njëjtin vend.');
    assert.equal((await getPublicAction(spot.code)).status, 'NOT_VERIFIED');
  });

  test('one prize a month per organiser: the next verified action is thanked without money', async () => {
    const phone = '069 555 0000';
    const first = await newAction({ organizerPhone: phone });
    assert.equal((await closeAction({ code: first.code, token: first.organizerToken, photoKey: await uploadPhoto() })).prize?.amount, 200);
    const second = await newAction({ organizerPhone: phone });
    assert.equal((await closeAction({ code: second.code, token: second.organizerToken, photoKey: await uploadPhoto() })).prize?.amount, 0);
    assert.equal((await rejects(() => choosePrize({ code: second.code, token: second.organizerToken, choice: 'MARKET' }))).status, 409);
  });

  test('two neighbours saying "not done" hold the prize until the admin looks', async () => {
    const { code, organizerToken } = await newAction();
    await join(code, 1);
    await closeAction({ code, token: organizerToken, photoKey: await uploadPhoto() });
    assert.equal((await rejects(() => voteAction({ code, deviceRef: `participant-${code}-1-yy`, done: false }))).status, 409, 'people who took part do not vote');
    await voteAction({ code, deviceRef: 'neighbour-device-0001', done: false });
    await voteAction({ code, deviceRef: 'neighbour-device-0002', done: false });
    assert.equal((await getOrganizerAction(code, organizerToken)).prize?.held, true);
    assert.equal((await rejects(() => choosePrize({ code, token: organizerToken, choice: 'COFFEE' }))).status, 409);
    const row = await db.communityAction.findUniqueOrThrow({ where: { code } });
    await decideAction(admin, row.id, 'release_prize', '');
    assert.equal((await choosePrize({ code, token: organizerToken, choice: 'MARKET' })).prize?.choice, 'MARKET');
  });

  test('prize tiers, and actions never closed are cancelled', async () => {
    const tiers = [{ minPeople: 1, amount: 200 }, { minPeople: 3, amount: 300 }, { minPeople: 6, amount: 500 }];
    assert.deepEqual([1, 2, 3, 5, 6, 12].map((n) => prizeForPeople(tiers, n)), [200, 200, 300, 300, 500, 500]);
    const { code } = await newAction();
    await db.communityAction.update({ where: { code }, data: { startsAt: new Date(Date.now() - 4 * 86_400_000) } });
    assert.ok((await cancelStaleActions()) >= 1);
    assert.equal((await getPublicAction(code)).status, 'CANCELLED');
    // checkClosedAction on a missing or open action does nothing.
    await checkClosedAction('00000000-0000-4000-8000-000000000000');
  });
});
