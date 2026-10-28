/**
 * "Ask or search": the guide of the home search box. The default questions,
 * the matching residents get while typing (the same code runs in the
 * browser), the admin's edits and what residents see after them.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { seedReferenceData } from '@/lib/server/referenceData';
import { getCatalog } from '@/lib/server/services/catalog';
import { createGuideEntry, getGuide, listGuideEntries, updateGuideEntry } from '@/lib/server/services/guide';
import { guideHref, matchGuide, matchTypes, significantWords, wordsMatch, type GuideItem } from '@/lib/shared/guide';
import type { Principal } from '@/lib/shared/types';
import { guideEntryPatchSchema, guideEntrySchema } from '@/lib/validation/admin';
import { adminSession, db, rejects, setupTestDb, staffSession, teardown } from './helpers';

let admin: Principal;
let guide: GuideItem[];
const codeOf = new Map<number, string>();

before(async () => {
  await setupTestDb();
  admin = await adminSession();
  guide = await getGuide();
  for (const row of await db.guideEntry.findMany()) if (row.code) codeOf.set(row.id, row.code);
});
after(teardown);

/** The codes of the answers a resident gets for what they typed, best first. */
const answers = (query: string) => matchGuide(guide, query).map((m) => codeOf.get(m.item.id));

describe('the default guide', () => {
  test('the seed adds the questions once, all active, with the emergency first', async () => {
    assert.ok(guide.length >= 15, `only ${guide.length} questions`);
    assert.equal(guide[0]!.emergency, true);
    assert.match(guide[0]!.answerSq, /112/);
    assert.equal(guideHref(guide[0]!.action), 'tel:112');
    for (const g of guide) {
      assert.ok(g.questionSq.length >= 5 && g.questionEn.length >= 5);
      assert.ok(g.answerSq.length >= 10 && g.answerEn.length >= 10);
    }
    await seedReferenceData(db);
    assert.equal(await db.guideEntry.count(), guide.length);
  });

  test('every button leads to a page of the site or to the phone, never elsewhere', () => {
    for (const g of guide) {
      const href = guideHref(g.action);
      assert.ok(href === null || href === 'tel:112' || /^\/[a-z]+$/.test(href), `${g.questionSq}: ${href}`);
    }
  });
});

describe('what residents get while typing', () => {
  test('questions as residents type them, with or without accents', () => {
    assert.equal(answers('si raportoj')[0], 'how_to_report');
    assert.equal(answers('a duhet llogari')[0], 'account');
    assert.equal(answers('sa zgjat')[0], 'how_long');
    assert.equal(answers('çfarë do të thotë Në punë')[0], 'statuses');
    assert.equal(answers('cfare do te thote ne pune')[0], 'statuses');
    assert.equal(answers('a më shohin emrin')[0], 'privacy');
    assert.equal(answers('privatesia')[0], 'privacy');
    assert.equal(answers('si e instaloj në telefon')[0], 'install');
    assert.equal(answers('humba numrin')[0], 'lost_number');
    assert.equal(answers('a mund te raportoj anonim')[0], 'anonymous');
    assert.equal(answers('how long does it take')[0], 'how_long');
    assert.equal(answers('install app')[0], 'install');
  });

  test('an emergency always comes first, even when other answers match too', () => {
    assert.deepEqual(answers('zjarr'), ['emergency']);
    assert.equal(answers('aksident')[0], 'emergency');
    assert.equal(answers('si raportoj nje zjarr')[0], 'emergency');
    assert.ok(answers('si raportoj nje zjarr').includes('how_to_report'));
  });

  test('streets, report numbers and problem names do not bring up random answers', () => {
    assert.deepEqual(answers('Rruga Rinia'), []);
    assert.deepEqual(answers('Bulevardi Qemal Stafa'), []);
    assert.deepEqual(answers('gropë'), []);
    assert.deepEqual(answers('kontejner'), []);
    assert.deepEqual(answers('si'), []);
    assert.deepEqual(answers('a e'), []);
  });

  test('at most three answers', () => {
    assert.ok(matchGuide(guide, 'raportim').length <= 3);
  });

  test('words match despite endings, but not just because they start the same', () => {
    assert.equal(wordsMatch('gropa', 'grope'), true);
    assert.equal(wordsMatch('raport', 'raportoj'), true);
    assert.equal(wordsMatch('fotot', 'foto'), true);
    assert.equal(wordsMatch('zgjat', 'zgjidhja'), false);
    assert.equal(wordsMatch('raportoj', 'raportime'), false);
    assert.deepEqual(significantWords('A më duhet një llogari?'), ['llogari']);
  });

  test('a question that names a problem also offers that report type', async () => {
    const catalog = await getCatalog();
    const types = catalog.categories.flatMap((c) => c.types.map((t) => ({ ...t, category: c })));
    const codes = (q: string) => matchTypes(types, q).map((t) => t.code);
    assert.equal(codes('gropë')[0], 'streets.pothole');
    assert.equal(codes('si raportoj nje grope')[0], 'streets.pothole');
    assert.equal(codes('dritë rruge')[0], 'lighting.light_out');
    assert.deepEqual(codes('Rruga Rinia'), []);
    assert.deepEqual(codes('si raportoj nje problem'), []);
  });
});

describe('the admin manages the guide', () => {
  test('a new question shows to residents at once, and matches its own keywords', async () => {
    await getGuide(); // cached now
    const created = await createGuideEntry(admin, guideEntrySchema.parse({
      questionSq: 'Ku ndodhet zyra e Bashkisë?', questionEn: 'Where is the municipal office?',
      answerSq: 'Zyra e Shërbimit ndaj Qytetarit ndodhet në qendër.\nOrari: 08:00–16:00.', answerEn: 'The Citizen Service Office is in the centre.\nHours: 08:00–16:00.',
      keywords: 'zyra, sportel, orari, adresa, office, hours', action: 'NONE', sortOrder: 5,
    }));
    const live = await getGuide();
    assert.ok(live.some((g) => g.id === created.id), 'the cache was not cleared');
    assert.equal(matchGuide(live, 'orari i sportelit')[0]!.item.id, created.id);
    assert.match(created.answerSq, /\n/);
    const row = await db.guideEntry.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.code, null);
    assert.equal(row.active, true);
  });

  test('an edit changes only what was sent; a hidden question disappears for residents', async () => {
    const target = guide.find((g) => codeOf.get(g.id) === 'stats')!;
    await updateGuideEntry(admin, target.id, guideEntryPatchSchema.parse({ answerSq: 'Statistikat përditësohen çdo ditë dhe janë publike.' }));
    let row = await db.guideEntry.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.answerSq, 'Statistikat përditësohen çdo ditë dhe janë publike.');
    assert.equal(row.questionSq, target.questionSq);
    assert.equal(row.keywords, target.keywords);
    assert.equal(row.action, 'STATS');

    await updateGuideEntry(admin, target.id, guideEntryPatchSchema.parse({ active: false }));
    assert.ok(!(await getGuide()).some((g) => g.id === target.id));
    assert.ok((await listGuideEntries(admin)).some((g) => g.id === target.id && !g.active), 'the admin still sees it');

    await updateGuideEntry(admin, target.id, guideEntryPatchSchema.parse({ keywords: '' }));
    row = await db.guideEntry.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(row.keywords, null);
    assert.equal(row.active, false);
  });

  test('running the seed again never overwrites the admin’s changes', async () => {
    const target = await db.guideEntry.findUniqueOrThrow({ where: { code: 'install' } });
    await updateGuideEntry(admin, target.id, { questionSq: 'Si e shtoj në telefon?' });
    await seedReferenceData(db);
    assert.equal((await db.guideEntry.findUniqueOrThrow({ where: { code: 'install' } })).questionSq, 'Si e shtoj në telefon?');
  });

  test('the forms refuse empty answers, unknown buttons and unknown fields; the database does too', async () => {
    const base = { questionSq: 'Pyetje provë?', questionEn: 'Test question?', answerSq: 'Një përgjigje e mjaftueshme.', answerEn: 'A long enough answer.' };
    assert.equal(guideEntrySchema.safeParse({ ...base, answerSq: 'shkurt' }).success, false);
    assert.equal(guideEntrySchema.safeParse({ ...base, action: 'LINK' }).success, false);
    assert.equal(guideEntrySchema.safeParse({ ...base, href: 'https://example.com' }).success, false);
    assert.equal(guideEntrySchema.safeParse({ ...base, sortOrder: -1 }).success, false);
    assert.equal(guideEntryPatchSchema.safeParse({}).success, false);
    assert.equal(guideEntrySchema.parse(base).action, 'NONE');
    await assert.rejects(db.guideEntry.create({ data: { ...base, answerSq: 'shkurt' } }));
    assert.equal((await rejects(() => updateGuideEntry(admin, 999999, { active: false }))).status, 404);
  });

  test('a department head cannot change the guide', async () => {
    const { principal } = await staffSession(admin, { email: 'udhezuesi@example.com', departmentCode: 'water' });
    assert.equal((await rejects(() => listGuideEntries(principal))).status, 403);
    assert.equal((await rejects(() => createGuideEntry(principal, guideEntrySchema.parse({
      questionSq: 'Pyetje provë?', questionEn: 'Test question?', answerSq: 'Një përgjigje e mjaftueshme.', answerEn: 'A long enough answer.',
    })))).status, 403);
    assert.equal((await rejects(() => updateGuideEntry(principal, guide[0]!.id, { active: false }))).status, 403);
  });
});
