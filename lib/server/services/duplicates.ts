/**
 * The same problem reported by several people.
 *
 * 1. While reporting, the resident already sees open reports of the same kind close by and can
 *    "support" one instead (publicReport.findNearbyOpen / followReport).
 * 2. If a new report still looks like one of them (same type of problem, open, within
 *    DUPLICATE_RADIUS_METERS, or the same street in the same zone when the place was typed), it is
 *    NOT e-mailed to the sector: it waits in the admin's "Të reja" with "Mund të jetë i njëjti
 *    problem si EL-…".
 * 3. The admin either merges it (it closes and points to the first report; the reporter follows the
 *    first report and counts as one more supporter) or says it is different (it goes to the sector).
 */
import 'server-only';
import { FINAL_STATUSES, OPEN_STATUSES } from '@/lib/shared/domain';
import type { Principal } from '@/lib/shared/types';
import { db } from '../db';
import { config } from '../env';
import { badRequest, conflict, notFound } from '../errors';
import { assertAdmin } from './access';
import { boundingBox, distanceMeters } from './geo';
import { notifyCitizenStatus, notifyDepartmentOfReport } from './notification';
import { revokeLinks } from './reportLinks';

/** Only reports from the last weeks count: an old open report is more likely a different problem. */
const LOOKBACK_DAYS = 60;

/** Lower case, no accents, no punctuation: "Rr. Qemal Stafa" ~ "rruga qemal stafa" is not enough, but "Qemal Stafa 12" = "qemal stafa 12". */
function plainAddress(s: string | null): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The open report a new one most probably repeats, or null. */
export async function findLikelyDuplicate(reportId: string): Promise<{ id: string; caseNumber: string; meters: number | null } | null> {
  const r = await db.report.findUnique({
    where: { id: reportId },
    select: { id: true, requestTypeId: true, latitude: true, longitude: true, locationApproximate: true, neighbourhoodId: true, address: true, isTest: true, createdAt: true },
  });
  if (!r) return null;
  const base = {
    id: { not: r.id },
    requestTypeId: r.requestTypeId,
    status: { in: [...OPEN_STATUSES] },
    isTest: r.isTest,
    mergedIntoId: null,
    possibleDuplicateOfId: null,
    createdAt: { lt: r.createdAt, gte: new Date(r.createdAt.getTime() - LOOKBACK_DAYS * 86_400_000) },
  };
  // A pin on the map: the same type of problem within the radius.
  if (!r.locationApproximate && r.latitude !== null && r.longitude !== null) {
    const radius = config().rules.duplicateRadiusMeters;
    const box = boundingBox(r.latitude, r.longitude, radius);
    const near = await db.report.findMany({
      where: { ...base, locationApproximate: false, latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLng, lte: box.maxLng } },
      select: { id: true, caseNumber: true, latitude: true, longitude: true },
      take: 50,
    });
    const best = near
      .map((c) => ({ ...c, meters: Math.round(distanceMeters(r.latitude!, r.longitude!, c.latitude ?? 0, c.longitude ?? 0)) }))
      .filter((c) => c.meters <= radius)
      .sort((a, b) => a.meters - b.meters)[0];
    if (best) return { id: best.id, caseNumber: best.caseNumber, meters: best.meters };
  }
  // A typed place: the same type of problem, in the same zone, at the same address.
  const address = plainAddress(r.address);
  if (r.locationApproximate && address.length >= 5 && r.neighbourhoodId) {
    const same = await db.report.findMany({ where: { ...base, neighbourhoodId: r.neighbourhoodId, address: { not: null } }, select: { id: true, caseNumber: true, address: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    const hit = same.find((c) => plainAddress(c.address) === address);
    if (hit) return { id: hit.id, caseNumber: hit.caseNumber, meters: null };
  }
  return null;
}

/**
 * A new report that passed the check: if it repeats an open one, keep it for the admin (true);
 * otherwise false, and the caller sends it to the sector as usual.
 */
export async function holdIfDuplicate(reportId: string): Promise<boolean> {
  if (!config().rules.holdDuplicates) return false;
  const match = await findLikelyDuplicate(reportId);
  if (!match) return false;
  await db.$transaction([
    db.report.update({ where: { id: reportId }, data: { possibleDuplicateOfId: match.id } }),
    db.reportEvent.create({
      data: {
        reportId, type: 'DUPLICATE_SUSPECTED',
        message: `Mund të jetë i njëjti problem si ${match.caseNumber}${match.meters !== null ? ` (${match.meters} m larg)` : ' (e njëjta adresë)'}. Nuk iu dërgua sektorit; pret vendimin e administratorit.`,
        meta: { duplicateOf: match.caseNumber, meters: match.meters },
      },
    }),
  ]);
  return true;
}

/**
 * Admin: the same problem. The report closes (rejected, with a reason that points to the first one,
 * so it is not counted as fixed); the first report gets one more supporter and the reporter's e-mail
 * as a follower, so they hear about it from now on.
 */
export async function mergeDuplicate(user: Principal, id: string, intoCaseNumber?: string): Promise<{ into: string }> {
  assertAdmin(user);
  const report = await db.report.findUnique({ where: { id }, include: { possibleDuplicateOf: { select: { caseNumber: true } } } });
  if (!report) throw notFound('Raportimi nuk u gjet.');
  if (FINAL_STATUSES.includes(report.status)) throw conflict('Ky raportim është mbyllur tashmë.');
  const intoNumber = intoCaseNumber?.trim().toUpperCase() || report.possibleDuplicateOf?.caseNumber;
  if (!intoNumber) throw badRequest('Shkruani numrin e raportimit me të cilin do të bashkohet.');
  const into = await db.report.findUnique({ where: { caseNumber: intoNumber }, select: { id: true, caseNumber: true, status: true, mergedIntoId: true } });
  if (!into) throw notFound(`Raportimi ${intoNumber} nuk u gjet.`);
  if (into.id === report.id) throw badRequest('Një raportim nuk mund të bashkohet me veten.');
  if (into.mergedIntoId) throw badRequest(`${into.caseNumber} është bashkuar vetë me një raportim tjetër.`);
  if (FINAL_STATUSES.includes(into.status)) throw conflict(`${into.caseNumber} është mbyllur; nuk mund t’i bashkohet asgjë.`);

  const reason = `Ky problem ishte raportuar tashmë si ${into.caseNumber}. Raportimi juaj u bashkua me të; ndiqeni atje.`;
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.report.update({
      where: { id: report.id },
      data: { status: 'REJECTED', rejectionReason: reason, mergedIntoId: into.id, possibleDuplicateOfId: null, closedAt: now },
    });
    await tx.reportEvent.createMany({
      data: [
        { reportId: report.id, type: 'DUPLICATE_MERGED', actorId: user.id, message: `U bashkua me ${into.caseNumber}.`, meta: { into: into.caseNumber } },
        { reportId: report.id, type: 'STATUS_CHANGED', actorId: user.id, fromStatus: report.status, toStatus: 'REJECTED', message: reason, isPublic: true },
        { reportId: into.id, type: 'FOLLOWER_ADDED', actorId: user.id, message: `Një qytetar tjetër raportoi të njëjtin problem (${report.caseNumber}, u bashkua këtu).`, meta: { merged: report.caseNumber } },
      ],
    });
    if (!report.isTest && report.contactEmail && report.wantsUpdates) {
      await tx.reportFollower.create({ data: { reportId: into.id, email: report.contactEmail } });
    }
    await tx.report.update({ where: { id: into.id }, data: { supportersCount: { increment: 1 + report.supportersCount } } });
    // Reports that waited on this one now wait on the first one.
    await tx.report.updateMany({ where: { possibleDuplicateOfId: report.id }, data: { possibleDuplicateOfId: into.id } });
  });
  await revokeLinks(report.id, null);
  await notifyCitizenStatus(report, report.status, 'REJECTED', reason);
  return { into: into.caseNumber };
}

/** Admin: a different problem after all. The report goes to its sector now. */
export async function dismissDuplicate(user: Principal, id: string): Promise<void> {
  assertAdmin(user);
  const report = await db.report.findUnique({ where: { id }, select: { id: true, status: true, possibleDuplicateOf: { select: { caseNumber: true } } } });
  if (!report) throw notFound('Raportimi nuk u gjet.');
  if (!report.possibleDuplicateOf) return;
  await db.$transaction([
    db.report.update({ where: { id }, data: { possibleDuplicateOfId: null } }),
    db.reportEvent.create({
      data: { reportId: id, type: 'DUPLICATE_DISMISSED', actorId: user.id, message: `Nuk është i njëjti problem si ${report.possibleDuplicateOf.caseNumber}.` },
    }),
  ]);
  if (OPEN_STATUSES.includes(report.status)) await notifyDepartmentOfReport(id, 'new');
}

