/**
 * The same problem reported by several people: a new report that repeats an open one nearby is
 * not e-mailed to the sector; it waits in "Të reja" until the admin merges it into the first one
 * (one more supporter there, the resident follows it) or says it is different (it goes to the sector).
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { updateDepartment } from '@/lib/server/services/admin';
import { reportBoard } from '@/lib/server/services/board';
import { dismissDuplicate, mergeDuplicate } from '@/lib/server/services/duplicates';
import { getPublicCase } from '@/lib/server/services/publicReport';
import { resetConfigForTests } from '@/lib/server/env';
import type { Principal } from '@/lib/shared/types';
import { departmentPatchSchema } from '@/lib/validation/admin';
import { boardSchema } from '@/lib/validation/report';
import { adminSession, db, departmentId, ELBASAN, rejects, setupTestDb, submitReport, teardown, typeId, withOlderEmail } from './helpers';

let admin: Principal;
const WASTE_MAIL = 'pastrimi@bashkia.test';

/** A full bin at a point `north` metres north of the test point. */
async function bin(north = 0) {
  return submitReport({ requestTypeId: await typeId('waste.overflowing_bin'), latitude: ELBASAN.latitude + north / 111_320, longitude: ELBASAN.longitude });
}
const sectorMails = (reportId: string) => db.emailLog.count({ where: { reportId, template: 'sector_report' } });

before(async () => {
  await setupTestDb();
  process.env.HOLD_DUPLICATES = 'true';
  resetConfigForTests();
  admin = await adminSession();
  await updateDepartment(admin, await departmentId('public_services'), departmentPatchSchema.parse({ email: WASTE_MAIL }));
});
after(async () => {
  process.env.HOLD_DUPLICATES = 'false';
  resetConfigForTests();
  await teardown();
});

describe('the same problem reported twice', () => {
  test('a repeat close by is held for the admin, not e-mailed to the sector', async () => {
    const first = await bin();
    assert.equal(await sectorMails(first.report.id), 1, 'the first one goes to the sector');

    const second = await bin(20);
    const row = await db.report.findUniqueOrThrow({ where: { id: second.report.id } });
    assert.equal(row.possibleDuplicateOfId, first.report.id);
    assert.equal(await sectorMails(second.report.id), 0, 'the sector does not get the same problem twice');

    const board = await reportBoard(admin, boardSchema.parse({ bucket: 'new', pageSize: 100 }));
    const item = board.items.find((i) => i.id === second.report.id);
    assert.equal(item?.duplicate?.caseNumber, first.result.caseNumber, 'the board says which report it repeats');
    assert.ok(item?.duplicate?.meters !== null && item!.duplicate!.meters! <= 25);

    // Far enough away, or another kind of problem: a separate report.
    const far = await bin(400);
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: far.report.id } })).possibleDuplicateOfId, null);
    const pothole = await submitReport({ requestTypeId: await typeId('streets.pothole') });
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: pothole.report.id } })).possibleDuplicateOfId, null);
  });

  test('merge: the repeat closes and points to the first; the resident follows the first one', async () => {
    const first = await bin(1000);
    const second = await bin(1010);
    await withOlderEmail(second.report.id, 'banori@example.test');
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: second.report.id } })).possibleDuplicateOfId, first.report.id);

    const { into } = await mergeDuplicate(admin, second.report.id);
    assert.equal(into, first.result.caseNumber);
    const merged = await db.report.findUniqueOrThrow({ where: { id: second.report.id } });
    assert.equal(merged.status, 'REJECTED', 'closed, and not counted as fixed');
    assert.equal(merged.mergedIntoId, first.report.id);
    assert.equal(merged.possibleDuplicateOfId, null);
    const target = await db.report.findUniqueOrThrow({ where: { id: first.report.id } });
    assert.equal(target.supportersCount, 1, 'one more voice on the first report');
    assert.equal(await db.reportFollower.count({ where: { reportId: first.report.id, email: 'banori@example.test' } }), 1);

    const pub = await getPublicCase(second.result.caseNumber);
    assert.equal(pub.mergedInto, first.result.caseNumber, 'the resident is sent to the first report');
    assert.equal(pub.rejectionReason, null, 'no "rejected" message for a merged report');

    assert.equal((await rejects(() => mergeDuplicate(admin, second.report.id))).status, 409, 'already merged');
    assert.equal((await rejects(() => mergeDuplicate(admin, first.report.id, first.result.caseNumber))).status, 400, 'not into itself');
  });

  test('different after all: it goes to the sector', async () => {
    const first = await bin(2000);
    const second = await bin(2015);
    assert.equal(await sectorMails(second.report.id), 0);
    await dismissDuplicate(admin, second.report.id);
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: second.report.id } })).possibleDuplicateOfId, null);
    assert.equal(await sectorMails(second.report.id), 1, 'now the sector gets it');
    assert.equal(await sectorMails(first.report.id), 1);
  });

  test('a closed report is not a reason to hold a new one', async () => {
    const first = await bin(3000);
    await db.report.update({ where: { id: first.report.id }, data: { status: 'CLOSED' } });
    const second = await bin(3005);
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: second.report.id } })).possibleDuplicateOfId, null);
  });
});
