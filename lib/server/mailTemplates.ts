/**
 * Plain-text email templates. Albanian first, a short English line after
 * (citizen emails), because some residents prefer English.
 * Staff emails are in Albanian only.
 */
import 'server-only';
import type { Priority, PublicStatus } from '@/lib/shared/domain';
import { config } from './env';

export interface MailContent { template: string; subject: string; text: string }

const STATUS_SQ: Record<PublicStatus, string> = {
  RECEIVED: 'Marrë', OPEN: 'Hapur', IN_PROGRESS: 'Në punë', RESOLVED: 'Zgjidhur', CLOSED: 'Mbyllur', REJECTED: 'Refuzuar',
};
const STATUS_EN: Record<PublicStatus, string> = {
  RECEIVED: 'Received', OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed', REJECTED: 'Rejected',
};
export const PRIORITY_SQ: Record<Priority, string> = { LOW: 'E ulët', MEDIUM: 'Mesatare', HIGH: 'E lartë' };

const footer = (): string =>
  `\n—\nElbasani Raporton · Bashkia Elbasan\n${config().appUrl}\nKy është një email automatik. / This is an automatic email.`;
const staffFooter = (): string => `\n—\nElbasani Raporton · Bashkia Elbasan\nKy është një email automatik.`;

export const trackUrl = (caseNumber: string): string => `${config().appUrl}/ndiq/${encodeURIComponent(caseNumber)}`;
/** Opens the report in the panel (after logging in, if needed). */
export const staffCaseUrl = (id: string): string => `${config().appUrl}/admin/reports/${id}`;
export const staffReviewsUrl = (): string => `${config().appUrl}/admin/transfers`;
export const loginUrl = (): string => `${config().appUrl}/hyrje`;
export const feedbackUrl = (token: string): string => `${config().appUrl}/konfirmo/${token}`;

/* ── Citizen emails ── */

export function requestReceived(p: { caseNumber: string; typeNameSq: string; typeNameEn: string }): MailContent {
  return {
    template: 'request_received',
    subject: `Raportimi juaj ${p.caseNumber} u mor / Your report was received`,
    text: `Faleminderit! Raportimi juaj "${p.typeNameSq}" u regjistrua me numrin ${p.caseNumber}.
Mund ta ndiqni në çdo kohë këtu: ${trackUrl(p.caseNumber)}

Thank you! Your report "${p.typeNameEn}" was registered as ${p.caseNumber}. Track it here: ${trackUrl(p.caseNumber)}
${footer()}`,
  };
}

export function statusChanged(p: { caseNumber: string; publicStatus: PublicStatus; note?: string | null }): MailContent {
  const noteSq = p.note ? `\nShënim nga Bashkia: ${p.note}\n` : '';
  return {
    template: 'status_changed',
    subject: `${p.caseNumber}: ${STATUS_SQ[p.publicStatus]} / ${STATUS_EN[p.publicStatus]}`,
    text: `Statusi i raportimit ${p.caseNumber} tani është: ${STATUS_SQ[p.publicStatus]}.${noteSq}
Shikoni detajet: ${trackUrl(p.caseNumber)}

The status of ${p.caseNumber} is now: ${STATUS_EN[p.publicStatus]}. Details: ${trackUrl(p.caseNumber)}
${footer()}`,
  };
}

export function resolvedConfirm(p: { caseNumber: string; note?: string | null; feedbackUrl: string }): MailContent {
  return {
    template: 'resolved_confirm',
    subject: `${p.caseNumber} u zgjidh – a është rregulluar? / Was it fixed?`,
    text: `Bashkia shënoi se raportimi ${p.caseNumber} u zgjidh.${p.note ? `\nShënim: ${p.note}` : ''}

A është rregulluar vërtet? Konfirmoni ose rihapeni raportimin dhe vlerësoni shërbimin (1–5):
${p.feedbackUrl}

The municipality marked ${p.caseNumber} as resolved. Please confirm it was fixed or reopen it, and rate the service: ${p.feedbackUrl}
${footer()}`,
  };
}

export function messageToCitizen(p: { caseNumber: string; message: string }): MailContent {
  return {
    template: 'message_to_citizen',
    subject: `${p.caseNumber}: mesazh nga Bashkia Elbasan / Message from the municipality`,
    text: `Për raportimin tuaj ${p.caseNumber}, Bashkia Elbasan shkruan:

"${p.message}"

Mund të përgjigjeni duke telefonuar ose duke ardhur në Zyrën e Shërbimit ndaj Qytetarit dhe duke përmendur numrin ${p.caseNumber}.
Ndiqni raportimin: ${trackUrl(p.caseNumber)}
${footer()}`,
  };
}

/* ── Staff emails ── */

export type DepartmentReportReason = 'new' | 'transferred' | 'rerouted';

export function departmentNewReport(p: {
  caseNumber: string; reportId: string; typeNameSq: string; departmentNameSq: string; priority: Priority;
  address: string | null; reason: DepartmentReportReason;
}): MailContent {
  const why = {
    new: 'Një raportim i ri u drejtua automatikisht te sektori juaj.',
    transferred: 'Administratori e kaloi këtë raportim te sektori juaj pas rishikimit.',
    rerouted: 'Administratori e drejtoi këtë raportim te sektori juaj.',
  }[p.reason];
  return {
    template: 'department_new_report',
    subject: `${p.priority === 'HIGH' ? '[PRIORITET I LARTË] ' : ''}Raportim i ri ${p.caseNumber} – ${p.typeNameSq}`,
    text: `${why}

Numri: ${p.caseNumber}
Lloji: ${p.typeNameSq}
Sektori: ${p.departmentNameSq}
Prioriteti: ${PRIORITY_SQ[p.priority]}
Adresa: ${p.address || '—'}

Hapeni në panel: ${staffCaseUrl(p.reportId)}
${staffFooter()}`,
  };
}

export function staffAssigned(p: { caseNumber: string; typeNameSq: string; reportId: string; assigneeName: string }): MailContent {
  return {
    template: 'staff_assigned',
    subject: `Ju u caktua raportimi ${p.caseNumber}`,
    text: `Përshëndetje ${p.assigneeName},

Ju është caktuar raportimi ${p.caseNumber} (${p.typeNameSq}).
Hapeni në panel: ${staffCaseUrl(p.reportId)}
${staffFooter()}`,
  };
}

export function staffReopened(p: { caseNumber: string; reportId: string; comment?: string | null }): MailContent {
  return {
    template: 'staff_reopened',
    subject: `Qytetari rihapi raportimin ${p.caseNumber}`,
    text: `Qytetari konfirmoi se problemi ${p.caseNumber} NUK është rregulluar dhe e rihapi raportimin.${p.comment ? `\nKoment: "${p.comment}"` : ''}
Hapeni në panel: ${staffCaseUrl(p.reportId)}
${staffFooter()}`,
  };
}

export function transferRequested(p: {
  caseNumber: string; reportId: string; fromDepartmentSq: string; suggestedDepartmentSq: string | null; reason: string; requestedByName: string;
}): MailContent {
  return {
    template: 'transfer_requested',
    subject: `Kërkesë për rishikim: ${p.caseNumber} nuk i përket sektorit ${p.fromDepartmentSq}`,
    text: `${p.requestedByName} (${p.fromDepartmentSq}) njofton se raportimi ${p.caseNumber} nuk i përket sektorit të tyre.

Arsyeja: "${p.reason}"
Sektori i sugjeruar: ${p.suggestedDepartmentSq || 'nuk u sugjerua'}

Vendosni te cili sektor duhet të shkojë: ${staffReviewsUrl()}
Raportimi: ${staffCaseUrl(p.reportId)}
${staffFooter()}`,
  };
}

export function transferDecided(p: {
  caseNumber: string; reportId: string; approved: boolean; toDepartmentSq: string | null; note: string | null; name: string;
}): MailContent {
  const body = p.approved
    ? `Administratori e pranoi kërkesën tuaj. Raportimi ${p.caseNumber} kaloi te: ${p.toDepartmentSq}.`
    : `Administratori e refuzoi kërkesën tuaj. Raportimi ${p.caseNumber} mbetet te sektori juaj.`;
  return {
    template: p.approved ? 'transfer_approved' : 'transfer_declined',
    subject: `${p.caseNumber}: kërkesa për rishikim u ${p.approved ? 'pranua' : 'refuzua'}`,
    text: `Përshëndetje ${p.name},

${body}${p.note ? `\nShënim nga administratori: "${p.note}"` : ''}

Raportimi: ${staffCaseUrl(p.reportId)}
${staffFooter()}`,
  };
}

export function accountCreated(p: { name: string; email: string; roleLabel: string; departmentNameSq: string | null }): MailContent {
  return {
    template: 'account_created',
    subject: 'Llogaria juaj në Elbasani Raporton',
    text: `Përshëndetje ${p.name},

Administratori i Bashkisë Elbasan ju krijoi një llogari në panelin e Elbasani Raporton.
Roli: ${p.roleLabel}${p.departmentNameSq ? `\nSektori: ${p.departmentNameSq}` : ''}
Emaili për hyrje: ${p.email}

Fjalëkalimin e përkohshëm jua jep administratori personalisht. Në hyrjen e parë
sistemi do t'ju kërkojë ta ndryshoni.
Hyrja: ${loginUrl()}
${staffFooter()}`,
  };
}

export function passwordReset(p: { name: string }): MailContent {
  return {
    template: 'password_reset',
    subject: 'Fjalëkalimi juaj u rivendos – Elbasani Raporton',
    text: `Përshëndetje ${p.name},

Administratori rivendosi fjalëkalimin e llogarisë suaj. Fjalëkalimin e ri të përkohshëm
jua jep administratori personalisht. Në hyrjen e radhës do t'ju kërkohet ta ndryshoni.
Nëse nuk e keni kërkuar këtë, njoftoni menjëherë administratorin.
Hyrja: ${loginUrl()}
${staffFooter()}`,
  };
}

export function overdueDigest(p: {
  name: string; items: Array<{ id: string; caseNumber: string; typeNameSq: string; dueAt: Date; priority: Priority }>;
}): MailContent {
  const lines = p.items
    .map((r) => `• ${r.caseNumber} – ${r.typeNameSq} – prioriteti ${PRIORITY_SQ[r.priority].toLowerCase()} – afati ${r.dueAt.toISOString().slice(0, 10)} – ${staffCaseUrl(r.id)}`)
    .join('\n');
  return {
    template: 'overdue_digest',
    subject: p.items.length === 1 ? '1 raportim me afat të kaluar' : `${p.items.length} raportime me afat të kaluar`,
    text: `Përshëndetje ${p.name},

${p.items.length === 1 ? 'Ky raportim e ka kaluar afatin dhe nuk është zgjidhur ende:' : 'Këto raportime e kanë kaluar afatin dhe nuk janë zgjidhur ende:'}
${lines}
${staffFooter()}`,
  };
}
