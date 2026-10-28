/**
 * Daily maintenance (Vercel Cron → /api/cron/daily):
 *  - close RESOLVED reports the resident never answered (AUTO_CLOSE_RESOLVED_DAYS);
 *  - email each department head, each department mailbox and each admin the
 *    list of overdue reports;
 *  - retry emails that failed and checks that were lost;
 *  - delete photo uploads that were never attached to a report.
 */
import 'server-only';
import { OPEN_STATUSES, PRIORITY_RANK, type Priority } from '@/lib/shared/domain';
import { db } from '../db';
import { config } from '../env';
import { queueEmails, retryStuckEmails } from '../mail';
import { overdueDigest } from '../mailTemplates';
import { enqueue } from '../queue';
import { cleanupTemporaryUploads } from '../storage';
import { settlePendingTransfer } from './routing';
import { stuckPendingReports } from './triage';

export async function autoCloseResolved(now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - config().rules.autoCloseResolvedDays * 86_400_000);
  const stale = await db.report.findMany({ where: { status: 'RESOLVED', resolvedAt: { lt: limit } }, select: { id: true } });
  let closed = 0;
  for (const { id } of stale) {
    await db.$transaction(async (tx) => {
      const updated = await tx.report.updateMany({ where: { id, status: 'RESOLVED' }, data: { status: 'CLOSED', closedAt: now, citizenTokenHash: null } });
      if (updated.count === 0) return;
      closed += 1;
      await tx.reportEvent.create({
        data: {
          reportId: id, type: 'STATUS_CHANGED', fromStatus: 'RESOLVED', toStatus: 'CLOSED', isPublic: true,
          message: 'Mbyllur automatikisht pasi qytetari nuk e rihapi brenda afatit.',
        },
      });
      await settlePendingTransfer(tx, id, null, { status: 'DECLINED', note: 'Kërkesa u mbyll automatikisht sepse raportimi u mbyll.' });
    });
  }
  return closed;
}

export async function sendOverdueDigests(now = new Date()): Promise<number> {
  const overdue = await db.report.findMany({
    where: { status: { in: [...OPEN_STATUSES] }, dueAt: { lt: now }, isTest: false },
    select: { id: true, caseNumber: true, dueAt: true, priority: true, departmentId: true, requestType: { select: { nameSq: true } } },
    orderBy: { dueAt: 'asc' },
  });
  if (!overdue.length) return 0;
  const items = overdue.map((r) => ({
    id: r.id, caseNumber: r.caseNumber, typeNameSq: r.requestType.nameSq, dueAt: r.dueAt as Date,
    priority: r.priority as Priority, departmentId: r.departmentId,
  }));
  const byPriorityThenDue = (a: (typeof items)[number], b: (typeof items)[number]) =>
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.dueAt.getTime() - b.dueAt.getTime();

  let sent = 0;
  const people = await db.user.findMany({ where: { active: true, role: { in: ['ADMIN', 'MUNICIPALITY_STAFF'] } } });
  for (const person of people) {
    const mine = person.role === 'ADMIN' ? items : items.filter((i) => i.departmentId !== null && i.departmentId === person.departmentId);
    if (!mine.length) continue;
    await queueEmails([person.email], overdueDigest({ name: person.name, items: [...mine].sort(byPriorityThenDue).slice(0, 50) }));
    sent += 1;
  }
  const departments = await db.department.findMany({ where: { active: true, email: { not: null } } });
  for (const department of departments) {
    const mine = items.filter((i) => i.departmentId === department.id);
    if (!mine.length || !department.email) continue;
    await queueEmails([department.email], overdueDigest({ name: department.nameSq, items: [...mine].sort(byPriorityThenDue).slice(0, 50) }));
    sent += 1;
  }
  return sent;
}

export async function runDaily(now = new Date()) {
  const closed = await autoCloseResolved(now);
  const digests = await sendOverdueDigests(now);
  const retried = await retryStuckEmails();
  const stuck = await stuckPendingReports();
  for (const reportId of stuck) await enqueue('triage', { reportId });
  const cleaned = await cleanupTemporaryUploads();
  return { closed, sent: digests, retriedEmails: retried, rechecked: stuck.length, removedUploads: cleaned };
}
