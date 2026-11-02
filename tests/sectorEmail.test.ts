/**
 * A sector that works by e-mail (no panel account): each report is e-mailed to it with a link
 * where it marks "Po merremi" / "U zgjidh" or asks for a review ("Nuk është për ne"), which the
 * admin decides as usual; the report then goes by e-mail to the new sector.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { updateDepartment } from '@/lib/server/services/admin';
import { runDaily } from '@/lib/server/services/maintenance';
import { getPublicCase } from '@/lib/server/services/publicReport';
import { getReport, resendToSector } from '@/lib/server/services/report';
import { findLink, linkIdOf } from '@/lib/server/services/reportLinks';
import { sectorRequestReview, sectorResolve, sectorStart, sectorView } from '@/lib/server/services/sectorLink';
import { decideTransfer } from '@/lib/server/services/transfer';
import type { Principal } from '@/lib/shared/types';
import { departmentPatchSchema } from '@/lib/validation/admin';
import { adminSession, backdate, db, departmentId, drainJobs, rejects, setupTestDb, submitReport, teardown, typeId } from './helpers';

let admin: Principal;
const WASTE_MAIL = 'pastrimi@bashkia.test';
const WATER_MAIL = 'ujesjellesi@bashkia.test';

/** The link in the last "sector_report" e-mail of a report to an address. */
async function linkIn(reportId: string, to: string): Promise<string> {
  const mail = await db.emailLog.findFirstOrThrow({ where: { reportId, toAddress: to, template: 'sector_report' }, orderBy: { id: 'desc' } });
  const token = /\/sektori\/([0-9a-f-]{36}\.[A-Za-z0-9_-]+)/.exec(mail.bodyText)?.[1];
  assert.ok(token, 'the e-mail has the report link');
  return token;
}

async function wasteReport(description = 'Kontejneri është plot prej tri ditësh, mbeturinat në tokë.') {
  return submitReport({ requestTypeId: await typeId('waste.overflowing_bin'), contactName: 'Arben Hoxha', contactPhone: '069 777 8899', description });
}

before(async () => {
  await setupTestDb();
  admin = await adminSession();
  await updateDepartment(admin, await departmentId('public_services'), departmentPatchSchema.parse({ email: WASTE_MAIL, worksByEmail: true }));
});
after(teardown);

describe('a sector that works by e-mail', () => {
  test('a sector cannot work by e-mail without the address to send to', async () => {
    const water = await departmentId('water');
    assert.equal((await rejects(() => updateDepartment(admin, water, departmentPatchSchema.parse({ worksByEmail: true })))).status, 400);
  });

  test('gets the whole report with its link; works from it; the resident sees each step', async () => {
    const { report, result } = await wasteReport();
    const mail = await db.emailLog.findFirstOrThrow({ where: { reportId: report.id, template: 'sector_report' } });
    assert.equal(mail.toAddress, WASTE_MAIL);
    for (const part of [result.caseNumber, 'Kontejner i mbushur', 'Kontejneri është plot', 'Arben Hoxha', '069 777 8899', 'Po merremi', 'Nuk është për ne']) {
      assert.ok(mail.bodyText.includes(part), `the e-mail has "${part}"`);
    }
    assert.equal(await db.emailLog.count({ where: { reportId: report.id, template: 'department_new_report' } }), 0, 'no panel notice');

    const token = await linkIn(report.id, WASTE_MAIL);
    const view = await sectorView(token);
    assert.ok(view.ok);
    assert.equal(view.view.caseNumber, result.caseNumber);
    assert.equal(view.view.contact?.phone, '069 777 8899', 'the sector sees the phone, to call the resident');
    assert.equal(view.view.photos.length, 1);
    assert.ok(view.view.photos[0]!.url.startsWith(`/api/sektori/${token}/photos/`));

    // A changed or made-up link is refused.
    assert.equal((await sectorView(`${token.slice(0, -2)}xx`)).ok, false);
    assert.equal(linkIdOf('not-a-link'), null);

    await sectorStart(token, { note: 'Ekipi vjen nesër në mëngjes.' });
    let row = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(row.status, 'IN_PROGRESS');
    assert.ok(row.verifiedAt, 'acting on it verifies it');
    const event = await db.reportEvent.findFirstOrThrow({ where: { reportId: report.id, type: 'STATUS_CHANGED', toStatus: 'IN_PROGRESS' } });
    assert.equal(event.actorId, null);
    assert.deepEqual(event.meta, { via: 'sector_link', email: WASTE_MAIL });
    assert.ok((await getPublicCase(result.caseNumber)).timeline.some((i) => i.message === 'Ekipi vjen nesër në mëngjes.'), 'the resident sees the note');

    await sectorResolve(token, { note: 'Kontejneri u boshatis dhe u pastrua vendi.' });
    row = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(row.status, 'RESOLVED');
    assert.equal(row.closingNote, 'Kontejneri u boshatis dhe u pastrua vendi.');
    assert.equal((await getPublicCase(result.caseNumber)).publicStatus, 'RESOLVED');
    assert.equal((await rejects(() => sectorResolve(token, { note: 'Përsëri' }))).status, 409, 'not twice');
    const link = await db.reportLink.findFirstOrThrow({ where: { reportId: report.id } });
    assert.ok(link.lastUsedAt);

    // The admin sees where it went and when the sector used it.
    const detail = await getReport(admin, report.id);
    assert.equal(detail.sectorMail?.email, WASTE_MAIL);
    assert.ok(detail.sectorMail?.lastUsedAt && detail.sectorMail.url?.includes('/sektori/'));
    assert.ok(detail.events.some((e) => e.meta?.via === 'sector_link'));
  });

  test('"Nuk është për ne": the admin moves it, the report goes by e-mail to the new sector and the old link stops', async () => {
    const water = await departmentId('water');
    await updateDepartment(admin, water, departmentPatchSchema.parse({ email: WATER_MAIL, worksByEmail: true }));
    const { report } = await wasteReport('Del ujë i ndotur nga kapaku i kanalit pranë kontejnerit.');
    const token = await linkIn(report.id, WASTE_MAIL);

    await sectorRequestReview(token, { reason: 'Është rrjedhje kanalizimi, jo mbeturina.', suggestedDepartmentId: water });
    assert.equal((await rejects(() => sectorRequestReview(token, { reason: 'Edhe një herë e njëjta kërkesë.' }))).status, 409, 'one open request');
    const transfer = await db.departmentTransfer.findFirstOrThrow({ where: { reportId: report.id, status: 'PENDING' } });
    assert.equal(transfer.requestedByEmail, WASTE_MAIL);
    assert.equal(transfer.requestedById, null);
    assert.equal(transfer.suggestedDepartmentId, water);
    assert.ok(await db.emailLog.findFirst({ where: { reportId: report.id, template: 'transfer_requested' } }), 'the admin is told');
    const pending = await sectorView(token);
    assert.ok(pending.ok && pending.view.pendingReview?.reason.includes('kanalizimi'));

    await decideTransfer(admin, transfer.id, { decision: 'approve', toDepartmentId: water });
    await drainJobs();
    assert.equal((await findLink(token)).problem, 'revoked', 'the first sector’s link stops working');
    assert.equal((await rejects(() => sectorStart(token, {}))).status, 410);
    const answer = await db.emailLog.findFirstOrThrow({ where: { reportId: report.id, toAddress: WASTE_MAIL, template: 'transfer_approved' } });
    assert.ok(answer.bodyText.includes('nuk vlen më'));
    const newToken = await linkIn(report.id, WATER_MAIL);
    const moved = await sectorView(newToken);
    assert.ok(moved.ok && moved.view.departmentId === water, 'the new sector gets its own link');
  });

  test('a declined request keeps the report with the sector, which gets the answer and its link again', async () => {
    const { report } = await wasteReport('Kontejneri i dëmtuar ka mbetur pa kapak prej një jave.');
    const token = await linkIn(report.id, WASTE_MAIL);
    await sectorRequestReview(token, { reason: 'Kontejnerët e dëmtuar nuk janë tanët.' });
    const transfer = await db.departmentTransfer.findFirstOrThrow({ where: { reportId: report.id, status: 'PENDING' } });
    await decideTransfer(admin, transfer.id, { decision: 'decline', note: 'Kontejnerët janë të Shërbimeve Publike.' });
    const answer = await db.emailLog.findFirstOrThrow({ where: { reportId: report.id, toAddress: WASTE_MAIL, template: 'transfer_declined' } });
    assert.ok(answer.bodyText.includes(token), 'the same link, still working');
    const view = await sectorView(token);
    assert.ok(view.ok && view.view.lastDecision?.approved === false && view.view.lastDecision.note?.includes('Shërbimeve'));
  });

  test('an expired link is refused; the admin sends it again and it works', async () => {
    const { report } = await wasteReport('Mbeturina të shpërndara rreth kontejnerit pranë tregut.');
    const token = await linkIn(report.id, WASTE_MAIL);
    await db.reportLink.updateMany({ where: { reportId: report.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await findLink(token)).problem, 'expired');
    assert.equal((await rejects(() => sectorStart(token, {}))).status, 410);
    await resendToSector(admin, report.id);
    assert.equal((await findLink(token)).problem, null, 'the same address works again');
    assert.equal(await db.emailLog.count({ where: { reportId: report.id, template: 'sector_report' } }), 2);
  });

  test('reminders of overdue reports carry each report’s link', async () => {
    const { report } = await wasteReport('Kontejneri nuk është zbrazur prej dy javësh, era e keqe.');
    await backdate(report.id, 30, ['due_at']);
    await runDaily();
    const digest = await db.emailLog.findFirstOrThrow({ where: { toAddress: WASTE_MAIL, template: 'overdue_digest' }, orderBy: { id: 'desc' } });
    assert.ok(digest.bodyText.includes('/sektori/'), 'the link, not the panel');
    assert.ok(!digest.bodyText.includes(`/admin/reports/${report.id}`));
  });

  test('a sector in the panel is unchanged: panel notice, no link', async () => {
    const { report } = await submitReport({ requestTypeId: await typeId('streets.pothole') });
    assert.equal(await db.reportLink.count({ where: { reportId: report.id } }), 0);
    assert.equal(await db.emailLog.count({ where: { reportId: report.id, template: 'sector_report' } }), 0);
  });
});
