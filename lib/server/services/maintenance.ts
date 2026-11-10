/**
 * Daily maintenance (Vercel Cron → /api/cron/daily):
 *  - close RESOLVED reports the resident never answered (AUTO_CLOSE_RESOLVED_DAYS);
 *  - email each department head, each department mailbox and each admin the
 *    list of overdue reports;
 *  - retry emails that failed and checks that were lost;
 *  - delete photo uploads that were never attached to a report;
 *  - delete the resident's contact CONTACT_RETENTION_DAYS (90) after a report is closed or rejected;
 *  - remind a sector of the reports it has not answered for 48 hours (not accepted, not sent back);
 *  - on Mondays, the weekly summary for the admins (weeklySummary.ts).
 */
import 'server-only';
import { OPEN_STATUSES, PRIORITY_RANK, type Priority } from '@/lib/shared/domain';
import { db } from '../db';
import { config } from '../env';
import { queueEmails, retryStuckEmails } from '../mail';
import { overdueDigest, sectorReminder } from '../mailTemplates';
import { enqueue } from '../queue';
import { cleanupTemporaryUploads } from '../storage';
import { maskContacts } from './mapper';
import { issueLink, linkUrl } from './reportLinks';
import { settlePendingTransfer } from './routing';
import { stuckPendingReports } from './triage';
import { weeklySummaryIfDue } from './weeklySummary';

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
    const email = department.email;
    const mine = [...items.filter((i) => i.departmentId === department.id)].sort(byPriorityThenDue).slice(0, 50);
    if (!mine.length || !email) continue;
    // A sector that works by e-mail gets each report's own link (sent again, so it keeps working).
    const listed = department.worksByEmail
      ? await Promise.all(mine.map(async (i) => ({ ...i, href: linkUrl(await issueLink(i.id, { id: department.id, email })) })))
      : mine;
    await queueEmails([email], overdueDigest({ name: department.nameSq, items: listed }));
    sent += 1;
  }
  return sent;
}

/**
 * The resident's name, phone and e-mail are kept only while they may be needed: they are deleted
 * CONTACT_RETENTION_DAYS after the report was closed (or rejected, counted from its last change).
 * The report itself stays, without them, for the statistics. Also removed: phone numbers and
 * e-mails typed in the description or the resident's comment, the e-mail of anyone who followed
 * the case, and the e-mails sent to those addresses. Done once per report (contactErasedAt).
 */
export async function eraseOldContacts(now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - config().rules.contactRetentionDays * 86_400_000);
  const due = await db.report.findMany({
    where: {
      contactErasedAt: null,
      OR: [{ status: 'CLOSED', closedAt: { lt: limit } }, { status: 'REJECTED', updatedAt: { lt: limit } }],
    },
    select: { id: true, contactEmail: true, description: true, citizenComment: true, followers: { select: { email: true } } },
    orderBy: { updatedAt: 'asc' },
    take: 500, // a large backlog is finished over the next days
  });
  let erased = 0;
  for (const r of due) {
    const addresses = [r.contactEmail, ...r.followers.map((f) => f.email)].filter((e): e is string => Boolean(e));
    await db.$transaction(async (tx) => {
      const updated = await tx.report.updateMany({
        // Only while it is still closed or rejected: a report reopened meanwhile keeps its contact.
        where: { id: r.id, contactErasedAt: null, status: { in: ['CLOSED', 'REJECTED'] } },
        data: {
          contactName: null, contactEmail: null, contactPhone: null, wantsUpdates: false, citizenTokenHash: null,
          description: maskContacts(r.description), citizenComment: maskContacts(r.citizenComment),
          contactErasedAt: now,
        },
      });
      if (updated.count === 0) return;
      erased += 1;
      await tx.reportFollower.updateMany({ where: { reportId: r.id, email: { not: null } }, data: { email: null } });
      if (addresses.length) await tx.emailLog.deleteMany({ where: { reportId: r.id, toAddress: { in: addresses } } });
    });
  }
  return erased;
}

/** After how long without an answer a sector is reminded of a report (again every 48 hours). */
export const REMIND_AFTER_HOURS = 48;

/**
 * Reports a sector received at least 48 hours ago and has neither accepted nor sent back: the sector
 * gets a reminder with the same link (once every 48 hours) and the admin sees "Pa përgjigje".
 */
export async function remindUnanswered(now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() - REMIND_AFTER_HOURS * 3_600_000);
  const links = await db.reportLink.findMany({
    where: {
      revokedAt: null, expiresAt: { gt: now }, sentAt: { lte: limit },
      OR: [{ remindedAt: null }, { remindedAt: { lte: limit } }],
      report: { isTest: false, status: { in: ['PENDING', 'NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED'] }, transfers: { none: { status: 'PENDING' } } },
    },
    include: {
      report: { select: { id: true, caseNumber: true, priority: true, departmentId: true, requestType: { select: { nameSq: true } } } },
      department: { select: { nameSq: true } },
    },
  });
  let reminded = 0;
  for (const link of links) {
    if (link.report.departmentId !== link.departmentId) continue;
    await queueEmails([link.email], sectorReminder({
      caseNumber: link.report.caseNumber, typeNameSq: link.report.requestType.nameSq, departmentNameSq: link.department.nameSq,
      sentAt: link.sentAt, priority: link.report.priority as Priority, link: linkUrl(link),
    }), link.report.id);
    await db.reportLink.update({ where: { id: link.id }, data: { remindedAt: now } });
    reminded++;
  }
  return reminded;
}

export async function runDaily(now = new Date()) {
  const closed = await autoCloseResolved(now);
  const erased = await eraseOldContacts(now);
  const digests = await sendOverdueDigests(now);
  const retried = await retryStuckEmails();
  const stuck = await stuckPendingReports();
  for (const reportId of stuck) await enqueue('triage', { reportId });
  const cleaned = await cleanupTemporaryUploads();
  const reminded = await remindUnanswered(now);
  let weekly = 0;
  try {
    weekly = await weeklySummaryIfDue(now);
  } catch (err) {
    console.error('[daily] weekly summary failed:', err instanceof Error ? err.message : err);
  }
  return { closed, erasedContacts: erased, sent: digests, retriedEmails: retried, rechecked: stuck.length, removedUploads: cleaned, remindedSectors: reminded, weeklySummary: weekly };
}
