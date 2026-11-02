/**
 * Links of the sectors that work by e-mail (Department.worksByEmail): one per report and
 * sector, sent in the report's e-mail, opening /sektori/<link> without an account.
 *
 * The address is "<id>.<signature>": the signature is an HMAC of the id with AUTH_SECRET, so
 * the same address can be sent again (reminders, "Dërgo përsëri") without storing it, and a
 * changed or guessed address is refused. A link stops working when it expires (LINK_DAYS),
 * when it is revoked (the report went to another sector), or when the report is no longer in
 * that sector.
 */
import 'server-only';
import crypto from 'node:crypto';
import { db, type Tx } from '../db';
import { config } from '../env';

/** How long a link works after it was last sent. */
export const LINK_DAYS = 90;
const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function signature(id: string): string {
  return crypto.createHmac('sha256', config().auth.secret).update(`report-link:v1:${id}`).digest('base64url');
}

export function linkToken(link: { id: string }): string {
  return `${link.id}.${signature(link.id)}`;
}

export function linkUrl(link: { id: string }): string {
  return `${config().appUrl}/sektori/${linkToken(link)}`;
}

/** The link id of a well-formed, correctly signed address; null otherwise (checked in constant time). */
export function linkIdOf(token: string): string | null {
  const [id, sig, extra] = String(token).split('.');
  if (!id || !sig || extra !== undefined || !UUID_RE.test(id)) return null;
  const expected = Buffer.from(signature(id));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? id : null;
}

export type LinkProblem = 'invalid' | 'expired' | 'revoked' | 'moved';

/** The link behind an address, or why it does not work (any more). */
export async function findLink(token: string, tx: Tx = db) {
  const id = linkIdOf(token);
  if (!id) return { problem: 'invalid' as const };
  const link = await tx.reportLink.findUnique({ where: { id }, include: { report: { select: { departmentId: true } } } });
  if (!link) return { problem: 'invalid' as const };
  if (link.revokedAt) return { problem: 'revoked' as const, link };
  if (link.report.departmentId !== link.departmentId) return { problem: 'moved' as const, link };
  if (link.expiresAt.getTime() < Date.now()) return { problem: 'expired' as const, link };
  return { problem: null, link };
}

/**
 * The working link of this report for this sector and address: the existing one (sent again, so it
 * lasts LINK_DAYS from now) or a new one. Links of the report for any OTHER sector are revoked.
 */
export async function issueLink(reportId: string, department: { id: number; email: string }, tx: Tx = db) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LINK_DAYS * DAY_MS);
  await revokeLinks(reportId, department.id, tx);
  const current = await tx.reportLink.findFirst({
    where: { reportId, departmentId: department.id, email: department.email, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (current) return tx.reportLink.update({ where: { id: current.id }, data: { sentAt: now, expiresAt } });
  // An older link to another address of the same sector stops working too.
  await tx.reportLink.updateMany({ where: { reportId, departmentId: department.id, revokedAt: null }, data: { revokedAt: now } });
  return tx.reportLink.create({ data: { reportId, departmentId: department.id, email: department.email, sentAt: now, expiresAt } });
}

/** The report left a sector (or went to the panel / to the admin): links of every other sector stop working. */
export async function revokeLinks(reportId: string, keepDepartmentId: number | null, tx: Tx = db) {
  await tx.reportLink.updateMany({
    where: { reportId, revokedAt: null, ...(keepDepartmentId ? { departmentId: { not: keepDepartmentId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/** The newest working link of a report (for the admin's report page and the reminders). */
export async function currentLink(reportId: string, departmentId: number | null) {
  if (!departmentId) return null;
  return db.reportLink.findFirst({
    where: { reportId, departmentId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}
