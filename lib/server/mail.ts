/**
 * Email. An email is first written to the email log as QUEUED (fast, inside
 * the request), then a background job ("deliver-email") sends it, so a slow
 * mail server never slows anyone down. With MAIL_DRIVER=log emails stay in
 * the log only (visible to the admin in "Emailet").
 */
import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { db } from './db';
import { config } from './env';
import type { MailContent } from './mailTemplates';
import { enqueue } from './queue';

let transporter: Transporter | null = null;
function smtp(): Transporter {
  if (!transporter) {
    const { host, port, secure, user, pass } = config().mail.smtp;
    transporter = nodemailer.createTransport({ host, port, secure, auth: user ? { user, pass } : undefined });
  }
  return transporter;
}

const MAX_ATTEMPTS = 5;

/**
 * Writes one email per address (duplicates removed) and schedules the delivery.
 * Returns the log ids. Never throws: an email problem must not undo the action.
 */
export async function queueEmails(recipients: Iterable<string | null | undefined>, mail: MailContent, reportId: string | null = null): Promise<string[]> {
  const unique = [...new Set([...recipients].map((r) => (r ?? '').trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) return [];
  try {
    const rows = await db.emailLog.createManyAndReturn({
      data: unique.map((toAddress) => ({ toAddress, subject: mail.subject.slice(0, 300), bodyText: mail.text, template: mail.template, reportId, status: 'QUEUED' as const })),
      select: { id: true },
    });
    const ids = rows.map((r) => String(r.id));
    await enqueue('deliver-email', { ids });
    return ids;
  } catch (err) {
    console.error('[mail] could not queue emails', err);
    return [];
  }
}

/** Background job: sends queued emails. Safe to run twice: each row is claimed before sending. */
export async function deliverEmails(ids: string[]): Promise<void> {
  const driver = config().mail.driver;
  const failures: string[] = [];
  for (const raw of ids) {
    const id = BigInt(raw);
    const claimed = await db.emailLog.updateMany({
      where: { id, status: { in: ['QUEUED', 'FAILED'] }, attempts: { lt: MAX_ATTEMPTS } },
      data: { status: 'SENDING', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue;
    const row = await db.emailLog.findUniqueOrThrow({ where: { id } });
    if (driver !== 'smtp') {
      await db.emailLog.update({ where: { id }, data: { status: 'LOGGED', sentAt: new Date() } });
      continue;
    }
    try {
      await smtp().sendMail({ from: config().mail.from, to: row.toAddress, subject: row.subject, text: row.bodyText });
      await db.emailLog.update({ where: { id }, data: { status: 'SENT', sentAt: new Date(), error: null } });
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err).slice(0, 1000);
      await db.emailLog.update({ where: { id }, data: { status: 'FAILED', error: message } });
      failures.push(raw);
    }
  }
  // QStash retries the job when it fails; rows already sent are skipped next time.
  if (failures.length) throw new Error(`Email delivery failed for ${failures.length} of ${ids.length} emails`);
}

/** Emails left in SENDING by a crashed job, or FAILED with attempts left: tried again by the daily job. */
export async function retryStuckEmails(): Promise<number> {
  const stuck = await db.emailLog.findMany({
    where: {
      OR: [
        { status: 'SENDING', createdAt: { lt: new Date(Date.now() - 15 * 60_000) } },
        { status: 'QUEUED', createdAt: { lt: new Date(Date.now() - 15 * 60_000) } },
        { status: 'FAILED', attempts: { lt: MAX_ATTEMPTS } },
      ],
    },
    select: { id: true },
    take: 200,
  });
  if (!stuck.length) return 0;
  await db.emailLog.updateMany({ where: { id: { in: stuck.map((s) => s.id) }, status: 'SENDING' }, data: { status: 'QUEUED' } });
  await enqueue('deliver-email', { ids: stuck.map((s) => String(s.id)) });
  return stuck.length;
}
