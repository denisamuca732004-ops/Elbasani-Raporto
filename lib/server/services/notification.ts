/**
 * Who gets which email. Emails are written to the log inside the request and
 * sent by the background job, so a slow mail server never slows anyone down.
 * Demo reports (isTest) never send emails.
 */
import 'server-only';
import { publicStatusOf, type Priority, type Status } from '@/lib/shared/domain';
import { db } from '../db';
import { queueEmails } from '../mail';
import * as tpl from '../mailTemplates';
import { issueLink, linkUrl, revokeLinks } from './reportLinks';

/** Residents who asked for updates: the reporter (with email) and people who followed the case. */
export async function citizenRecipients(r: { id: string; contactEmail: string | null; wantsUpdates: boolean }): Promise<string[]> {
  const followers = await db.reportFollower.findMany({ where: { reportId: r.id, email: { not: null } }, select: { email: true } });
  const emails = new Set(followers.map((f) => (f.email ?? '').toLowerCase()).filter(Boolean));
  if (r.contactEmail && r.wantsUpdates) emails.add(r.contactEmail.toLowerCase());
  return [...emails];
}

/** Active heads of a department, plus the department's shared mailbox if it has one. */
export async function departmentRecipients(departmentId: number): Promise<string[]> {
  const [heads, department] = await Promise.all([
    db.user.findMany({ where: { departmentId, role: 'MUNICIPALITY_STAFF', active: true }, select: { email: true } }),
    db.department.findUnique({ where: { id: departmentId }, select: { email: true } }),
  ]);
  const emails = heads.map((h) => h.email);
  if (department?.email) emails.push(department.email);
  return emails;
}

export async function adminRecipients(): Promise<string[]> {
  return (await db.user.findMany({ where: { role: 'ADMIN', active: true }, select: { email: true } })).map((a) => a.email);
}

/**
 * Tells residents when the simplified (public) status changes.
 * "Resolved" has its own email with the "was it fixed?" link.
 */
export async function notifyCitizenStatus(
  r: { id: string; caseNumber: string; contactEmail: string | null; wantsUpdates: boolean; isTest: boolean },
  previousStatus: Status, status: Status, note: string | null,
): Promise<void> {
  if (r.isTest) return;
  if (publicStatusOf(previousStatus) === publicStatusOf(status)) return;
  if (status === 'RESOLVED') return;
  const mail = tpl.statusChanged({ caseNumber: r.caseNumber, publicStatus: publicStatusOf(status), note });
  await queueEmails(await citizenRecipients(r), mail, r.id);
}

/**
 * A report arrived in a department (new, moved after review, or re-routed by the admin). The report
 * links of any other sector stop working. A sector that works by e-mail gets the whole report with
 * its link (sendReportToSector); the others get the panel notice.
 */
export async function notifyDepartmentOfReport(reportId: string, reason: tpl.DepartmentReportReason): Promise<void> {
  const r = await db.report.findUnique({
    where: { id: reportId },
    select: {
      id: true, caseNumber: true, isTest: true, departmentId: true, priority: true, address: true,
      requestType: { select: { nameSq: true } }, department: { select: { nameSq: true, email: true, worksByEmail: true } },
    },
  });
  if (!r) return;
  await revokeLinks(r.id, r.department?.worksByEmail ? r.departmentId : null);
  if (r.isTest) return;
  if (r.department?.worksByEmail && r.department.email) {
    await sendReportToSector(r.id, reason);
    return;
  }
  // A sector without an e-mail address gets nothing: the report waits at the admin's "Të reja" (board).
  const recipients = r.departmentId ? await departmentRecipients(r.departmentId) : await adminRecipients();
  const mail = tpl.departmentNewReport({
    caseNumber: r.caseNumber,
    reportId: r.id,
    typeNameSq: r.requestType.nameSq,
    departmentNameSq: r.department?.nameSq ?? 'Pa sektor – duhet drejtuar nga administratori',
    priority: r.priority as Priority,
    address: r.address,
    reason,
  });
  await queueEmails(recipients, mail, r.id);
}

/**
 * A sector that works by e-mail: the whole report (type, priority, deadline, place with a map link,
 * description, the resident's name and phone) and the link where it changes the status or asks for a
 * review, to the sector's address. Returns the link, or null when the sector does not work by e-mail.
 * The admin can send it again ("resend"), also for a demo report.
 */
export async function sendReportToSector(reportId: string, reason: tpl.DepartmentReportReason) {
  const r = await db.report.findUnique({
    where: { id: reportId },
    include: {
      requestType: { select: { nameSq: true } }, category: { select: { nameSq: true } }, neighbourhood: { select: { name: true } },
      department: { select: { id: true, nameSq: true, email: true, worksByEmail: true } },
    },
  });
  const department = r?.department;
  if (!r || !department?.worksByEmail || !department.email) return null;
  const link = await issueLink(r.id, { id: department.id, email: department.email });
  const mail = tpl.sectorReport({
    caseNumber: r.caseNumber,
    typeNameSq: r.requestType.nameSq,
    categoryNameSq: r.category.nameSq,
    departmentNameSq: department.nameSq,
    priority: r.priority as Priority,
    dueAt: r.dueAt,
    address: r.address,
    zone: r.neighbourhood?.name ?? null,
    latitude: r.latitude,
    longitude: r.longitude,
    approximate: r.locationApproximate,
    description: r.description,
    contact: r.anonymous ? null : { name: r.contactName, phone: r.contactPhone },
    reason,
    link: linkUrl(link),
    linkExpires: link.expiresAt,
  });
  await queueEmails([department.email], mail, r.id);
  return link;
}
