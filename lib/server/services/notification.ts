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

/** A report arrived in a department (new, moved after review, or re-routed by the admin). */
export async function notifyDepartmentOfReport(reportId: string, reason: tpl.DepartmentReportReason): Promise<void> {
  const r = await db.report.findUnique({
    where: { id: reportId },
    select: {
      id: true, caseNumber: true, isTest: true, departmentId: true, priority: true, address: true,
      requestType: { select: { nameSq: true } }, department: { select: { nameSq: true } },
    },
  });
  if (!r || r.isTest) return;
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
