/**
 * AI checks against a fake OpenAI-compatible server, so the real integration
 * (HTTP call, JSON parsing, caching, thresholds, priorities, fallbacks) is
 * tested without spending money.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { resetConfigForTests } from '@/lib/server/env';
import { getReport, resolveReport } from '@/lib/server/services/report';
import { createCitizenReport, getPublicCase } from '@/lib/server/services/publicReport';
import { testAiConnection } from '@/lib/server/ai';
import { checkPhoto } from '@/lib/server/services/photoCheck';
import { changePriority, changeStatus } from '@/lib/server/services/report';
import { extractFromText } from '@/lib/server/services/triage';
import type { Principal } from '@/lib/shared/types';
import { adminSession, citizenData, db, drainJobs, jpeg, setupTestDb, submitReport, teardown, typeId, uploadPhoto } from './helpers';

const calls: Array<{ auth?: string; body: { model: string; messages: Array<{ content: unknown }> } }> = [];
let mode: 'ok' | 'error' | 'unauthorized' | 'quota' = 'ok';
/** What the fake AI answers to the photo check (and whether it refuses to look). */
let photoAnswer: Record<string, unknown> = { safe: true, matches: true, kind: 'scene' };
let photoRefuses = false;
let hold: Promise<void> | null = null; // lets a test keep the AI "thinking"
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    const body = JSON.parse(raw);
    calls.push({ auth: req.headers.authorization, body });
    // The hold keeps the check of the whole report "thinking", not the photo check of the form.
    if (hold && !String(body.messages[0].content).includes('check a photo')) await hold;
    if (mode === 'error') {
      res.writeHead(500).end('boom');
      return;
    }
    if (mode === 'unauthorized') {
      res.writeHead(401).end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-abcdEFGH1234. You can find your API key at https://platform.openai.com/account/api-keys.' } }));
      return;
    }
    if (mode === 'quota') {
      res.writeHead(429).end(JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details.', code: 'insufficient_quota' } }));
      return;
    }
    const system = String(body.messages[0].content);
    const user = JSON.stringify(body.messages[1].content);
    let answer: Record<string, unknown>;
    if (system.includes('check a photo') && photoRefuses) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: null, refusal: 'I can’t help with that.' } }] }));
      return;
    }
    if (system.includes('check a photo')) {
      answer = photoAnswer;
    } else if (system.includes('intake assistant')) {
      const blurry = user.includes('blurry');
      const face = user.includes('selfie');
      const manhole = user.includes('pus pa kapak');
      const minor = user.includes('pak e vogël');
      answer = {
        suggested_type_code: manhole ? 'water.open_manhole' : 'streets.pothole',
        priority: manhole ? 'high' : minor ? 'low' : 'medium',
        summary: manhole ? 'Pus i hapur në trotuar' : 'Gropë e madhe në rrugë',
        photo: { present: true, matches_report: !blurry, confidence: blurry ? 40 : 92, privacy_issue: face, reason: 'test reason' },
      };
    } else if (system.includes('turn a message')) {
      answer = {
        type_code: 'lighting.light_out', description: 'Drita e rrugës është e fikur', address: 'Rruga Rinia',
        summary: 'Dritë e fikur', priority: 'high', contact_name: 'Beni', contact_phone: '069 111 2222 (cel)',
      };
    } else {
      answer = { fixed: true, confidence: 88, reason: 'clean now' };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    // Some models wrap JSON in code fences; the client must cope.
    res.end(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` } }] }));
  });
});

let admin: Principal;
before(async () => {
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  process.env.AI_ENABLED = 'true';
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_MODEL = 'fake-model';
  process.env.AI_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  resetConfigForTests();
  await setupTestDb();
  admin = await adminSession();
});
after(async () => {
  await teardown();
  fake.close();
});

describe('AI check of resident reports', () => {
  test('a clear matching photo is verified automatically and becomes public', async () => {
    const before = calls.length;
    const { report, result } = await submitReport({ description: 'Gropë shumë e thellë në rrugë' });
    assert.equal(report.aiStatus, 'DONE');
    assert.equal(report.status, 'VERIFIED');
    assert.equal(report.aiConfidence, 92);
    assert.equal(report.aiSummary, 'Gropë e madhe në rrugë');
    assert.ok(report.verifiedAt);
    assert.equal(calls.length, before + 2, 'one photo check while creating, one check of the whole report');
    const call = calls.at(-1)!;
    assert.equal(call.auth, 'Bearer test-key');
    assert.equal(call.body.model, 'fake-model');
    assert.match(JSON.stringify(call.body.messages[1]!.content), /data:image\/jpeg;base64/);
    const pub = await getPublicCase(result.caseNumber);
    assert.equal(pub.publicStatus, 'OPEN');
    assert.ok(pub.beforePhotoUrl);
  });

  test('a photo that does not match goes to the department for review', async () => {
    const { report } = await submitReport({ description: 'blurry foto e gropës në rrugë' });
    assert.equal(report.status, 'NEEDS_REVIEW');
    assert.match(report.aiReason ?? '', /Besueshmëri e ulët/);
  });

  test('a face or licence plate hides the photo from the public', async () => {
    const { report } = await submitReport({ description: 'selfie para gropës në rrugë' });
    assert.equal(report.status, 'NEEDS_REVIEW');
    assert.equal(report.aiPrivacyIssue, true);
    const photo = await db.attachment.findFirstOrThrow({ where: { reportId: report.id } });
    assert.equal(photo.isPublic, false);
    assert.equal(await db.reportEvent.count({ where: { reportId: report.id, type: 'PHOTO_VISIBILITY' } }), 1);
  });

  test('the AI can raise the priority and suggest another type, but never lower the priority', async () => {
    const manhole = await submitReport({ description: 'Një pus pa kapak në trotuar, shumë rrezik' });
    assert.equal(manhole.report.priority, 'HIGH');
    assert.equal(manhole.report.aiSuggestedPriority, 'HIGH');
    const suggested = await db.requestType.findUniqueOrThrow({ where: { id: manhole.report.aiSuggestedTypeId! } });
    assert.equal(suggested.code, 'water.open_manhole');
    assert.equal((await getReport(admin, manhole.report.id)).ai.suggestedType?.code, 'water.open_manhole');

    const minor = await submitReport({ description: 'Një gropë pak e vogël në anë të rrugës' });
    assert.equal(minor.report.aiSuggestedPriority, 'LOW');
    assert.equal(minor.report.priority, 'MEDIUM', 'the default priority of the type stays');
  });

  test('when the AI fails the keyword rules are used and a person reviews it', async () => {
    mode = 'error';
    try {
      const { report } = await submitReport({ description: 'Gropë e madhe dhe e rrezikshme, ka pasur aksident' });
      assert.equal(report.aiStatus, 'FAILED');
      assert.equal(report.status, 'NEEDS_REVIEW');
      assert.equal(report.priority, 'HIGH', 'danger words still raise the priority');
      assert.match(report.aiReason ?? '', /AI nuk u përgjigj/);
    } finally {
      mode = 'ok';
    }
  });

  test('a person who acts while the AI is still answering keeps the last word', async () => {
    let release = () => {};
    hold = new Promise<void>((resolve) => { release = resolve; });
    try {
      const created = await createCitizenReport(await citizenData({ description: 'Gropë e thellë te kryqëzimi i rrugës kryesore' }));
      const report = await db.report.findUniqueOrThrow({ where: { caseNumber: created.caseNumber } });
      const before = calls.length; // after the photo check of the form
      const job = drainJobs(); // the AI check starts and waits for the fake server
      for (let i = 0; calls.length === before && i < 500; i += 1) await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls.length, before + 1, 'the AI is answering');
      await changePriority(admin, report.id, 'LOW');
      await changeStatus(admin, report.id, { status: 'IN_PROGRESS', publicNote: true });
      release();
      await job;
      const after = await db.report.findUniqueOrThrow({ where: { id: report.id } });
      assert.equal(after.status, 'IN_PROGRESS', 'the AI does not overwrite the status');
      assert.equal(after.priority, 'LOW', 'the AI does not overwrite the priority');
      assert.equal(after.aiStatus, 'DONE', 'the AI suggestion is still saved');
      assert.equal(after.aiSummary, 'Gropë e madhe në rrugë');
      assert.equal(await db.reportEvent.count({ where: { reportId: report.id, type: 'STATUS_CHANGED', actorId: null } }), 0);
    } finally {
      release();
      hold = null;
    }
  });

  test('the same question is answered from the cache (no second paid call)', async () => {
    const text = 'Facebook: drita e rrugës te Rruga Rinia nuk punon. Beni 069 111 2222';
    const first = await extractFromText(text);
    const afterFirst = calls.length;
    const second = await extractFromText(text);
    assert.equal(calls.length, afterFirst);
    assert.deepEqual(second, first);
    assert.equal(await db.aiResult.count({ where: { kind: 'extract' } }), 1);
  });
});

describe('the photo check while the report is created', () => {
  const pothole = () => typeId('streets.pothole');

  test('a photo of the problem passes, and sending the report asks the AI no second time', async () => {
    photoAnswer = { safe: true, matches: true, kind: 'scene' };
    const photoKey = await uploadPhoto();
    assert.deepEqual(await checkPhoto(photoKey, await pothole()), { verdict: 'ok' });
    const call = calls.at(-1)!;
    assert.match(String(call.body.messages[0]!.content), /check a photo/);
    assert.match(JSON.stringify(call.body.messages[1]!.content), /Pothole|pothole/);
    assert.match(JSON.stringify(call.body.messages[1]!.content), /data:image\/jpeg;base64/);
    const afterCheck = calls.length;
    const result = await createCitizenReport(await citizenData({ photoKey }));
    assert.ok(result.caseNumber);
    assert.equal(calls.length, afterCheck, 'the check of the form is reused (no second paid call)');
  });

  test('an inappropriate photo is refused: no report is created and the upload is deleted', async () => {
    photoAnswer = { safe: false, matches: false, kind: 'people' };
    const photoKey = await uploadPhoto(await jpeg('#d08080'));
    assert.deepEqual(await checkPhoto(photoKey, await pothole()), { verdict: 'inappropriate' });
    const reportsBefore = await db.report.count();
    await assert.rejects(createCitizenReport(await citizenData({ photoKey })), (err: { code?: string; details?: Array<{ field: string; code: string; step: string }> }) => {
      assert.equal(err.code, 'REPORT_INCOMPLETE');
      assert.deepEqual(err.details?.map((d) => [d.field, d.code, d.step]), [['photo', 'inappropriate', 'photo']]);
      return true;
    });
    assert.equal(await db.report.count(), reportsBefore);
    // The same photo cannot be used again: its temporary upload is gone.
    await assert.rejects(createCitizenReport(await citizenData({ photoKey })), (err: { details?: Array<{ field: string }> }) => err.details?.[0]?.field === 'photo');
    photoAnswer = { safe: true, matches: true, kind: 'scene' };
  });

  test('a document or a screenshot is refused like an inappropriate photo (it is not a photo of a place)', async () => {
    photoAnswer = { safe: true, matches: false, kind: 'document' };
    const photoKey = await uploadPhoto(await jpeg('#f4f4f4'));
    assert.deepEqual(await checkPhoto(photoKey, await pothole()), { verdict: 'not_photo' });
    await assert.rejects(createCitizenReport(await citizenData({ photoKey })), (err: { code?: string; details?: Array<{ field: string; code: string }> }) => {
      assert.equal(err.code, 'REPORT_INCOMPLETE');
      assert.deepEqual(err.details?.map((d) => [d.field, d.code]), [['photo', 'not_photo']]);
      return true;
    });
    photoAnswer = { safe: true, matches: true, kind: 'scene' };
  });

  test('a photo that does not show the problem only gets a warning: the resident may still send it', async () => {
    photoAnswer = { safe: true, matches: false, kind: 'scene' };
    try {
      const photoKey = await uploadPhoto(await jpeg('#3060a0'));
      assert.deepEqual(await checkPhoto(photoKey, await pothole()), { verdict: 'unrelated' });
      const result = await createCitizenReport(await citizenData({ photoKey }));
      assert.ok(result.caseNumber);
    } finally {
      photoAnswer = { safe: true, matches: true, kind: 'scene' };
    }
  });

  test('a model that refuses to look at the photo counts as an inappropriate photo', async () => {
    photoRefuses = true;
    try {
      const photoKey = await uploadPhoto(await jpeg('#a0a030'));
      assert.deepEqual(await checkPhoto(photoKey, await pothole()), { verdict: 'inappropriate' });
      await assert.rejects(createCitizenReport(await citizenData({ photoKey })), (err: { code?: string }) => err.code === 'REPORT_INCOMPLETE');
    } finally {
      photoRefuses = false;
    }
  });

  test('when the AI does not answer, the photo is not refused (the department checks it)', async () => {
    mode = 'error';
    try {
      const photoKey = await uploadPhoto(await jpeg('#30a060'));
      assert.deepEqual(await checkPhoto(photoKey, await pothole()), { verdict: 'unchecked' });
      assert.ok((await createCitizenReport(await citizenData({ photoKey }))).caseNumber);
    } finally {
      mode = 'ok';
    }
    await drainJobs();
  });
});

describe('"Provo lidhjen me AI" in the panel', () => {
  test('a working connection says so', async () => {
    assert.deepEqual(await testAiConnection(), { ok: true });
  });

  test('a wrong key, no credit or no answer are told apart, and the key never shows', async () => {
    try {
      mode = 'unauthorized';
      const key = await testAiConnection();
      assert.equal(key.problem, 'key');
      assert.doesNotMatch(key.detail ?? '', /abcdEFGH1234/);
      mode = 'quota';
      assert.equal((await testAiConnection()).problem, 'quota');
      mode = 'error';
      assert.equal((await testAiConnection()).problem, 'other');
    } finally {
      mode = 'ok';
    }
  });
});

describe('AI helpers for the municipality', () => {
  test('a pasted Facebook message becomes a pre-filled report', async () => {
    const out = await extractFromText('Përshëndetje, te Rruga Rinia drita e rrugës është e fikur prej 3 ditësh. Beni, 069 111 2222');
    assert.equal(out.source, 'ai');
    assert.equal(out.requestTypeId, await typeId('lighting.light_out'));
    assert.equal(out.priority, 'HIGH');
    assert.equal(out.contactName, 'Beni');
    assert.equal(out.contactPhone, '069 111 2222', 'only the phone number is kept');
  });

  test('after the "after" photo the AI checks whether it looks fixed', async () => {
    const { report } = await submitReport({ description: 'Gropë për kontrollin e mbylljes' });
    await resolveReport(admin, report.id, { note: 'U rregullua', photoKey: await uploadPhoto(await jpeg('#101010')) });
    await drainJobs();
    const checked = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(checked.closingAiFixed, true);
    assert.equal(checked.closingAiConfidence, 88);
  });
});
