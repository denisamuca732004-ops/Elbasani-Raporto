/**
 * The main admin: first setup, accounts, departments and catalogue, full
 * control over every report (any status, any detail, delete), reports taken
 * by phone, demo data, the daily job, the export and the email log.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { config } from '@/lib/server/env';
import * as adminService from '@/lib/server/services/admin';
import { loadPrincipal, setupFirstAdmin, setupStatus, verifyCredentials } from '@/lib/server/services/auth';
import { getCatalog } from '@/lib/server/services/catalog';
import { getDashboard, sidebarCounts } from '@/lib/server/services/dashboard';
import { runDaily } from '@/lib/server/services/maintenance';
import { getPublicCase, getPublicPhoto } from '@/lib/server/services/publicReport';
import {
  assignReport, changeStatus, createStaffReport, deleteReport, getReport, setPhotoVisibility, updateReport,
} from '@/lib/server/services/report';
import { getPublicSettings } from '@/lib/server/services/settings';
import { exportCsv } from '@/lib/server/services/stats';
import { createUser, listUsers, resetPassword, updateUser } from '@/lib/server/services/users';
import { openStoredImage } from '@/lib/server/storage';
import type { Principal } from '@/lib/shared/types';
import { departmentSchema, requestTypeSchema, settingsSchema, userCreateSchema } from '@/lib/validation/admin';
import { dashboardSchema, exportSchema, reportUpdateSchema, staffReportSchema } from '@/lib/validation/report';
import {
  ADMIN_PASSWORD, adminSession, backdate, db, departmentId, drainJobs, rejects, setupTestDb, staffSession, submitReport, teardown, typeId,
} from './helpers';

let admin: Principal;
before(setupTestDb);
after(teardown);

describe('the admin profile is created first', () => {
  test('before setup nobody can sign in, and only ADMIN_EMAIL can create the first admin', async () => {
    assert.equal((await setupStatus()).setupComplete, false);
    assert.equal((await rejects(() => setupFirstAdmin({ email: 'someone@example.com', password: ADMIN_PASSWORD, name: 'X Y' }))).status, 403);
    assert.equal((await rejects(() => setupFirstAdmin({ email: config().auth.adminEmail, password: 'password', name: 'Admin' }))).status, 400);
    admin = await adminSession();
    assert.equal((await setupStatus()).setupComplete, true);
    assert.equal((await rejects(() => setupFirstAdmin({ email: config().auth.adminEmail, password: ADMIN_PASSWORD, name: 'Again' }))).status, 409);
    assert.equal(admin.role, 'ADMIN');
    assert.equal(admin.departmentId, null);
  });

  test('two setup attempts at the same moment create only one admin', async () => {
    const results = await Promise.allSettled([
      setupFirstAdmin({ email: config().auth.adminEmail, password: ADMIN_PASSWORD, name: 'Race A' }),
      setupFirstAdmin({ email: config().auth.adminEmail, password: ADMIN_PASSWORD, name: 'Race B' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 0, 'the admin exists already');
    assert.equal(await db.user.count({ where: { role: 'ADMIN' } }), 1);
  });

  test('sign-in checks the password and never says which part was wrong', async () => {
    assert.equal(await verifyCredentials(config().auth.adminEmail, 'Wrong-pass-1'), null);
    assert.equal(await verifyCredentials('nobody@example.com', 'Wrong-pass-1'), null);
    assert.ok(await verifyCredentials(config().auth.adminEmail.toUpperCase(), ADMIN_PASSWORD));
  });

  test('an account with the USER role has no access to the panel', async () => {
    const user = await db.user.create({ data: { email: 'resident@example.com', name: 'Banor', passwordHash: 'x', role: 'USER' } });
    assert.equal(await loadPrincipal(user.id, user.sessionVersion), null);
    assert.equal(userCreateSchema.safeParse({ email: 'r@example.com', name: 'Banor', role: 'USER' }).success, false, 'the panel creates only staff and admins');
  });
});

describe('accounts of the department heads', () => {
  test('a department head needs an active department and a unique email', async () => {
    assert.equal(userCreateSchema.safeParse({ email: 'a@example.com', name: 'Pa Sektor', role: 'MUNICIPALITY_STAFF' }).success, false);
    assert.equal((await rejects(() => createUser(admin, userCreateSchema.parse({ email: 'a@example.com', name: 'Sektor', role: 'MUNICIPALITY_STAFF', departmentId: 9999 })))).status, 400);
    const waterId = await departmentId('water');
    await createUser(admin, userCreateSchema.parse({ email: 'a@example.com', name: 'Sektor', role: 'MUNICIPALITY_STAFF', departmentId: waterId }));
    assert.equal((await rejects(() => createUser(admin, userCreateSchema.parse({ email: 'A@example.com', name: 'Sektor', role: 'MUNICIPALITY_STAFF', departmentId: waterId })))).status, 409);
    const second = await createUser(admin, userCreateSchema.parse({ email: 'second.admin@example.com', name: 'Admin Dy', role: 'ADMIN', departmentId: waterId }));
    assert.equal(second.user.departmentId, null, 'admins do not belong to a department');
    assert.ok((await listUsers(admin)).some((u) => u.email === 'a@example.com'));
  });

  test('the database refuses a department head without a department', async () => {
    await assert.rejects(
      db.user.create({ data: { email: 'broken@example.com', name: 'Pa Sektor', passwordHash: 'x', role: 'MUNICIPALITY_STAFF' } }),
      /users_department_matches_role|check constraint/i,
    );
  });

  test('reset password: new temporary password, old sessions end, must change again', async () => {
    const head = await staffSession(admin, { email: 'reset@example.com', departmentCode: 'water' });
    const { temporaryPassword } = await resetPassword(admin, head.user.id);
    const before = await db.user.findUniqueOrThrow({ where: { id: head.user.id } });
    assert.equal(await loadPrincipal(head.user.id, before.sessionVersion - 1), null, 'the old session ended');
    assert.equal(await verifyCredentials('reset@example.com', head.password), null);
    const fresh = await verifyCredentials('reset@example.com', temporaryPassword);
    assert.equal((await loadPrincipal(fresh!.id, fresh!.sessionVersion))?.mustChangePassword, true);
    await drainJobs();
    const mail = await db.emailLog.findFirst({ where: { template: 'password_reset', toAddress: 'reset@example.com' } });
    assert.ok(mail && !mail.bodyText.includes(temporaryPassword));
    assert.equal((await rejects(() => resetPassword(admin, admin.id))).status, 400);
  });

  test('deactivating an account signs it out and frees its open reports', async () => {
    const head = await staffSession(admin, { email: 'leaves@example.com', departmentCode: 'infrastructure' });
    const { report } = await submitReport();
    await assignReport(head.principal, report.id, head.principal.id);
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: report.id } })).status, 'ASSIGNED');
    const updated = await updateUser(admin, head.user.id, { active: false });
    assert.equal(updated.active, false);
    const row = await db.user.findUniqueOrThrow({ where: { id: head.user.id } });
    assert.equal(await loadPrincipal(head.user.id, row.sessionVersion - 1), null);
    assert.equal((await rejects(() => verifyCredentials('leaves@example.com', head.password))).code, 'ACCOUNT_DISABLED');
    const freed = await db.report.findUniqueOrThrow({ where: { id: report.id } });
    assert.equal(freed.assignedToId, null);
    assert.equal(freed.status, 'VERIFIED');
  });

  test('moving a department head to another department takes effect at once (role and department come from the database)', async () => {
    const head = await staffSession(admin, { email: 'moves@example.com', departmentCode: 'infrastructure' });
    await updateUser(admin, head.user.id, { departmentId: await departmentId('water') });
    const row = await db.user.findUniqueOrThrow({ where: { id: head.user.id } });
    const now = await loadPrincipal(head.user.id, row.sessionVersion);
    assert.equal(now?.departmentId, await departmentId('water'));
  });

  test('the admin cannot lock themselves out', async () => {
    assert.equal((await rejects(() => updateUser(admin, admin.id, { active: false }))).status, 400);
    assert.equal((await rejects(() => updateUser(admin, admin.id, { role: 'MUNICIPALITY_STAFF', departmentId: 1 }))).status, 400);
  });
});

describe('departments and the report catalogue', () => {
  test('the admin adds a department, maps a report type to it and new reports go there', async () => {
    const department = await adminService.createDepartment(admin, departmentSchema.parse({
      code: 'mobility', nameSq: 'Sektori i Lëvizshmërisë', nameEn: 'Mobility Sector', description: 'Parkimi dhe trafiku.', email: 'Mobility@Example.com',
    }));
    assert.equal(department.email, 'mobility@example.com');
    assert.equal((await rejects(() => adminService.createDepartment(admin, departmentSchema.parse({ code: 'mobility', nameSq: 'Sektor tjetër', nameEn: 'Other sector' })))).status, 409);
    assert.equal(departmentSchema.safeParse({ nameSq: 'Pa kod' }).success, false);

    const signage = await db.requestType.findUniqueOrThrow({ where: { code: 'streets.signage' } });
    await adminService.updateRequestType(admin, signage.id, { departmentId: department.id, defaultPriority: 'HIGH', slaDays: 2 });
    assert.ok((await getCatalog()).departments.some((d) => d.code === 'mobility'), 'the catalogue cache is refreshed');

    const { report } = await submitReport({ requestTypeId: signage.id });
    assert.equal(report.departmentId, department.id);
    assert.equal(report.priority, 'HIGH');

    const row = (await adminService.listDepartments(admin)).find((d) => d.code === 'mobility')!;
    assert.equal(row.activeTypes, 1);
    assert.equal(row.openReports, 1);
    assert.equal((await rejects(() => adminService.updateDepartment(admin, department.id, { active: false }))).status, 409, 'a department with types or open reports cannot be switched off');
  });

  test('categories, types and areas can be created and edited', async () => {
    const category = await adminService.createCategory(admin, { code: 'events', nameSq: 'Aktivitete', nameEn: 'Events', icon: 'other', sortOrder: 0, active: true });
    await adminService.createRequestType(admin, requestTypeSchema.parse({
      code: 'events.noise', categoryId: category.id, departmentId: await departmentId('municipal_police'), nameSq: 'Zhurmë nga aktivitet',
      nameEn: 'Event noise', kind: 'PROBLEM', slaDays: 2, defaultPriority: 'LOW',
    }));
    const unknown = await rejects(() => adminService.createRequestType(admin, requestTypeSchema.parse({ code: 'x.y', categoryId: 99999, nameSq: 'Lloj', nameEn: 'Type' })));
    assert.equal(unknown.status, 400);
    assert.equal((unknown.details as Array<{ field: string }>)[0]!.field, 'categoryId');
    const area = await adminService.createNeighbourhood(admin, { name: 'Lagjja Test', sortOrder: 99, active: true });
    assert.equal((await rejects(() => adminService.createNeighbourhood(admin, { name: 'Lagjja Test', sortOrder: 0, active: true }))).status, 409);
    assert.equal((await adminService.updateNeighbourhood(admin, area.id, { active: false })).active, false);
    const categories = await adminService.listCategories(admin);
    assert.equal(categories.find((c) => c.code === 'events')!.requestTypes[0]!.department?.code, 'municipal_police');
  });
});

describe('full control over every report', () => {
  test('the admin can set any status, with consistent dates', async () => {
    const { report } = await submitReport();
    const closed = await changeStatus(admin, report.id, { status: 'CLOSED', note: 'Mbyllur nga administratori.', publicNote: true });
    assert.equal(closed.status, 'CLOSED');
    assert.ok(closed.closedAt && closed.resolvedAt);
    const reopened = await changeStatus(admin, report.id, { status: 'IN_PROGRESS', publicNote: true });
    assert.equal(reopened.status, 'IN_PROGRESS');
    assert.equal(reopened.closedAt, null);
    assert.equal(reopened.resolvedAt, null);
    assert.equal((await rejects(() => changeStatus(admin, report.id, { status: 'PENDING', publicNote: true }))).status, 409);
    assert.equal((await rejects(() => changeStatus(admin, report.id, { status: 'IN_PROGRESS', publicNote: true }))).status, 409, 'already in that status');
    assert.equal((await rejects(() => changeStatus(admin, report.id, { status: 'REJECTED', publicNote: true }))).status, 400, 'a reason is needed');
    const rejected = await changeStatus(admin, report.id, { status: 'REJECTED', note: 'Jashtë kompetencës.', publicNote: true });
    assert.equal(rejected.rejectionReason, 'Jashtë kompetencës.');
    const back = await changeStatus(admin, report.id, { status: 'VERIFIED', publicNote: true });
    assert.equal(back.rejectionReason, null);
    assert.equal(back.status, 'VERIFIED');
  });

  test('the admin edits details; a new type re-routes to its department and recalculates the deadline', async () => {
    const { report } = await submitReport();
    const leak = await db.requestType.findUniqueOrThrow({ where: { code: 'water.leak' } });
    const edited = await updateReport(admin, report.id, reportUpdateSchema.parse({
      requestTypeId: leak.id, priority: 'HIGH', description: 'Rrjedhje uji e madhe nën asfalt.', address: 'Rruga e Re 5',
    }));
    assert.equal(edited.type?.code, 'water.leak');
    assert.equal(edited.department?.code, 'water');
    assert.equal(edited.priority, 'HIGH');
    assert.equal(edited.description, 'Rrjedhje uji e madhe nën asfalt.');
    assert.equal(new Date(edited.dueAt!).getTime(), report.createdAt.getTime() + leak.slaDays * 86_400_000);
    assert.ok(edited.events.some((e) => e.type === 'DETAILS_UPDATED'));
    assert.ok(edited.events.some((e) => e.type === 'ROUTING_CHANGED'));

    const unrouted = await updateReport(admin, report.id, { departmentId: null });
    assert.equal(unrouted.department, null);
    assert.ok(((await sidebarCounts(admin)).unrouted ?? 0) >= 1);
    assert.equal((await rejects(() => updateReport(admin, report.id, { latitude: 41.3233, longitude: 19.4414 }))).status, 400);
    assert.equal(reportUpdateSchema.safeParse({ latitude: 41.1 }).success, false);
    assert.equal((await rejects(() => updateReport(admin, report.id, { departmentId: 99999 }))).status, 400);
    assert.equal(reportUpdateSchema.safeParse({}).success, false);
  });

  test('the admin can delete a report together with its photos', async () => {
    const { report, result } = await submitReport();
    const attachment = await db.attachment.findFirstOrThrow({ where: { reportId: report.id } });
    await openStoredImage(attachment);
    await deleteReport(admin, report.id);
    assert.equal((await rejects(() => getReport(admin, report.id))).status, 404);
    assert.equal((await rejects(() => getPublicCase(result.caseNumber))).status, 404);
    assert.equal((await rejects(() => openStoredImage(attachment))).status, 404, 'the file is gone too');
  });

  test('a report taken by phone: description and location required, photo and contact optional', async () => {
    const lightOut = await typeId('lighting.light_out');
    assert.equal(staffReportSchema.safeParse({ requestTypeId: lightOut, channel: 'PHONE', description: 'Fikur' }).success, false, 'description too short');
    const noPlace = await rejects(() => createStaffReport(admin, staffReportSchema.parse({
      requestTypeId: lightOut, channel: 'PHONE', description: 'Drita e rrugës është fikur.',
    })));
    assert.deepEqual((noPlace.details as Array<{ field: string }>).map((d) => d.field), ['address']);

    const created = await createStaffReport(admin, staffReportSchema.parse({
      requestTypeId: lightOut, channel: 'PHONE', priority: 'LOW',
      description: 'Telefonoi një qytetar: drita e rrugës është fikur prej 3 ditësh.', address: 'Rruga Rinia 4',
    }));
    await drainJobs();
    const report = await db.report.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(report.status, 'VERIFIED', 'entered by the municipality itself');
    assert.equal(report.priority, 'LOW', 'the admin\'s choice is kept');
    assert.equal(report.channel, 'PHONE');
    assert.equal(report.anonymous, true);
    assert.equal(report.createdById, admin.id);

    const head = await staffSession(admin, { email: 'phone@example.com', departmentCode: 'infrastructure' });
    assert.equal((await rejects(() => createStaffReport(head.principal, staffReportSchema.parse({
      requestTypeId: lightOut, channel: 'PHONE', description: 'Drita e rrugës është fikur.', address: 'Rruga Rinia 4',
    })))).status, 403);
  });

  test('photos can be hidden from the public', async () => {
    const { report } = await submitReport();
    await changeStatus(admin, report.id, { status: 'VERIFIED', publicNote: true });
    const attachment = await db.attachment.findFirstOrThrow({ where: { reportId: report.id } });
    assert.equal((await getPublicPhoto(attachment.id)).id, attachment.id);
    const detail = await setPhotoVisibility(admin, attachment.id, false);
    assert.equal(detail.attachments[0]!.isPublic, false);
    assert.equal((await rejects(() => getPublicPhoto(attachment.id))).status, 404);
  });
});

describe('appearance, demo data, daily job, export, email log', () => {
  test('appearance settings are saved and shown on the public site', async () => {
    await adminService.saveSettings(admin, settingsSchema.parse({ branding: { headerColor: '#0A8A0A' } }));
    assert.equal(settingsSchema.safeParse({ branding: { headerColor: 'green' } }).success, false);
    const pub = await getPublicSettings();
    assert.equal(pub.branding.headerColor, '#0A8A0A');
    assert.equal(pub.branding.footerColor, '#0B3D0B');
    await adminService.saveSettings(admin, settingsSchema.parse({ embed: { allowedOrigins: ['https://elbasani.gov.al/'] } }));
    assert.deepEqual((await getPublicSettings()).embed.allowedOrigins, ['https://elbasani.gov.al']);
    assert.equal(settingsSchema.safeParse({ embed: { allowedOrigins: ['javascript:alert(1)'] } }).success, false);
  });

  test('demo data fills week, month and year and is removed again', async () => {
    const loaded = await adminService.loadSampleData(admin);
    assert.equal(loaded.created, 60);
    assert.equal(loaded.pendingTransfers, 2);
    for (const period of ['week', 'month', 'year'] as const) {
      const dash = await getDashboard(admin, dashboardSchema.parse({ period, includeTest: 'true' }));
      assert.ok(dash.totals.received > 0, `${period} has data`);
    }
    const withoutTest = await getDashboard(admin, dashboardSchema.parse({ period: 'year' }));
    const withTest = await getDashboard(admin, dashboardSchema.parse({ period: 'year', includeTest: 'true' }));
    assert.ok(withTest.totals.received >= withoutTest.totals.received + 55);
    assert.equal((await adminService.deleteSampleData(admin)).deleted, 60);
  });

  test('the daily job closes old resolved reports and emails overdue lists', async () => {
    await staffSession(admin, { email: 'digest@example.com', departmentCode: 'infrastructure' });
    const old = await submitReport();
    await changeStatus(admin, old.report.id, { status: 'RESOLVED', note: 'U rregullua.', publicNote: true });
    await backdate(old.report.id, 10, ['resolved_at']);
    const late = await submitReport();
    await backdate(late.report.id, 30, ['due_at']);

    const result = await runDaily();
    assert.ok(result.closed >= 1);
    await drainJobs();
    assert.equal((await db.report.findUniqueOrThrow({ where: { id: old.report.id } })).status, 'CLOSED');
    const digest = await db.emailLog.findFirstOrThrow({ where: { template: 'overdue_digest', toAddress: 'digest@example.com' } });
    assert.ok(digest.bodyText.includes(late.result.caseNumber));
  });

  test('the admin exports every department to CSV, safe for Excel', async () => {
    const { report } = await submitReport({ address: '=HYPERLINK("http://evil.example")' });
    const csv = await exportCsv(admin, exportSchema.parse({}));
    assert.ok(csv.startsWith('﻿Numri,'));
    assert.ok(csv.includes('Sektori i Infrastrukturës'));
    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.example"")"`), 'a formula is written as text');
    assert.ok(report.id);
  });

  test('the email log lists what was sent', async () => {
    const log = await adminService.listEmailLog(admin, { page: 1, pageSize: 25, q: 'example.com' });
    assert.ok(log.total > 0);
    assert.ok(log.items[0]!.subject);
    assert.ok(log.items.every((i) => ['LOGGED', 'SENT', 'QUEUED'].includes(i.status)));
  });
});
