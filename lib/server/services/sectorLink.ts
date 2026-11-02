/**
 * What a sector that works by e-mail sees and does from its report link (/sektori/<link>),
 * without an account:
 *  - the whole report: problem, priority, deadline, place, description, photos, the resident's
 *    name and phone (internal staff only, never public), its public history;
 *  - "Po merremi"        → IN_PROGRESS (optional note for the resident);
 *  - "U zgjidh"          → RESOLVED with a note for the resident and, optionally, an "after" photo;
 *  - "Nuk është për ne"  → a review request to the admin with the reason (and the sector it may
 *                          belong to), exactly like the panel's "Kërkesat për rishikim".
 * Every change is written in the history as done "from the sector's e-mail" (meta.via), and the
 * resident sees it at "Ndiq raportimin". The link must be valid, unexpired, not revoked and the
 * report still in that sector (reportLinks.findLink).
 */
import 'server-only';
import { FINAL_STATUSES, OPEN_STATUSES, publicStatusOf, type Priority, type PublicStatus, type Status } from '@/lib/shared/domain';
import type { PublicTimelineItem } from '@/lib/shared/types';
import type { TransferRequestInput } from '@/lib/validation/report';
import { Prisma, db } from '../db';
import { AppError, badRequest, conflict, notFound } from '../errors';
import { queueEmails } from '../mail';
import * as tpl from '../mailTemplates';
import { publicTimeline } from './mapper';
import { adminRecipients, notifyCitizenStatus } from './notification';
import { findLink, linkToken, type LinkProblem } from './reportLinks';
import { applyStatus, loadReport, resolveAs } from './report';

const GONE: Record<LinkProblem, string> = {
  invalid: 'Kjo lidhje nuk është e saktë. Hapeni nga emaili që morët.',
  expired: 'Kjo lidhje ka skaduar. Kërkojini administratorit t’jua dërgojë përsëri raportimin.',
  revoked: 'Ky raportim nuk është më te sektori juaj, ndaj lidhja nuk vlen më.',
  moved: 'Ky raportim nuk është më te sektori juaj, ndaj lidhja nuk vlen më.',
};

export interface SectorReportView {
  token: string;
  caseNumber: string;
  status: Status;
  publicStatus: PublicStatus;
  final: boolean;
  departmentSq: string;
  departmentId: number;
  categorySq: string;
  categoryIcon: string;
  typeSq: string;
  priority: Priority;
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
  address: string | null;
  zone: string | null;
  latitude: number | null;
  longitude: number | null;
  approximate: boolean;
  description: string | null;
  contact: { name: string | null; phone: string | null } | null;
  photos: Array<{ id: string; kind: 'BEFORE' | 'AFTER'; url: string }>;
  closingNote: string | null;
  rejectionReason: string | null;
  timeline: PublicTimelineItem[];
  pendingReview: { reason: string; at: string } | null;
  lastDecision: { approved: boolean; note: string | null; at: string } | null;
  /** The other active sectors, for "it belongs to…". */
  departments: Array<{ id: number; nameSq: string }>;
  linkExpires: string;
}

export type SectorLookup = { ok: true; view: SectorReportView } | { ok: false; problem: LinkProblem; message: string };

/** A working link, its report and the sector; throws 410 with the reason otherwise. */
async function useLink(token: string) {
  const found = await findLink(token);
  if (found.problem) throw new AppError(410, 'LINK_GONE', GONE[found.problem]);
  const link = found.link;
  const report = await loadReport(link.reportId);
  return { link, report };
}

const via = (email: string): Prisma.InputJsonValue => ({ via: 'sector_link', email });

/**
 * The report as its sector sees it. countOpen: the sector itself opened the page (not a signed-in
 * staff member checking it from the panel), so the admin's report page shows when it was last opened.
 */
export async function sectorView(token: string, opts: { countOpen?: boolean } = {}): Promise<SectorLookup> {
  const found = await findLink(token);
  if (found.problem) return { ok: false, problem: found.problem, message: GONE[found.problem] };
  const link = found.link;
  if (opts.countOpen) await markOpened(link.id);
  const [report, events, departments, transfers] = await Promise.all([
    db.report.findUnique({
      where: { id: link.reportId },
      include: {
        requestType: { select: { nameSq: true } }, category: { select: { nameSq: true, icon: true } }, neighbourhood: { select: { name: true } },
        department: { select: { id: true, nameSq: true } }, attachments: { select: { id: true, kind: true }, orderBy: { createdAt: 'asc' } },
      },
    }),
    db.reportEvent.findMany({
      where: { reportId: link.reportId, isPublic: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { type: true, toStatus: true, message: true, isPublic: true, createdAt: true },
    }),
    db.department.findMany({ where: { active: true, id: { not: link.departmentId } }, select: { id: true, nameSq: true }, orderBy: { nameSq: 'asc' } }),
    db.departmentTransfer.findMany({ where: { reportId: link.reportId, fromDepartmentId: link.departmentId }, orderBy: { createdAt: 'desc' }, take: 1 }),
  ]);
  if (!report || !report.department) return { ok: false, problem: 'moved', message: GONE.moved };
  const t = transfers[0];
  const status = report.status as Status;
  return {
    ok: true,
    view: {
      token: linkToken(link),
      caseNumber: report.caseNumber,
      status,
      publicStatus: publicStatusOf(status),
      final: FINAL_STATUSES.includes(status) || status === 'RESOLVED',
      departmentSq: report.department.nameSq,
      departmentId: report.department.id,
      categorySq: report.category.nameSq,
      categoryIcon: report.category.icon,
      typeSq: report.requestType.nameSq,
      priority: report.priority as Priority,
      dueAt: report.dueAt?.toISOString() ?? null,
      overdue: Boolean(report.dueAt && report.dueAt.getTime() < Date.now() && OPEN_STATUSES.includes(status)),
      createdAt: report.createdAt.toISOString(),
      address: report.address,
      zone: report.neighbourhood?.name ?? null,
      latitude: report.latitude,
      longitude: report.longitude,
      approximate: report.locationApproximate,
      description: report.description,
      contact: report.anonymous ? null : { name: report.contactName, phone: report.contactPhone },
      photos: report.attachments.map((a) => ({ id: a.id, kind: a.kind, url: `/api/sektori/${linkToken(link)}/photos/${a.id}` })),
      closingNote: report.closingNote,
      rejectionReason: report.rejectionReason,
      timeline: publicTimeline(events),
      pendingReview: t?.status === 'PENDING' ? { reason: t.reason, at: t.createdAt.toISOString() } : null,
      lastDecision: t && t.status !== 'PENDING' ? { approved: t.status === 'APPROVED', note: t.decisionNote, at: (t.decidedAt ?? t.updatedAt).toISOString() } : null,
      departments,
      linkExpires: link.expiresAt.toISOString(),
    },
  };
}

/** A photo of the report, for its sector's link only. */
export async function sectorPhoto(token: string, attachmentId: string) {
  const { link } = await useLink(token);
  const photo = await db.attachment.findFirst({ where: { id: attachmentId, reportId: link.reportId } });
  if (!photo) throw notFound('Fotoja nuk u gjet.');
  return photo;
}

const touch = (linkId: string) => db.reportLink.update({ where: { id: linkId }, data: { lastUsedAt: new Date() } });

/** Opening the page counts as using the link (at most once a minute; a failure never stops the page). */
async function markOpened(linkId: string): Promise<void> {
  const now = new Date();
  try {
    await db.reportLink.updateMany({
      where: { id: linkId, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } }] },
      data: { lastUsedAt: now },
    });
  } catch (err) {
    console.error('[sector] could not record the opening', err);
  }
}

/** "Po merremi": the sector takes the report into work. */
export async function sectorStart(token: string, input: { note?: string | null }): Promise<void> {
  const { link, report } = await useLink(token);
  const status = report.status as Status;
  if (status === 'IN_PROGRESS') return;
  if (!['PENDING', 'NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED'].includes(status)) throw conflict('Ky raportim nuk mund të merret në punë në këtë status.');
  const note = input.note?.trim() || null;
  await db.$transaction((tx) => applyStatus(tx, { id: null }, report, 'IN_PROGRESS', {
    note, publicNote: true, meta: via(link.email), extra: { verifiedAt: report.verifiedAt ?? new Date() },
  }));
  await touch(link.id);
  await notifyCitizenStatus(report, status, 'IN_PROGRESS', note);
}

/** "U zgjidh": with a note for the resident and, optionally, an "after" photo. */
export async function sectorResolve(token: string, input: { note: string; photoKey?: string }): Promise<void> {
  const { link, report } = await useLink(token);
  const status = report.status as Status;
  if (!OPEN_STATUSES.includes(status)) throw conflict('Ky raportim është zgjidhur ose mbyllur tashmë.');
  await resolveAs({ id: null }, report, input, { meta: via(link.email), extra: { verifiedAt: report.verifiedAt ?? new Date() } });
  await touch(link.id);
}

/** "Nuk është për ne": a review request to the admin, as from the panel (one open request per report). */
export async function sectorRequestReview(token: string, input: TransferRequestInput): Promise<void> {
  const { link, report } = await useLink(token);
  if (FINAL_STATUSES.includes(report.status as Status)) throw conflict('Raportimi është mbyllur.');
  const from = await db.department.findUniqueOrThrow({ where: { id: link.departmentId } });
  let suggested: { id: number; nameSq: string } | null = null;
  if (input.suggestedDepartmentId) {
    suggested = await db.department.findFirst({ where: { id: input.suggestedDepartmentId, active: true }, select: { id: true, nameSq: true } });
    if (!suggested) throw badRequest('Ky sektor nuk ekziston ose është çaktivizuar.', [{ field: 'suggestedDepartmentId', code: 'unknown', message: 'Zgjidhni një sektor nga lista.' }]);
    if (suggested.id === from.id) throw badRequest('Sugjeroni një sektor tjetër nga i juaji.', [{ field: 'suggestedDepartmentId', code: 'same_department', message: 'Sugjeroni një sektor tjetër nga i juaji.' }]);
  }
  try {
    await db.$transaction(async (tx) => {
      const created = await tx.departmentTransfer.create({
        data: {
          reportId: report.id, pendingReportId: report.id, fromDepartmentId: from.id, suggestedDepartmentId: suggested?.id ?? null,
          reason: input.reason, requestedById: null, requestedByEmail: link.email,
        },
      });
      await tx.reportEvent.create({
        data: {
          reportId: report.id, type: 'TRANSFER_REQUESTED', actorId: null,
          message: `Nuk i përket sektorit ${from.nameSq}. Arsyeja: ${input.reason}`.replace(/\s+/g, ' '),
          meta: { transferId: created.id, fromDepartmentId: from.id, suggestedDepartmentId: suggested?.id ?? null, via: 'sector_link', email: link.email },
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('Kërkesa për rishikim është dërguar tashmë dhe pret vendimin e administratorit.');
    }
    throw err;
  }
  await touch(link.id);
  if (!report.isTest) {
    await queueEmails(await adminRecipients(), tpl.transferRequested({
      caseNumber: report.caseNumber, reportId: report.id, fromDepartmentSq: from.nameSq,
      suggestedDepartmentSq: suggested?.nameSq ?? null, reason: input.reason, requestedByName: `Sektori me email (${link.email})`,
    }), report.id);
  }
}
