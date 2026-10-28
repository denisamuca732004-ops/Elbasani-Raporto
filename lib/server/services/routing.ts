/**
 * Moving a report between departments and closing "not our department"
 * requests. Shared by the admin's edit form and the transfer decisions.
 */
import 'server-only';
import { publicStatusOf, type Status } from '@/lib/shared/domain';
import type { Tx } from '../db';

/** Statuses that belonged to the old department's work: the new department starts again from VERIFIED. */
const RESTART_STATUSES: readonly Status[] = ['ASSIGNED', 'IN_PROGRESS'];

type MovableReport = { id: string; status: Status; departmentId: number | null; verifiedAt: Date | null };

/**
 * Routes the report to another department (or to "no department" = the admin decides).
 * The old assignee is removed, because people only work inside their own department.
 */
export async function moveToDepartment(
  tx: Tx, report: MovableReport, toDepartmentId: number | null, actorId: string, message: string,
): Promise<{ previousStatus: Status; statusChanged: boolean }> {
  const previousStatus = report.status;
  const fromDepartmentId = report.departmentId;
  const restart = RESTART_STATUSES.includes(previousStatus);
  const nextStatus: Status = restart ? 'VERIFIED' : previousStatus;
  await tx.report.update({
    where: { id: report.id },
    data: {
      departmentId: toDepartmentId,
      assignedToId: null,
      status: nextStatus,
      ...(restart && !report.verifiedAt ? { verifiedAt: new Date() } : {}),
    },
  });
  const toDepartment = toDepartmentId ? await tx.department.findUnique({ where: { id: toDepartmentId } }) : null;
  await tx.reportEvent.create({
    data: {
      reportId: report.id,
      type: 'ROUTING_CHANGED',
      actorId,
      message: `${message} ${toDepartment ? `Sektori i ri: ${toDepartment.nameSq}.` : 'Pa sektor (e vendos administratori).'}`.trim(),
      meta: { fromDepartmentId, toDepartmentId },
    },
  });
  if (restart) {
    await tx.reportEvent.create({
      data: {
        reportId: report.id,
        type: 'STATUS_CHANGED',
        fromStatus: previousStatus,
        toStatus: nextStatus,
        actorId,
        isPublic: publicStatusOf(previousStatus) !== publicStatusOf(nextStatus),
        meta: { reason: 'department_changed' },
      },
    });
  }
  return { previousStatus, statusChanged: restart };
}

export type TransferOutcome =
  | { status: 'APPROVED'; toDepartmentId: number | null; note: string }
  | { status: 'DECLINED'; note: string };

/** Closes the open "not our department" request of a report, if there is one. */
export async function settlePendingTransfer(tx: Tx, reportId: string, actorId: string | null, outcome: TransferOutcome): Promise<string | null> {
  const pending = await tx.departmentTransfer.findFirst({ where: { reportId, status: 'PENDING' }, select: { id: true } });
  if (!pending) return null;
  // The condition on status makes this safe when two people act at the same moment.
  const updated = await tx.departmentTransfer.updateMany({
    where: { id: pending.id, status: 'PENDING' },
    data: {
      status: outcome.status,
      pendingReportId: null,
      toDepartmentId: outcome.status === 'APPROVED' ? outcome.toDepartmentId : null,
      decidedById: actorId,
      decidedAt: new Date(),
      decisionNote: outcome.note,
    },
  });
  if (updated.count === 0) return null;
  await tx.reportEvent.create({
    data: {
      reportId,
      type: outcome.status === 'APPROVED' ? 'TRANSFER_APPROVED' : 'TRANSFER_DECLINED',
      actorId,
      message: outcome.note,
      meta: { transferId: pending.id, automatic: true },
    },
  });
  return pending.id;
}
