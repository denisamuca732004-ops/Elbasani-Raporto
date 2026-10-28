/**
 * "This report does not belong to our department."
 * A department head sends a request to the admin with a reason (and,
 * optionally, the department they think is right). The admin either moves
 * the report to the right department (approve) or keeps it where it is
 * (decline, with an explanation). Only one open request per report: the
 * database enforces it with a unique column (pending_report_id).
 */
import 'server-only';
import { FINAL_STATUSES } from '@/lib/shared/domain';
import type { Paged, Principal, ReportDetail, TransferListItem } from '@/lib/shared/types';
import type { TransferDecisionInput, TransferListQuery, TransferRequestInput } from '@/lib/validation/report';
import { Prisma, db, type Tx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { queueEmails } from '../mail';
import * as tpl from '../mailTemplates';
import { assertCanAccessReport, isAdmin } from './access';
import { toTransferSummary, transferInclude, typeRef } from './mapper';
import { adminRecipients, notifyCitizenStatus, notifyDepartmentOfReport } from './notification';
import { buildDetail } from './report';
import { moveToDepartment } from './routing';

const listInclude = {
  ...transferInclude,
  report: { select: { id: true, caseNumber: true, status: true, priority: true, address: true, description: true, requestType: true } },
} satisfies Prisma.DepartmentTransferInclude;
type ListRow = Prisma.DepartmentTransferGetPayload<{ include: typeof listInclude }>;

function toListItem(t: ListRow): TransferListItem {
  return {
    ...toTransferSummary(t),
    report: {
      id: t.report.id, caseNumber: t.report.caseNumber, status: t.report.status, priority: t.report.priority,
      type: typeRef(t.report.requestType), address: t.report.address, description: t.report.description,
    },
  };
}

async function activeDepartment(tx: Tx, id: number, field: string) {
  const department = await tx.department.findUnique({ where: { id } });
  if (!department || !department.active) {
    throw badRequest('Ky sektor nuk ekziston ose është çaktivizuar.', [{ field, code: 'unknown', message: 'Ky sektor nuk ekziston ose është çaktivizuar.' }]);
  }
  return department;
}

/** Department head: "this is not our department's problem" → request to the admin. */
export async function requestTransfer(user: Principal, reportId: string, input: TransferRequestInput): Promise<ReportDetail> {
  if (isAdmin(user)) throw forbidden('Administratori e ndryshon sektorin direkt te detajet e raportimit.');
  const report = await db.report.findUnique({ where: { id: reportId }, include: { department: true } });
  if (!report) throw notFound('Raportimi nuk u gjet.');
  assertCanAccessReport(user, report);
  if (!report.departmentId) throw conflict('Ky raportim nuk ka sektor.');
  if (FINAL_STATUSES.includes(report.status)) throw conflict('Raportimi është mbyllur.');

  let suggested: { id: number; nameSq: string } | null = null;
  if (input.suggestedDepartmentId) {
    suggested = await activeDepartment(db, input.suggestedDepartmentId, 'suggestedDepartmentId');
    if (suggested.id === report.departmentId) {
      throw badRequest('Sugjeroni një sektor tjetër nga i juaji.', [
        { field: 'suggestedDepartmentId', code: 'same_department', message: 'Sugjeroni një sektor tjetër nga i juaji.' },
      ]);
    }
  }

  try {
    await db.$transaction(async (tx) => {
      const created = await tx.departmentTransfer.create({
        data: {
          reportId: report.id,
          pendingReportId: report.id,
          fromDepartmentId: report.departmentId!,
          suggestedDepartmentId: suggested?.id ?? null,
          reason: input.reason,
          requestedById: user.id,
        },
      });
      await tx.reportEvent.create({
        data: {
          reportId: report.id, type: 'TRANSFER_REQUESTED', actorId: user.id,
          message: `Nuk i përket sektorit ${report.department?.nameSq ?? ''}. Arsyeja: ${input.reason}`.replace(/\s+/g, ' '),
          meta: { transferId: created.id, fromDepartmentId: report.departmentId, suggestedDepartmentId: suggested?.id ?? null },
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('Ka tashmë një kërkesë për rishikim në pritje për këtë raportim.');
    }
    throw err;
  }

  if (!report.isTest) {
    const mail = tpl.transferRequested({
      caseNumber: report.caseNumber, reportId: report.id, fromDepartmentSq: report.department?.nameSq ?? '',
      suggestedDepartmentSq: suggested?.nameSq ?? null, reason: input.reason, requestedByName: user.name,
    });
    await queueEmails(await adminRecipients(), mail, report.id);
  }
  return buildDetail(user, reportId);
}

/** Admin: every request. Department head: the requests their department sent. */
export async function listTransfers(user: Principal, query: TransferListQuery): Promise<Paged<TransferListItem>> {
  const where: Prisma.DepartmentTransferWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(isAdmin(user) ? {} : { fromDepartmentId: user.departmentId ?? -1 }),
  };
  const [rows, total] = await Promise.all([
    db.departmentTransfer.findMany({
      where,
      include: listInclude,
      orderBy: query.status === 'PENDING' ? [{ createdAt: 'asc' }] : [{ createdAt: 'desc' }],
      take: query.pageSize,
      skip: (query.page - 1) * query.pageSize,
    }),
    db.departmentTransfer.count({ where }),
  ]);
  return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
}

export async function pendingTransferCount(user: Principal): Promise<number> {
  return db.departmentTransfer.count({
    where: { status: 'PENDING', ...(isAdmin(user) ? {} : { fromDepartmentId: user.departmentId ?? -1 }) },
  });
}

/** Admin: move the report to the right department, or keep it where it is. */
export async function decideTransfer(user: Principal, transferId: string, input: TransferDecisionInput): Promise<TransferListItem> {
  if (!isAdmin(user)) throw forbidden('Vetëm administratori vendos për kërkesat për rishikim.');
  const outcome = await db.$transaction(async (tx) => {
    const transfer = await tx.departmentTransfer.findUnique({ where: { id: transferId } });
    if (!transfer) throw notFound('Kërkesa për rishikim nuk u gjet.');
    if (transfer.status !== 'PENDING') throw conflict('Për këtë kërkesë është vendosur tashmë.');
    const report = await tx.report.findUnique({ where: { id: transfer.reportId } });
    if (!report) throw notFound('Raportimi nuk u gjet.');
    // Claim the request first: if two admins decide at the same moment, only one succeeds.
    const decide = (data: Prisma.DepartmentTransferUncheckedUpdateManyInput) =>
      tx.departmentTransfer.updateMany({ where: { id: transferId, status: 'PENDING' }, data: { ...data, pendingReportId: null, decidedById: user.id, decidedAt: new Date() } });

    if (input.decision === 'approve') {
      const toDepartmentId = input.toDepartmentId ?? transfer.suggestedDepartmentId;
      if (!toDepartmentId) {
        throw badRequest('Zgjidhni sektorin ku duhet të kalojë raportimi.', [{ field: 'toDepartmentId', code: 'required', message: 'Zgjidhni sektorin.' }]);
      }
      const toDepartment = await activeDepartment(tx, toDepartmentId, 'toDepartmentId');
      if (toDepartment.id === report.departmentId) {
        throw badRequest('Raportimi është tashmë në këtë sektor. Zgjidhni një sektor tjetër ose refuzojeni kërkesën.', [
          { field: 'toDepartmentId', code: 'same_department', message: 'Raportimi është tashmë në këtë sektor.' },
        ]);
      }
      if (FINAL_STATUSES.includes(report.status)) throw conflict('Raportimi është mbyllur dhe nuk mund të kalojë në një sektor tjetër.');
      const note = input.note ?? null;
      const claimed = await decide({ status: 'APPROVED', toDepartmentId: toDepartment.id, decisionNote: note });
      if (claimed.count === 0) throw conflict('Për këtë kërkesë është vendosur tashmë.');
      const { previousStatus, statusChanged } = await moveToDepartment(tx, report, toDepartment.id, user.id, 'U kalua pas rishikimit të administratorit.');
      await tx.reportEvent.create({
        data: {
          reportId: report.id, type: 'TRANSFER_APPROVED', actorId: user.id,
          message: `Kërkesa u pranua. Raportimi kaloi te ${toDepartment.nameSq}.${note ? ` Shënim: ${note}` : ''}`,
          meta: { transferId, toDepartmentId: toDepartment.id },
        },
      });
      return { transfer, report, previousStatus, nextStatus: statusChanged ? ('VERIFIED' as const) : previousStatus, approved: true, toDepartment, note };
    }

    const claimed = await decide({ status: 'DECLINED', decisionNote: input.note });
    if (claimed.count === 0) throw conflict('Për këtë kërkesë është vendosur tashmë.');
    await tx.reportEvent.create({
      data: {
        reportId: report.id, type: 'TRANSFER_DECLINED', actorId: user.id,
        message: `Kërkesa u refuzua, raportimi mbetet te sektori. Arsyeja: ${input.note}`,
        meta: { transferId },
      },
    });
    return { transfer, report, previousStatus: report.status, nextStatus: report.status, approved: false, toDepartment: null, note: input.note };
  });

  const { transfer, report } = outcome;
  if (!report.isTest) {
    if (outcome.approved) {
      await notifyDepartmentOfReport(report.id, 'transferred');
      await notifyCitizenStatus(report, outcome.previousStatus, outcome.nextStatus, null);
    }
    if (transfer.requestedById) {
      const requester = await db.user.findUnique({ where: { id: transfer.requestedById }, select: { email: true, name: true, active: true } });
      if (requester?.active) {
        await queueEmails([requester.email], tpl.transferDecided({
          caseNumber: report.caseNumber, reportId: report.id, approved: outcome.approved,
          toDepartmentSq: outcome.toDepartment?.nameSq ?? null, note: outcome.note, name: requester.name,
        }), report.id);
      }
    }
  }
  const fresh = await db.departmentTransfer.findUniqueOrThrow({ where: { id: transfer.id }, include: listInclude });
  return toListItem(fresh);
}
