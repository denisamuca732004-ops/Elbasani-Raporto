/**
 * Department heads (MUNICIPALITY_STAFF): accounts with a temporary password,
 * their own space (only their department's reports), the normal workflow,
 * the LOW / MEDIUM / HIGH tabs, and sessions that end on a password change.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { changePassword, loadPrincipal, verifyCredentials } from '@/lib/server/services/auth';
import * as adminService from '@/lib/server/services/admin';
import { getDashboard, sidebarCounts } from '@/lib/server/services/dashboard';
import {
  addNote, assignableUsers, assignReport, changePriority, changeStatus, getReport, getStaffPhoto, listReports, messageCitizen,
  priorityCounts, rejectReport, resolveReport, statusCounts, updateReport,
} from '@/lib/server/services/report';
import { getPublicCase } from '@/lib/server/services/publicReport';
import { exportCsv } from '@/lib/server/services/stats';
import { createUser, listUsers } from '@/lib/server/services/users';
import { viewCount } from '@/lib/shared/reportViews';
import type { Principal } from '@/lib/shared/types';
import { dashboardSchema, exportSchema, prioritySchema, reportFiltersSchema, reportListSchema } from '@/lib/validation/report';
import {
  adminSession, db, departmentId, drainJobs, jpeg, rejects, setupTestDb, staffSession, submitReport, teardown, typeId, uploadPhoto,
} from './helpers';

let admin: Principal;
let infra: Principal;
let water: Principal;
before(async () => {
  await setupTestDb();
  admin = await adminSession();
  infra = (await staffSession(admin, { email: 'infra@example.com', departmentCode: 'infrastructure', name: 'Arben Infrastruktura' })).principal;
  water = (await staffSession(admin, { email: 'ujesjelles@example.com', departmentCode: 'water', name: 'Blerta Ujësjellësi' })).principal;
});
after(teardown);

const list = (user: Principal, query: Record<string, unknown> = {}) => listReports(user, reportListSchema.parse({ pageSize: 100, ...query }));

describe('accounts created by the admin', () => {
  test('a new department head gets a temporary password, must change it, and the old session ends', async () => {
    const { user, temporaryPassword } = await createUser(admin, {
      email: 'new.head@example.com', name: 'Dritan Shëndeti', role: 'MUNICIPALITY_STAFF', departmentId: await departmentId('public_health'),
    });
    assert.match(temporaryPassword, /^Elb-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.equal(user.mustChangePassword, true);
    assert.equal(user.departmentName, 'Sektori i Shëndetit Publik dhe Shërbimit Veterinar');
    await drainJobs();
    const welcome = await db.emailLog.findFirst({ where: { template: 'account_created', toAddress: 'new.head@example.com' } });
    assert.ok(welcome);
    assert.ok(!welcome.bodyText.includes(temporaryPassword), 'the temporary password is never emailed');

    const first = await verifyCredentials('NEW.HEAD@example.com', temporaryPassword);
    assert.ok(first, 'sign-in is case-insensitive for the email');
    const temp = await loadPrincipal(first.id, first.sessionVersion);
    assert.equal(temp?.mustChangePassword, true, 'the panel asks for a new password first');

    assert.equal((await rejects(() => changePassword(temp!, { currentPassword: temporaryPassword, newPassword: 'abcdefgh' }))).code, 'BAD_REQUEST');
    assert.equal((await rejects(() => changePassword(temp!, { currentPassword: temporaryPassword, newPassword: temporaryPassword }))).code, 'BAD_REQUEST');
    assert.equal((await rejects(() => changePassword(temp!, { currentPassword: 'Gabim-123', newPassword: 'Shendeti-2026' }))).code, 'BAD_REQUEST');

    await changePassword(temp!, { currentPassword: temporaryPassword, newPassword: 'Shendeti-2026' });
    assert.equal(await loadPrincipal(first.id, first.sessionVersion), null, 'the old session ended with the password change');
    assert.equal(await verifyCredentials('new.head@example.com', temporaryPassword), null);
    const again = await verifyCredentials('new.head@example.com', 'Shendeti-2026');
    assert.ok(again);
    const fresh = await loadPrincipal(again.id, again.sessionVersion);
    assert.equal(fresh?.mustChangePassword, false);
  });

  test('department heads cannot use the admin space', async () => {
    for (const call of [
      () => listUsers(infra),
      () => adminService.listDepartments(infra),
      () => adminService.readSettings(infra),
      () => adminService.listEmailLog(infra, { page: 1, pageSize: 10 }),
      () => adminService.loadSampleData(infra),
      () => createUser(infra, { email: 'x@example.com', name: 'X Y', role: 'ADMIN', departmentId: null }),
    ]) {
      assert.equal((await rejects(call)).status, 403);
    }
  });
});

describe('each department sees only its own reports', () => {
  test('reports are routed by type and a department head cannot open another department\'s report', async () => {
    const pothole = await submitReport();
    const leak = await submitReport({ requestTypeId: await typeId('water.leak') });

    const infraList = (await list(infra)).items;
    assert.ok(infraList.some((r) => r.id === pothole.report.id));
    assert.ok(!infraList.some((r) => r.id === leak.report.id));
    assert.ok(infraList.every((r) => r.department?.code === 'infrastructure'));
    const waterList = (await list(water)).items;
    assert.ok(waterList.some((r) => r.id === leak.report.id));
    assert.ok(!waterList.some((r) => r.id === pothole.report.id));

    assert.equal((await rejects(() => getReport(infra, leak.report.id))).status, 403);
    assert.equal((await rejects(() => changeStatus(infra, leak.report.id, { status: 'VERIFIED', publicNote: true }))).status, 403);
    assert.equal((await rejects(() => addNote(infra, leak.report.id, 'test'))).status, 403);
    const attachment = await db.attachment.findFirstOrThrow({ where: { reportId: leak.report.id } });
    assert.equal((await rejects(() => getStaffPhoto(infra, attachment.id))).status, 403);
    assert.equal((await getStaffPhoto(water, attachment.id)).id, attachment.id);

    // Filters for another department are ignored for department heads.
    const other = (await list(infra, { departmentId: String(await departmentId('water')) })).items;
    assert.ok(!other.some((r) => r.id === leak.report.id));

    const adminList = (await list(admin)).items;
    assert.ok(adminList.some((r) => r.id === pothole.report.id) && adminList.some((r) => r.id === leak.report.id));
  });

  test('the detail shows what a department head may do', async () => {
    const { report } = await submitReport();
    const detail = await getReport(infra, report.id);
    assert.equal(detail.permissions.canEditDetails, false);
    assert.equal(detail.permissions.canSetAnyStatus, false);
    assert.equal(detail.permissions.canRequestTransfer, true);
    assert.equal(detail.permissions.canDelete, false);
    assert.deepEqual(detail.allowedStatuses, ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REJECTED']);
    assert.equal(detail.contact.email, 'qytetar@example.com');
    assert.equal((await rejects(() => updateReport(infra, report.id, { priority: 'LOW' }))).status, 403);
    const asAdmin = await getReport(admin, report.id);
    assert.equal(asAdmin.permissions.canEditDetails, true);
    assert.equal(asAdmin.permissions.canRequestTransfer, false);
    assert.ok(asAdmin.allowedStatuses.includes('CLOSED'));
    assert.ok(!asAdmin.allowedStatuses.includes('PENDING'));
  });
});

describe('priorities: LOW, MEDIUM and HIGH', () => {
  test('the tabs count each priority and the list can be filtered by it (HIGH first)', async () => {
    const open = reportFiltersSchema.parse({ status: 'open' });
    const base = await priorityCounts(infra, open);
    const high = await submitReport({ requestTypeId: await typeId('lighting.damaged_pole') });
    assert.equal(high.report.priority, 'HIGH', 'the type is HIGH by default');
    const low = await submitReport({ requestTypeId: await typeId('streets.sidewalk') });
    assert.equal(low.report.priority, 'LOW');
    const danger = await submitReport({ description: 'Gropë shumë e rrezikshme, ka pasur aksident dje.' });
    assert.equal(danger.report.priority, 'HIGH', 'danger words raise the priority');

    const counts = await priorityCounts(infra, open);
    assert.equal(counts.HIGH, base.HIGH + 2);
    assert.equal(counts.LOW, base.LOW + 1);
    assert.equal(counts.total, base.total + 3);

    // The status tabs count with the same filters, without the status: "open" is part of "all".
    const byStatus = await statusCounts(infra, open);
    assert.equal(viewCount('open', byStatus), counts.total);
    assert.ok(viewCount('all', byStatus) >= viewCount('open', byStatus));
    assert.equal(viewCount('review', byStatus) + viewCount('work', byStatus) + (byStatus.VERIFIED ?? 0), counts.total);

    const highOnly = (await list(infra, { priority: 'HIGH', status: 'open' })).items;
    assert.ok(highOnly.length >= 2 && highOnly.every((r) => r.priority === 'HIGH'));
    const sorted = (await list(infra, { status: 'open' })).items;
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
    for (let i = 1; i < sorted.length; i += 1) assert.ok(rank[sorted[i - 1]!.priority] <= rank[sorted[i]!.priority], 'HIGH first');
  });

  test('the department head can change the priority; it is written in the history', async () => {
    const { report } = await submitReport();
    const detail = await changePriority(infra, report.id, 'HIGH');
    assert.equal(detail.priority, 'HIGH');
    assert.ok(detail.events.some((e) => e.type === 'PRIORITY_CHANGED' && e.meta?.from === 'MEDIUM' && e.meta?.to === 'HIGH'));
    assert.equal(prioritySchema.safeParse({ priority: 'URGENT' }).success, false, 'only LOW, MEDIUM or HIGH');
  });
});

describe('the workflow of a department', () => {
  test('verify → take it → start → resolve with an "after" photo', async () => {
    const { report, result } = await submitReport({ contactEmail: 'ndjek@example.com' });
    const verified = await changeStatus(infra, report.id, { status: 'VERIFIED', note: 'U verifikua në vend.', publicNote: true });
    assert.equal(verified.publicStatus, 'OPEN');

    const assignable = await assignableUsers(infra, report.id);
    assert.ok(assignable.some((p) => p.id === infra.id));
    assert.ok(assignable.every((p) => p.role === 'MUNICIPALITY_STAFF'), 'a department head assigns only inside the department');

    const assigned = await assignReport(infra, report.id, infra.id);
    assert.equal(assigned.status, 'ASSIGNED');
    assert.equal(assigned.assignedTo?.id, infra.id);

    const started = await changeStatus(infra, report.id, { status: 'IN_PROGRESS', publicNote: true });
    assert.equal(started.publicStatus, 'IN_PROGRESS');
    assert.equal((await rejects(() => changeStatus(infra, report.id, { status: 'CLOSED', publicNote: true }))).status, 409, 'department heads follow the normal workflow');

    const resolved = await resolveReport(infra, report.id, { note: 'Gropa u mbush.', photoKey: await uploadPhoto(await jpeg('#111111')) });
    assert.equal(resolved.status, 'RESOLVED');
    assert.equal(resolved.closingNote, 'Gropa u mbush.');
    assert.ok(resolved.attachments.some((a) => a.kind === 'AFTER'));
    assert.ok(resolved.resolvedAt);
    await drainJobs();
    const templates = (await db.emailLog.findMany({ where: { reportId: report.id } })).map((m) => m.template);
    assert.ok(templates.includes('status_changed'));
    assert.ok(templates.includes('resolved_confirm'));

    const steps = (await getPublicCase(result.caseNumber)).timeline.filter((e) => e.type === 'STATUS_CHANGED').map((e) => e.status);
    assert.deepEqual(steps, ['OPEN', 'IN_PROGRESS', 'RESOLVED'], 'taking the report does not repeat "Open" for the resident');
  });

  test('two people changing the same report at the same moment: the second is told to refresh', async () => {
    const { report } = await submitReport();
    const [a, b] = await Promise.allSettled([
      changeStatus(infra, report.id, { status: 'VERIFIED', publicNote: true }),
      changeStatus(admin, report.id, { status: 'IN_PROGRESS', publicNote: true }),
    ]);
    const ok = [a, b].filter((r) => r.status === 'fulfilled').length;
    const conflicts = [a, b].filter((r) => r.status === 'rejected' && (r.reason as { status?: number }).status === 409).length;
    assert.equal(ok + conflicts, 2);
    assert.ok(ok >= 1);
    const events = await db.reportEvent.count({ where: { reportId: report.id, type: 'STATUS_CHANGED', actorId: { not: null } } });
    assert.equal(events, ok, 'one history line per change that really happened');
  });

  test('rejecting needs a reason that the resident can read', async () => {
    const { report, result } = await submitReport();
    assert.equal((await rejects(() => changeStatus(infra, report.id, { status: 'REJECTED', publicNote: true }))).status, 400);
    await rejectReport(infra, report.id, { reason: 'Rruga është private, jo e Bashkisë.' });
    const pub = await getPublicCase(result.caseNumber);
    assert.equal(pub.publicStatus, 'REJECTED');
    assert.equal(pub.rejectionReason, 'Rruga është private, jo e Bashkisë.');
    assert.equal((await rejects(() => changePriority(infra, report.id, 'LOW'))).status, 409, 'closed reports are read-only');
  });

  test('a department head cannot assign to another department or to the admin', async () => {
    const { report } = await submitReport();
    const waterHead = await db.user.findUniqueOrThrow({ where: { email: 'ujesjelles@example.com' } });
    assert.equal((await rejects(() => assignReport(infra, report.id, waterHead.id))).status, 400);
    assert.equal((await rejects(() => assignReport(infra, report.id, admin.id))).status, 400);
  });

  test('notes stay internal and messages go to the resident by email', async () => {
    const { report, result } = await submitReport({ contactEmail: 'mesazh@example.com' });
    await addNote(infra, report.id, 'Shënim i brendshëm për ekipin');
    await messageCitizen(infra, report.id, 'Do të vijmë nesër në mëngjes.');
    await drainJobs();
    const mail = await db.emailLog.findFirstOrThrow({ where: { template: 'message_to_citizen', reportId: report.id } });
    assert.ok(mail.bodyText.includes('Do të vijmë nesër'));
    assert.ok(!JSON.stringify(await getPublicCase(result.caseNumber)).includes('Shënim i brendshëm'));
    const anon = await submitReport({ anonymous: true });
    assert.equal((await rejects(() => messageCitizen(infra, anon.report.id, 'Përshëndetje'))).status, 400);
  });

  test('the menu counters and the department dashboard only count the own department', async () => {
    const sidebar = await sidebarCounts(infra);
    const open = await priorityCounts(infra, reportFiltersSchema.parse({ status: 'open' }));
    assert.equal(sidebar.openTotal, open.total);
    const dash = await getDashboard(infra, dashboardSchema.parse({ period: 'week', departmentId: String(await departmentId('water')) }));
    assert.equal(dash.department?.code, 'infrastructure', 'a department head cannot look at another department');
    assert.equal(dash.byDepartment, null);
  });

  test('the CSV export of a department head contains only their department', async () => {
    const csv = await exportCsv(infra, exportSchema.parse({}));
    const lines = csv.trim().split('\r\n').slice(1);
    assert.ok(lines.length > 0);
    assert.ok(lines.every((l) => l.includes('Sektori i Infrastrukturës dhe Punëve Publike')));
  });
});
