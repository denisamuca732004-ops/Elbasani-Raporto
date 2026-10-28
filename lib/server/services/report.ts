/**
 * Working on reports inside the municipality.
 *  - ADMIN: sees and edits everything, may set any status, re-route, delete.
 *  - MUNICIPALITY_STAFF: works only on the reports of their own department and
 *    follows the normal workflow; when a report belongs elsewhere they ask the
 *    admin to review it (see transfer.ts).
 *
 * Every change checks the status it started from inside the transaction, so
 * two people acting on the same report at the same moment never overwrite
 * each other: the second one is told to refresh.
 */
import 'server-only';
import { FINAL_STATUSES, OPEN_STATUSES, PRIORITIES, publicStatusOf, type Priority, type Status } from '@/lib/shared/domain';
import type { Paged, Principal, ReportDetail, ReportListItem } from '@/lib/shared/types';
import type { ReportFilters, ReportListQuery, ReportUpdateInput, StaffReportInput, StatusChangeInput } from '@/lib/validation/report';
import { db, type Prisma, type Tx } from '../db';
import { AppError, badRequest, conflict, notFound } from '../errors';
import { queueEmails } from '../mail';
import * as tpl from '../mailTemplates';
import { enqueue } from '../queue';
import { deleteStoredImage, discardTemporaryUpload, storeImage, takeTemporaryUpload, type StoredImage } from '../storage';
import { createToken } from '../tokens';
import { assertAdmin, assertCanAccessReport, isAdmin, reportScope } from './access';
import { insideServiceArea } from './geo';
import { allowedStatusesFor, detailInclude, listInclude, toDetail, toListItem } from './mapper';
import { citizenRecipients, notifyCitizenStatus, notifyDepartmentOfReport } from './notification';
import { persistNewReport, routeDepartmentId } from './reportCreation';
import { moveToDepartment, settlePendingTransfer } from './routing';

const DAY_MS = 86_400_000;
const CHANGED_MEANWHILE = 'Raportimi u ndryshua ndërkohë nga dikush tjetër. Rifreskoni faqen dhe provoni përsëri.';

/* ───────────────────────── Loading ───────────────────────── */

async function loadReport(id: string, tx: Tx = db) {
  const report = await tx.report.findUnique({ where: { id } });
  if (!report) throw notFound('Raportimi nuk u gjet.');
  return report;
}
type ReportRow = Awaited<ReturnType<typeof loadReport>>;

async function loadAccessible(user: Principal, id: string) {
  const report = await loadReport(id);
  assertCanAccessReport(user, report);
  return report;
}

function assertOpen(report: { status: Status }, message = 'Raportimi është mbyllur. Rihapeni më parë.'): void {
  if (FINAL_STATUSES.includes(report.status)) throw conflict(message);
}

/** The full report as the given person may see it. */
export async function buildDetail(user: Principal, id: string): Promise<ReportDetail> {
  const [report, events] = await Promise.all([
    db.report.findUnique({ where: { id }, include: detailInclude }),
    db.reportEvent.findMany({ where: { reportId: id }, include: { actor: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ]);
  if (!report) throw notFound('Raportimi nuk u gjet.');
  return toDetail(report, user, events);
}

export async function getReport(user: Principal, id: string): Promise<ReportDetail> {
  await loadAccessible(user, id);
  return buildDetail(user, id);
}

/* ───────────────────────── Lists and counts ───────────────────────── */

export function buildWhere(user: Principal, f: ReportFilters): Prisma.ReportWhereInput {
  const and: Prisma.ReportWhereInput[] = [reportScope(user)];
  if (!f.includeTest) and.push({ isTest: false });
  if (f.status?.length) and.push({ status: { in: f.status } });
  if (f.priority) and.push({ priority: f.priority });
  if (isAdmin(user) && f.departmentId) and.push({ departmentId: f.departmentId });
  if (isAdmin(user) && f.unrouted) and.push({ departmentId: null });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.neighbourhoodId) and.push({ neighbourhoodId: f.neighbourhoodId });
  if (f.assignedToMe) and.push({ assignedToId: user.id });
  if (f.overdue) and.push({ dueAt: { lt: new Date() }, status: { in: [...OPEN_STATUSES] } });
  if (f.transferPending) and.push({ transfers: { some: { status: 'PENDING' } } });
  if (f.q) {
    const contains = { contains: f.q, mode: 'insensitive' as const };
    and.push({
      OR: [
        { caseNumber: contains }, { address: contains }, { description: contains }, { aiSummary: contains },
        { contactName: contains }, { contactEmail: contains }, { contactPhone: contains },
      ],
    });
  }
  return { AND: and };
}

function orderFor(sort: ReportListQuery['sort']): Prisma.ReportOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest': return [{ createdAt: 'desc' }, { id: 'asc' }];
    case 'oldest': return [{ createdAt: 'asc' }, { id: 'asc' }];
    case 'due': return [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }, { id: 'asc' }];
    case 'priority':
    default:
      // PostgreSQL sorts enums in declaration order (LOW, MEDIUM, HIGH): DESC puts HIGH first.
      // Inside a priority the oldest report comes first (first in, first out).
      return [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];
  }
}

export async function listReports(user: Principal, query: ReportListQuery): Promise<Paged<ReportListItem>> {
  const where = buildWhere(user, query);
  const [rows, total] = await Promise.all([
    db.report.findMany({
      where, include: listInclude, orderBy: orderFor(query.sort), take: query.pageSize, skip: (query.page - 1) * query.pageSize,
    }),
    db.report.count({ where }),
  ]);
  return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

/** Numbers for the "E lartë / Mesatare / E ulët" tabs: the same filters, without the priority. */
export async function priorityCounts(user: Principal, query: ReportFilters): Promise<Record<Priority, number> & { total: number }> {
  const rows = await db.report.groupBy({ by: ['priority'], where: buildWhere(user, { ...query, priority: undefined }), _count: { _all: true } });
  const counts = { LOW: 0, MEDIUM: 0, HIGH: 0, total: 0 };
  for (const row of rows) {
    if (PRIORITIES.includes(row.priority)) counts[row.priority] = row._count._all;
    counts.total += row._count._all;
  }
  return counts;
}

/** People a report can be given to: the heads of its department (and, for the admin, the admins). */
export async function assignableUsers(user: Principal, reportId: string) {
  const report = await loadAccessible(user, reportId);
  const or: Prisma.UserWhereInput[] = [];
  if (report.departmentId) or.push({ role: 'MUNICIPALITY_STAFF', departmentId: report.departmentId });
  if (isAdmin(user)) or.push({ role: 'ADMIN' });
  if (!or.length) return [];
  const people = await db.user.findMany({
    where: { active: true, OR: or },
    include: { department: { select: { nameSq: true } } },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
  return people.map((p) => ({ id: p.id, name: p.name, role: p.role, departmentId: p.departmentId, departmentName: p.department?.nameSq ?? null }));
}

/* ───────────────────────── Status workflow ───────────────────────── */

interface ApplyStatusOptions {
  note?: string | null;
  publicNote?: boolean;
  extra?: Prisma.ReportUncheckedUpdateManyInput;
}

/**
 * Changes the status, keeps every timestamp consistent and writes the history.
 * Fails with 409 if someone else changed the status meanwhile.
 */
async function applyStatus(tx: Tx, user: Principal, report: ReportRow, status: Status, opts: ApplyStatusOptions = {}): Promise<Status> {
  const { note = null, publicNote = true, extra = {} } = opts;
  const previous = report.status;
  const now = new Date();
  const data: Prisma.ReportUncheckedUpdateManyInput = { status, ...extra };

  if (status === 'VERIFIED' && !report.verifiedAt) data.verifiedAt = now;
  // VERIFIED and NEEDS_REVIEW mean nobody has taken the report yet.
  if ((status === 'VERIFIED' || status === 'NEEDS_REVIEW') && report.assignedToId && !('assignedToId' in extra)) data.assignedToId = null;
  if (status === 'ASSIGNED' && !report.assignedToId && !('assignedToId' in extra)) data.assignedToId = user.id;
  // Only RESOLVED and CLOSED keep the resolution; only CLOSED keeps the closing time.
  if (status === 'RESOLVED' && !('resolvedAt' in extra)) data.resolvedAt = now;
  if (status === 'CLOSED') {
    data.closedAt = now;
    if (!report.resolvedAt) data.resolvedAt = now;
  } else {
    data.closedAt = null;
  }
  if (status !== 'RESOLVED' && status !== 'CLOSED') {
    data.resolvedAt = null;
    if (!('closingNote' in extra)) data.closingNote = null;
  }
  // The resident's "was it fixed?" link only works while the report is RESOLVED.
  if (status !== 'RESOLVED' && !('citizenTokenHash' in extra)) data.citizenTokenHash = null;
  if (status !== 'REJECTED' && previous === 'REJECTED') data.rejectionReason = null;

  const updated = await tx.report.updateMany({ where: { id: report.id, status: previous }, data });
  if (updated.count === 0) throw conflict(CHANGED_MEANWHILE);
  await tx.reportEvent.create({
    data: {
      reportId: report.id,
      type: 'STATUS_CHANGED',
      fromStatus: previous,
      toStatus: status,
      actorId: user.id,
      isPublic: status !== 'NEEDS_REVIEW' && status !== 'PENDING',
      message: note && publicNote ? note : null,
    },
  });
  if (note && !publicNote) {
    await tx.reportEvent.create({ data: { reportId: report.id, type: 'NOTE', actorId: user.id, message: note } });
  }
  if (FINAL_STATUSES.includes(status)) {
    await settlePendingTransfer(tx, report.id, user.id, { status: 'DECLINED', note: 'Kërkesa u mbyll automatikisht sepse raportimi u mbyll.' });
  }
  return previous;
}

function assertAllowed(user: Principal, report: ReportRow, status: Status): void {
  if (!allowedStatusesFor(user, report).includes(status)) {
    throw new AppError(409, 'STATUS_NOT_ALLOWED', 'Ky ndryshim statusi nuk lejohet për këtë raportim.', {
      from: report.status, to: status, allowed: allowedStatusesFor(user, report),
    });
  }
}

export async function changeStatus(user: Principal, id: string, input: StatusChangeInput): Promise<ReportDetail> {
  const report = await loadAccessible(user, id);
  assertAllowed(user, report, input.status);
  const note = input.note ?? null;
  if (input.status === 'REJECTED') {
    if (!note) throw badRequest('Shkruani arsyen e refuzimit për qytetarin.', [{ field: 'note', code: 'required', message: 'Shkruani arsyen e refuzimit.' }]);
    return rejectReport(user, id, { reason: note });
  }
  if (input.status === 'RESOLVED') return resolveReport(user, id, { note: note ?? undefined });

  const previous = await db.$transaction((tx) => applyStatus(tx, user, report, input.status, { note, publicNote: input.publicNote }));
  await notifyCitizenStatus(report, previous, input.status, input.publicNote ? note : null);
  return buildDetail(user, id);
}

export async function rejectReport(user: Principal, id: string, input: { reason: string }): Promise<ReportDetail> {
  const report = await loadAccessible(user, id);
  assertAllowed(user, report, 'REJECTED');
  const reason = input.reason.trim();
  const previous = await db.$transaction((tx) =>
    applyStatus(tx, user, report, 'REJECTED', { note: reason, publicNote: true, extra: { rejectionReason: reason } }));
  await notifyCitizenStatus(report, previous, 'REJECTED', reason);
  return buildDetail(user, id);
}

export async function resolveReport(user: Principal, id: string, input: { note?: string; photoKey?: string }): Promise<ReportDetail> {
  const report = await loadAccessible(user, id);
  assertAllowed(user, report, 'RESOLVED');
  const note = input.note?.trim() || null;
  const photo: StoredImage | null = input.photoKey ? await storeImage(await takeTemporaryUpload(input.photoKey)) : null;
  const feedback = report.contactEmail && !report.isTest ? createToken() : null;
  try {
    await db.$transaction(async (tx) => {
      if (photo) {
        await tx.attachment.create({
          data: { reportId: id, kind: 'AFTER', storageKey: photo.key, storageUrl: photo.url, mime: photo.mime, size: photo.size, width: photo.width, height: photo.height },
        });
      }
      await applyStatus(tx, user, report, 'RESOLVED', {
        note, publicNote: true, extra: { closingNote: note, citizenTokenHash: feedback?.hash ?? null, resolvedAt: new Date() },
      });
    });
  } catch (err) {
    if (photo) await deleteStoredImage(photo.key);
    throw err;
  }
  if (input.photoKey) await discardTemporaryUpload(input.photoKey);

  if (!report.isTest) {
    const owner = report.contactEmail?.toLowerCase() ?? null;
    for (const to of await citizenRecipients(report)) {
      const mail = feedback && to === owner
        ? tpl.resolvedConfirm({ caseNumber: report.caseNumber, note, feedbackUrl: tpl.feedbackUrl(feedback.token) })
        : tpl.statusChanged({ caseNumber: report.caseNumber, publicStatus: 'RESOLVED', note });
      await queueEmails([to], mail, id);
    }
  }
  if (photo) await enqueue('closing-check', { reportId: id });
  return buildDetail(user, id);
}

/* ───────────────────────── Other actions ───────────────────────── */

export async function changePriority(user: Principal, id: string, priority: Priority): Promise<ReportDetail> {
  const report = await loadAccessible(user, id);
  assertOpen(report);
  if (report.priority !== priority) {
    await db.$transaction(async (tx) => {
      const updated = await tx.report.updateMany({ where: { id, priority: report.priority, status: { notIn: [...FINAL_STATUSES] } }, data: { priority } });
      if (updated.count === 0) throw conflict(CHANGED_MEANWHILE);
      await tx.reportEvent.create({
        data: {
          reportId: id, type: 'PRIORITY_CHANGED', actorId: user.id,
          message: `Prioriteti: ${tpl.PRIORITY_SQ[report.priority]} → ${tpl.PRIORITY_SQ[priority]}`, meta: { from: report.priority, to: priority },
        },
      });
    });
  }
  return buildDetail(user, id);
}

export async function assignReport(user: Principal, id: string, userId: string | null): Promise<ReportDetail> {
  const report = await loadAccessible(user, id);
  assertOpen(report, 'Raportimet e mbyllura nuk mund t\'i caktohen dikujt.');
  let assignee: { id: string; name: string; email: string; role: string; departmentId: number | null } | null = null;
  if (userId) {
    assignee = await db.user.findFirst({ where: { id: userId, active: true }, select: { id: true, name: true, email: true, role: true, departmentId: true } });
    if (!assignee) throw badRequest('Ky person nuk ekziston ose është çaktivizuar.');
    const sameDepartment = assignee.role === 'MUNICIPALITY_STAFF' && assignee.departmentId !== null && assignee.departmentId === report.departmentId;
    const allowed = isAdmin(user) ? sameDepartment || assignee.role === 'ADMIN' : sameDepartment;
    if (!allowed) throw badRequest('Ky person nuk punon në sektorin e këtij raportimi.');
  }
  if ((assignee?.id ?? null) === report.assignedToId) return buildDetail(user, id);

  const { previous, status } = await db.$transaction(async (tx) => {
    const updated = await tx.report.updateMany({ where: { id, assignedToId: report.assignedToId, status: report.status }, data: { assignedToId: assignee?.id ?? null } });
    if (updated.count === 0) throw conflict(CHANGED_MEANWHILE);
    await tx.reportEvent.create({
      data: {
        reportId: id, type: 'ASSIGNED', actorId: user.id,
        message: assignee ? `Iu caktua: ${assignee.name}` : 'U hoq caktimi',
        meta: { assigneeId: assignee?.id ?? null },
      },
    });
    const current = { ...report, assignedToId: assignee?.id ?? null };
    if (assignee && (report.status === 'NEEDS_REVIEW' || report.status === 'VERIFIED' || report.status === 'PENDING')) {
      return { previous: await applyStatus(tx, user, current, 'ASSIGNED', { extra: { assignedToId: assignee.id } }), status: 'ASSIGNED' as Status };
    }
    if (!assignee && report.status === 'ASSIGNED') {
      return { previous: await applyStatus(tx, user, current, 'VERIFIED', { extra: { assignedToId: null } }), status: 'VERIFIED' as Status };
    }
    return { previous: report.status, status: report.status };
  });

  if (assignee && assignee.id !== user.id && !report.isTest) {
    const type = await db.requestType.findUnique({ where: { id: report.requestTypeId }, select: { nameSq: true } });
    await queueEmails([assignee.email], tpl.staffAssigned({ caseNumber: report.caseNumber, typeNameSq: type?.nameSq ?? '', reportId: id, assigneeName: assignee.name }), id);
  }
  await notifyCitizenStatus(report, previous, status, null);
  return buildDetail(user, id);
}

export async function addNote(user: Principal, id: string, message: string): Promise<ReportDetail> {
  await loadAccessible(user, id);
  await db.reportEvent.create({ data: { reportId: id, type: 'NOTE', actorId: user.id, message } });
  return buildDetail(user, id);
}

export async function messageCitizen(user: Principal, id: string, message: string): Promise<ReportDetail> {
  const report = await loadAccessible(user, id);
  if (!report.contactEmail) throw badRequest('Qytetari nuk ka lënë email.');
  await db.reportEvent.create({ data: { reportId: id, type: 'MESSAGE_TO_CITIZEN', actorId: user.id, message } });
  await queueEmails([report.contactEmail], tpl.messageToCitizen({ caseNumber: report.caseNumber, message }), id);
  return buildDetail(user, id);
}

/** A photo for the panel: only for people who may see the report. */
export async function getStaffPhoto(user: Principal, attachmentId: string) {
  const attachment = await db.attachment.findUnique({ where: { id: attachmentId }, include: { report: { select: { departmentId: true } } } });
  if (!attachment) throw notFound('Fotoja nuk u gjet.');
  assertCanAccessReport(user, attachment.report);
  return attachment;
}

export async function setPhotoVisibility(user: Principal, attachmentId: string, isPublic: boolean): Promise<ReportDetail> {
  const attachment = await getStaffPhoto(user, attachmentId);
  if (attachment.isPublic !== isPublic) {
    await db.$transaction([
      db.attachment.update({ where: { id: attachmentId }, data: { isPublic } }),
      db.reportEvent.create({
        data: {
          reportId: attachment.reportId, type: 'PHOTO_VISIBILITY', actorId: user.id,
          message: isPublic ? 'Fotoja u bë publike' : 'Fotoja u fsheh nga publiku', meta: { attachmentId, isPublic },
        },
      }),
    ]);
  }
  return buildDetail(user, attachment.reportId);
}

/* ───────────────────────── Admin only ───────────────────────── */

/** Admin: edit any detail. Changing the type also re-routes to that type's department unless a department is given. */
export async function updateReport(user: Principal, id: string, input: ReportUpdateInput): Promise<ReportDetail> {
  assertAdmin(user);
  const report = await loadReport(id);
  const changes: Prisma.ReportUncheckedUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const record = <K extends keyof ReportRow>(field: K, value: ReportRow[K]) => {
    const current = report[field];
    const same = current instanceof Date && value instanceof Date ? current.getTime() === value.getTime() : current === value;
    if (same) return;
    before[field as string] = current;
    after[field as string] = value;
    (changes as Record<string, unknown>)[field as string] = value;
  };

  let targetDepartment: number | null | undefined;
  if (input.requestTypeId !== undefined && input.requestTypeId !== report.requestTypeId) {
    const type = await db.requestType.findUnique({ where: { id: input.requestTypeId } });
    if (!type) throw badRequest('Ky lloj raportimi nuk ekziston.', [{ field: 'requestTypeId', code: 'unknown', message: 'Ky lloj raportimi nuk ekziston.' }]);
    record('requestTypeId', type.id);
    record('categoryId', type.categoryId);
    record('kind', type.kind);
    record('dueAt', new Date(report.createdAt.getTime() + type.slaDays * DAY_MS));
    if (input.departmentId === undefined) targetDepartment = await routeDepartmentId(type);
  }
  if (input.departmentId !== undefined) {
    if (input.departmentId !== null) {
      const department = await db.department.findUnique({ where: { id: input.departmentId } });
      if (!department || !department.active) {
        throw badRequest('Ky sektor nuk ekziston ose është çaktivizuar.', [{ field: 'departmentId', code: 'unknown', message: 'Ky sektor nuk ekziston ose është çaktivizuar.' }]);
      }
    }
    targetDepartment = input.departmentId;
  }
  if (input.priority !== undefined) record('priority', input.priority);
  if (input.neighbourhoodId !== undefined) {
    if (input.neighbourhoodId !== null && !(await db.neighbourhood.findUnique({ where: { id: input.neighbourhoodId } }))) {
      throw badRequest('Kjo zonë nuk ekziston.', [{ field: 'neighbourhoodId', code: 'unknown', message: 'Kjo zonë nuk ekziston.' }]);
    }
    record('neighbourhoodId', input.neighbourhoodId);
  }
  if (input.description !== undefined) record('description', input.description);
  if (input.address !== undefined) record('address', input.address);
  if (input.latitude !== undefined && input.longitude !== undefined) {
    if (!insideServiceArea(input.latitude, input.longitude)) {
      throw badRequest('Pika duhet të jetë brenda Bashkisë Elbasan.', [{ field: 'latitude', code: 'outside_area', message: 'Pika duhet të jetë brenda Bashkisë Elbasan.' }]);
    }
    record('latitude', input.latitude);
    record('longitude', input.longitude);
  }
  const departmentChanges = targetDepartment !== undefined && targetDepartment !== report.departmentId;
  if (!Object.keys(changes).length && !departmentChanges) return buildDetail(user, id);

  const final = FINAL_STATUSES.includes(report.status);
  let statusAfter: Status = report.status;
  await db.$transaction(async (tx) => {
    if (Object.keys(changes).length) {
      const updated = await tx.report.updateMany({ where: { id, updatedAt: report.updatedAt }, data: changes as Prisma.ReportUncheckedUpdateManyInput });
      if (updated.count === 0) throw conflict(CHANGED_MEANWHILE);
      const fields = Object.keys(changes).filter((f) => !['categoryId', 'kind', 'dueAt'].includes(f));
      await tx.reportEvent.create({
        data: {
          reportId: id, type: 'DETAILS_UPDATED', actorId: user.id, message: `Administratori ndryshoi: ${fields.join(', ')}`,
          meta: JSON.parse(JSON.stringify({ before, after })) as Prisma.InputJsonObject,
        },
      });
      if (input.priority !== undefined && input.priority !== report.priority) {
        await tx.reportEvent.create({
          data: {
            reportId: id, type: 'PRIORITY_CHANGED', actorId: user.id,
            message: `Prioriteti: ${tpl.PRIORITY_SQ[report.priority]} → ${tpl.PRIORITY_SQ[input.priority]}`,
            meta: { from: report.priority, to: input.priority },
          },
        });
      }
    }
    if (departmentChanges) {
      if (final) {
        await tx.report.update({ where: { id }, data: { departmentId: targetDepartment ?? null } });
        await tx.reportEvent.create({
          data: { reportId: id, type: 'ROUTING_CHANGED', actorId: user.id, message: 'Sektori u korrigjua nga administratori.', meta: { toDepartmentId: targetDepartment ?? null } },
        });
      } else {
        const moved = await moveToDepartment(tx, report, targetDepartment ?? null, user.id, 'Administratori e drejtoi raportimin.');
        if (moved.statusChanged) statusAfter = 'VERIFIED';
        await settlePendingTransfer(tx, id, user.id, {
          status: 'APPROVED', toDepartmentId: targetDepartment ?? null, note: 'U zgjidh duke ndryshuar sektorin e raportimit.',
        });
      }
    }
  });
  if (departmentChanges && targetDepartment && !final) await notifyDepartmentOfReport(id, 'rerouted');
  await notifyCitizenStatus(report, report.status, statusAfter, null);
  return buildDetail(user, id);
}

export async function deleteReport(user: Principal, id: string): Promise<{ deleted: true; caseNumber: string }> {
  assertAdmin(user);
  const report = await db.report.findUnique({ where: { id }, include: { attachments: { select: { storageKey: true } } } });
  if (!report) throw notFound('Raportimi nuk u gjet.');
  await db.report.delete({ where: { id } });
  for (const a of report.attachments) await deleteStoredImage(a.storageKey);
  return { deleted: true, caseNumber: report.caseNumber };
}

export async function setTestFlag(user: Principal, id: string, isTest: boolean): Promise<ReportDetail> {
  assertAdmin(user);
  await loadReport(id);
  await db.report.update({ where: { id }, data: { isTest } });
  return buildDetail(user, id);
}

/**
 * Admin: a resident called, wrote on Facebook or came to the office.
 * Description and a location (pin or address) are required; photo and contact are optional.
 */
export async function createStaffReport(user: Principal, data: StaffReportInput) {
  assertAdmin(user);
  const problems: Array<{ field: string; code: string; message: string }> = [];
  const type = await db.requestType.findFirst({ where: { id: data.requestTypeId, active: true } });
  if (!type) problems.push({ field: 'requestTypeId', code: 'unknown', message: 'Zgjidhni llojin e raportimit.' });
  const hasPin = data.latitude !== undefined && data.longitude !== undefined;
  if (hasPin && !insideServiceArea(data.latitude!, data.longitude!)) {
    problems.push({ field: 'latitude', code: 'outside_area', message: 'Pika duhet të jetë brenda Bashkisë Elbasan.' });
  }
  const address = (data.address ?? '').replace(/\s+/g, ' ');
  if (!hasPin && address.length < 3) problems.push({ field: 'address', code: 'required', message: 'Vendosni pikën në hartë ose shkruani adresën.' });
  if (data.neighbourhoodId && !(await db.neighbourhood.findFirst({ where: { id: data.neighbourhoodId, active: true } }))) {
    problems.push({ field: 'neighbourhoodId', code: 'unknown', message: 'Kjo zonë nuk ekziston.' });
  }
  if (problems.length || !type) throw new AppError(400, 'REPORT_INCOMPLETE', 'Plotësoni fushat e detyrueshme.', problems);

  const name = data.contactName ?? '';
  const email = data.contactEmail ?? '';
  const phone = data.contactPhone ?? '';
  const { report } = await persistNewReport({
    type,
    channel: data.channel,
    priority: data.priority,
    description: data.description,
    address: address || null,
    latitude: hasPin ? data.latitude! : null,
    longitude: hasPin ? data.longitude! : null,
    neighbourhoodId: data.neighbourhoodId ?? null,
    anonymous: !name && !email && !phone,
    contactName: name || null,
    contactEmail: email || null,
    contactPhone: phone || null,
    createdById: user.id,
    clientRef: null,
    photoKey: data.photoKey ?? null,
  });
  return { id: report.id, caseNumber: report.caseNumber, publicStatus: publicStatusOf(report.status as Status) };
}
