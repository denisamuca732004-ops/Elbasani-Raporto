/**
 * The weekly summary for the admins: numbers counted in the database, places where the same
 * problem keeps coming back, sent once on Monday morning (without the AI: no AI paragraph).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { computeWeeklySummary, findRepeatPlaces, sendWeeklySummary, weeklySummaryIfDue, weeklySummaryMail } from '@/lib/server/services/weeklySummary';
import { adminSession, db, ELBASAN, setupTestDb, submitReport, teardown, typeId } from './helpers';

const north = (m: number) => ELBASAN.latitude + m / 111_320;

before(async () => {
  await setupTestDb();
  await adminSession();
  const pothole = await typeId('streets.pothole');
  // Three potholes within a few metres of each other, one far away, and a different problem at the same spot.
  for (const m of [0, 10, 25]) await submitReport({ requestTypeId: pothole, latitude: north(m), longitude: ELBASAN.longitude });
  await submitReport({ requestTypeId: pothole, latitude: north(600), longitude: ELBASAN.longitude });
  await submitReport({ requestTypeId: await typeId('lighting.light_out'), latitude: north(5), longitude: ELBASAN.longitude });
});
after(teardown);

describe('the weekly summary', () => {
  test('a place with the same problem 3 times is found; other kinds and far reports are not counted with it', async () => {
    const places = await findRepeatPlaces();
    assert.equal(places.length, 1);
    assert.equal(places[0]!.count, 3);
    assert.match(places[0]!.typeNameSq, /Gropë/i);
    assert.equal(places[0]!.caseNumbers.length, 3);
  });

  test('the numbers come from the database and are all in the e-mail', async () => {
    const s = await computeWeeklySummary();
    assert.equal(s.received, 5);
    assert.equal(s.receivedBefore, 0);
    assert.equal(s.openNow, 5);
    const mail = weeklySummaryMail(s, null);
    assert.match(mail.subject, /5 raportime të reja/);
    assert.match(mail.text, /Raportime të reja: 5/);
    assert.match(mail.text, /3 raportime/);
    assert.doesNotMatch(mail.text, /shkruhet nga AI/, 'without the AI there is no AI paragraph');
  });

  test('it goes out on Monday only, once, and a preview from the panel does not count', async () => {
    // The last Monday before now (the e-mails are written "now", so the once-a-week check sees them).
    const monday = new Date();
    monday.setUTCHours(6, 0, 0, 0);
    while (new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Tirane', weekday: 'short' }).format(monday) !== 'Mon' || monday > new Date()) {
      monday.setUTCDate(monday.getUTCDate() - 1);
    }
    const tuesday = new Date(monday.getTime() + 86_400_000);
    assert.equal(await weeklySummaryIfDue(tuesday), 0);
    assert.equal(await sendWeeklySummary(monday, 'preview@bashkia.test'), 1);
    assert.equal(await db.emailLog.count({ where: { template: 'weekly_summary_preview', toAddress: 'preview@bashkia.test' } }), 1);
    const sent = await weeklySummaryIfDue(monday);
    assert.ok(sent >= 1, 'every admin gets it');
    assert.equal(await weeklySummaryIfDue(new Date(monday.getTime() + 3_600_000)), 0, 'not twice the same Monday');
  });
});
