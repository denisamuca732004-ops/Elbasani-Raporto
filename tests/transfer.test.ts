/**
 * "This report does not belong to our department": the department head asks
 * the admin to review it; the admin moves it to the right department or declines.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { config } from '@/lib/server/env';
import { assignReport, changeStatus, getReport, listReports, rejectReport, updateReport } from '@/lib/server/services/report';
import { decideTransfer, listTransfers, pendingTransferCount, requestTransfer } from '@/lib/server/services/transfer';
import type { Principal } from '@/lib/shared/types';
import { reportListSchema, transferDecisionSchema, transferListSchema, transferRequestSchema } from '@/lib/validation/report';
import { adminSession, db, departmentId, drainJobs, rejects, setupTestDb, staffSession, submitReport, teardown } from './helpers';

let admin: Principal;
let infra: Principal;
let water: Principal;
let health: Principal;
before(async () => {
  await setupTestDb();
  admin = await adminSession();
  infra = (await staffSession(admin, { email: 'infra@example.com', departmentCode: 'infrastructure', name: 'Arben' })).principal;
  water = (await staffSession(admin, { email: 'water@example.com', departmentCode: 'water', name: 'Blerta' })).principal;
  health = (await staffSession(admin, { email: 'health@example.com', departmentCode: 'public_health', name: 'Dritan' })).principal;
});
after(teardown);

const REASON = 'Kjo është rrjedhje uji nga tubi, i përket Ujësjellësit.';
const ask = (user: Principal, id: string, input: Record<string, unknown>) => requestTransfer(user, id, transferRequestSchema.parse(input));
const decide = (user: Principal, id: string, input: Record<string, unknown>) => decideTransfer(user, id, transferDecisionSchema.parse(input));

describe('requests to move a report to another department', () => {
  test('a department head sends a request with a reason; the admin is notified', async () => {
    const { report } = await submitReport();
    const detail = await ask(infra, report.id, { reason: REASON, suggestedDepartmentId: await departmentId('water') });
    assert.equal(detail.transferPending, true);
    assert.equal(detail.pendingTransfer?.reason, REASON);
    assert.equal(detail.pendingTransfer?.suggestedDepartment?.code, 'water');
    assert.equal(detail.permissions.canRequestTransfer, false);
    assert.ok(detail.events.some((e) => e.type === 'TRANSFER_REQUESTED'));

    assert.equal((await rejects(() => ask(infra, report.id, { reason: REASON }))).status, 409, 'only one open request per report');
    await drainJobs();
    const mail = await db.emailLog.findFirstOrThrow({ where: { template: 'transfer_requested', reportId: report.id } });
    assert.equal(mail.toAddress, config().auth.adminEmail);

    const list = await listReports(infra, reportListSchema.parse({ transferPending: 'true' }));
    assert.ok(list.items.some((r) => r.id === report.id && r.transferPending));
  });

  test('the database itself allows only one open request per report', async () => {
    const { report } = await submitReport();
    await ask(infra, report.id, { reason: REASON });
    await assert.rejects(
      db.departmentTransfer.create({
        data: { reportId: report.id, pendingReportId: report.id, fromDepartmentId: await departmentId('infrastructure'), reason: REASON },
      }),
      /Unique constraint|P2002/,
    );
  });

  test('the reason is required and the suggested department must be another one', async () => {
    const { report } = await submitReport();
    assert.equal(transferRequestSchema.safeParse({ reason: 'jo' }).success, false);
    assert.equal(transferRequestSchema.safeParse({}).success, false);
    assert.equal((await rejects(() => ask(infra, report.id, { reason: REASON, suggestedDepartmentId: infra.departmentId }))).status, 400);
    assert.equal((await rejects(() => ask(water, report.id, { reason: REASON }))).status, 403, 'not their report');
    assert.equal((await rejects(() => ask(admin, report.id, { reason: REASON }))).status, 403, 'the admin changes the department directly');
  });

  test('the admin sees every request; a department sees the ones it sent', async () => {
    const pending = transferListSchema.parse({ status: 'PENDING' });
    const adminList = await listTransfers(admin, pending);
    assert.ok(adminList.items.length >= 1);
    assert.ok(adminList.items[0]!.report.caseNumber);
    assert.equal(await pendingTransferCount(admin), adminList.total);
    assert.equal((await listTransfers(infra, pending)).total, adminList.total);
    assert.equal((await listTransfers(health, pending)).total, 0);
    assert.equal(await pendingTransferCount(health), 0);
  });

  test('approving moves the report to the new department; the old department loses access', async () => {
    const { report } = await submitReport();
    await changeStatus(infra, report.id, { status: 'VERIFIED', publicNote: true });
    await assignReport(infra, report.id, infra.id);
    await changeStatus(infra, report.id, { status: 'IN_PROGRESS', publicNote: true });
    const sent = await ask(infra, report.id, { reason: REASON, suggestedDepartmentId: await departmentId('water') });
    const transferId = sent.pendingTransfer!.id;

    assert.equal((await rejects(() => decide(infra, transferId, { decision: 'approve' }))).status, 403, 'only the admin decides');
    const decided = await decide(admin, transferId, { decision: 'approve', note: 'E saktë.' });
    assert.equal(decided.status, 'APPROVED');
    assert.equal(decided.toDepartment?.code, 'water');
    assert.equal(decided.decidedBy?.name, 'Admin Test');

    const moved = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(moved.departmentId, await departmentId('water'));
    assert.equal(moved.assignedToId, null, 'people only work inside their own department');
    assert.equal(moved.status, 'VERIFIED', 'the new department starts again');

    assert.equal((await rejects(() => getReport(infra, report.id))).status, 403);
    const forWater = await getReport(water, report.id);
    assert.equal(forWater.department?.code, 'water');
    assert.equal(forWater.transfers[0]?.status, 'APPROVED');
    assert.ok(forWater.events.some((e) => e.type === 'ROUTING_CHANGED'));

    assert.equal((await rejects(() => decide(admin, transferId, { decision: 'decline', note: 'xyz' }))).status, 409, 'decided only once');

    await drainJobs();
    const sentTo = (await db.emailLog.findMany({ where: { reportId: report.id } })).map((m) => `${m.template}:${m.toAddress}`);
    assert.ok(sentTo.includes('transfer_approved:infra@example.com'));
    assert.ok(sentTo.includes('department_new_report:water@example.com'));
  });

  test('approving without a suggested department needs the admin to choose one (and not the same one)', async () => {
    const { report } = await submitReport();
    const transferId = (await ask(infra, report.id, { reason: REASON })).pendingTransfer!.id;
    assert.equal((await rejects(() => decide(admin, transferId, { decision: 'approve' }))).status, 400);
    assert.equal((await rejects(() => decide(admin, transferId, { decision: 'approve', toDepartmentId: infra.departmentId }))).status, 400);
    await decide(admin, transferId, { decision: 'approve', toDepartmentId: await departmentId('public_health') });
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: report.id } })).departmentId, await departmentId('public_health'));
  });

  test('two admins deciding at the same moment: only one decision counts', async () => {
    const { report } = await submitReport();
    const transferId = (await ask(infra, report.id, { reason: REASON, suggestedDepartmentId: await departmentId('water') })).pendingTransfer!.id;
    const results = await Promise.allSettled([
      decide(admin, transferId, { decision: 'approve' }),
      decide(admin, transferId, { decision: 'decline', note: 'Mbetet këtu.' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const transfer = await db.departmentTransfer.findUniqueOrThrow({ where: { id: transferId } });
    assert.notEqual(transfer.status, 'PENDING');
    assert.equal(transfer.pendingReportId, null);
  });

  test('declining needs an explanation; the report stays and the department is told why', async () => {
    const { report } = await submitReport();
    const transferId = (await ask(infra, report.id, { reason: REASON })).pendingTransfer!.id;
    assert.equal(transferDecisionSchema.safeParse({ decision: 'decline' }).success, false);
    const declined = await decide(admin, transferId, { decision: 'decline', note: 'Gropa në rrugë është punë e Infrastrukturës.' });
    assert.equal(declined.status, 'DECLINED');
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: report.id } })).departmentId, await departmentId('infrastructure'));
    const detail = await getReport(infra, report.id);
    assert.equal(detail.pendingTransfer, null);
    assert.equal(detail.permissions.canRequestTransfer, true, 'they may ask again with new information');
    await drainJobs();
    const mail = await db.emailLog.findFirstOrThrow({ where: { template: 'transfer_declined', reportId: report.id } });
    assert.ok(mail.bodyText.includes('punë e Infrastrukturës'));
  });

  test('closing or re-routing a report settles its open request automatically', async () => {
    const rejected = await submitReport();
    await ask(infra, rejected.report.id, { reason: REASON });
    await rejectReport(admin, rejected.report.id, { reason: 'Raportim i dyfishtë.' });
    assert.equal((await db.departmentTransfer.findFirstOrThrow({ where: { reportId: rejected.report.id } })).status, 'DECLINED');

    const moved = await submitReport();
    await ask(infra, moved.report.id, { reason: REASON });
    await updateReport(admin, moved.report.id, { departmentId: await departmentId('water') });
    const t2 = await db.departmentTransfer.findFirstOrThrow({ where: { reportId: moved.report.id } });
    assert.equal(t2.status, 'APPROVED');
    assert.equal(t2.toDepartmentId, await departmentId('water'));
  });
});
