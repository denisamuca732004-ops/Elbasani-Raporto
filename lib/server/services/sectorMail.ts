/** The e-mails a sector gets about a report (the report itself and the reminders), and whether they really left. */
import 'server-only';
import type { SectorMailStatus } from '@/lib/shared/types';

export const SECTOR_TEMPLATES = ['sector_report', 'sector_reminder'] as const;

/** LOGGED = written down only (MAIL_DRIVER is not smtp), SENT = handed to the SMTP server, FAILED = refused. */
export function mailStatusOf(m: { status: SectorMailStatus['status']; createdAt: Date; sentAt: Date | null; error: string | null } | undefined): SectorMailStatus | null {
  return m ? { status: m.status, at: (m.sentAt ?? m.createdAt).toISOString(), error: m.error } : null;
}
