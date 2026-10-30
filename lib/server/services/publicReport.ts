/**
 * Everything a resident can do without an account: report a problem (every
 * step is mandatory), check for the same problem nearby, follow a case, track
 * it, browse the map and confirm or reopen a resolved report.
 * Contact details are never returned by these functions.
 */
import 'server-only';
import type { z } from 'zod';
import { FINAL_STATUSES, LIMITS, OPEN_STATUSES, PUBLIC_LISTED_STATUSES, publicStatusOf, type Status } from '@/lib/shared/domain';
import type { FieldError } from '@/lib/shared/result';
import type { MapPoint, PublicCard, PublicCase } from '@/lib/shared/types';
import { citizenReportShape, type FeedbackInput, type MapQuery, type RecentQuery } from '@/lib/validation/report';
import { check } from '@/lib/validation/zod';
import type { RequestType } from '@/lib/generated/prisma/client';
import { Prisma, db } from '../db';
import { config } from '../env';
import { AppError, conflict, notFound } from '../errors';
import { queueEmails } from '../mail';
import * as tpl from '../mailTemplates';
import { hashToken } from '../tokens';
import { CITY_ZONE_CODE, otherZonePlace } from '@/lib/shared/zones';
import { boundingBox, distanceMeters, insideMunicipality, roundCoord, zoneOfPoint } from './geo';
import { isPubliclyVerified, publicInclude, toPublicCard, toPublicCase } from './mapper';
import { departmentRecipients } from './notification';
import { persistNewReport } from './reportCreation';

/* ───────────────────────── Strict citizen report ───────────────────────── */

/** Wizard step of every field, so the website can send the resident back to the right step. */
const STEP_OF_FIELD: Record<string, string> = {
  requestTypeId: 'type',
  locationMode: 'location', latitude: 'location', longitude: 'location', address: 'location', neighbourhoodId: 'location', localityId: 'location',
  photoKey: 'photo', photo: 'photo',
  description: 'details',
  anonymous: 'contact', contactName: 'contact', contactEmail: 'contact', contactPhone: 'contact',
};

const MESSAGES: Record<string, string> = {
  'requestTypeId.required': 'Zgjidhni llojin e problemit.',
  'requestTypeId.unknown': 'Ky lloj raportimi nuk ekziston më. Zgjidhni një tjetër.',
  'latitude.required': 'Përdorni vendndodhjen tuaj (GPS) ose prekni hartën.',
  'longitude.required': 'Përdorni vendndodhjen tuaj (GPS) ose prekni hartën.',
  'latitude.outside_area': 'Pika në hartë duhet të jetë brenda Bashkisë Elbasan.',
  'address.required': 'Shkruani rrugën, numrin ose një pikë reference.',
  'address.too_short': `Adresa duhet të ketë të paktën ${LIMITS.minAddress} shkronja.`,
  'neighbourhoodId.required': 'Zgjidhni zonën (njësinë administrative).',
  'neighbourhoodId.unknown': 'Zgjidhni një zonë nga lista.',
  'localityId.required': 'Zgjidhni lagjen ose fshatin.',
  'localityId.other_zone': 'Kjo lagje ose fshat nuk është në zonën e zgjedhur.',
  'photo.required': 'Shtoni një foto të problemit.',
  'description.required': 'Përshkruani problemin.',
  'description.too_short': `Përshkrimi duhet të ketë të paktën ${LIMITS.minDescription} shkronja.`,
  'anonymous.required': 'Zgjidhni nëse doni të lini kontakt ose të raportoni anonim.',
  'contactName.required': 'Shkruani emrin tuaj ose zgjidhni "Anonim".',
  'contactEmail.invalid': 'Emaili nuk është i saktë.',
  'contactPhone.invalid': 'Numri i telefonit nuk është i saktë.',
  'contactEmail.contact_required': 'Shkruani emailin ose numrin e telefonit, ose zgjidhni "Anonim".',
};

export type ReportProblem = FieldError & { step: string };

function problem(field: string, code: string, fallback?: string): ReportProblem {
  const f = field === 'photoKey' ? 'photo' : field;
  return { field: f, code, step: STEP_OF_FIELD[f] ?? 'review', message: MESSAGES[`${f}.${code}`] ?? fallback ?? 'Fushë e pavlefshme.' };
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '');
const cleanMultiline = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
const phoneDigits = (s: string): number => s.replace(/\D/g, '').length;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface ResolvedLocation { latitude: number | null; longitude: number | null; neighbourhoodId: number | null; address: string | null }

/**
 * The place of a resident's report, in one of two ways (see LOCATION_MODES):
 *  - map: a point inside the Municipality; the zone comes from the point, never from the form;
 *  - address: a zone, one of ITS lagje or villages, and the street, which may not name a place of another zone.
 */
async function resolveLocation(data: CitizenReport, problems: ReportProblem[]): Promise<ResolvedLocation> {
  const text = clean(data.address);
  if (data.locationMode === 'map') {
    if (data.latitude === undefined || data.longitude === undefined) {
      problems.push(problem('latitude', 'required'));
      return { latitude: null, longitude: null, neighbourhoodId: null, address: null };
    }
    if (!insideMunicipality(data.latitude, data.longitude)) problems.push(problem('latitude', 'outside_area'));
    const zone = await zoneOfPoint(data.latitude, data.longitude);
    return { latitude: data.latitude, longitude: data.longitude, neighbourhoodId: zone?.id ?? null, address: text || null };
  }

  const zones = await db.neighbourhood.findMany({
    where: { active: true },
    select: { id: true, name: true, code: true, localities: { where: { active: true }, select: { id: true, name: true } } },
  });
  const zone = data.neighbourhoodId ? zones.find((z) => z.id === data.neighbourhoodId) : undefined;
  if (!data.neighbourhoodId) problems.push(problem('neighbourhoodId', 'required'));
  else if (!zone) problems.push(problem('neighbourhoodId', 'unknown'));

  let locality: { id: number; name: string } | undefined;
  if (zone && zone.localities.length > 0) {
    locality = data.localityId ? zone.localities.find((l) => l.id === data.localityId) : undefined;
    if (!data.localityId) problems.push(problem('localityId', 'required'));
    else if (!locality) problems.push(problem('localityId', 'other_zone'));
  }

  if (!text) problems.push(problem('address', 'required'));
  else if (text.length < LIMITS.minAddress) problems.push(problem('address', 'too_short'));
  else if (zone) {
    const other = otherZonePlace(text, zone.id, zones);
    if (other) problems.push(problem('address', 'other_zone', `“${other.place}” ndodhet në zonën ${other.zone}. Zgjidhni zonën e duhur ose ndryshoni adresën.`));
  }
  // "Rruga Qemal Stafa 12, Lagjja Qemal Stafa" / "pranë shkollës, fshati Lleshan, njësia Gjinar"
  const where = !locality || !zone ? null
    : zone.code === CITY_ZONE_CODE ? `Lagjja ${locality.name}`
    : plainText(locality.name) === plainText(zone.name) ? `fshati ${locality.name}`
    : `fshati ${locality.name}, njësia ${zone.name}`;
  const address = [text, where].filter(Boolean).join(', ').slice(0, LIMITS.maxAddress);

  // An optional pin (so the report is also on the map): inside the Municipality AND inside the chosen zone.
  let pin: { latitude: number; longitude: number } | null = null;
  if (data.latitude !== undefined && data.longitude !== undefined) {
    if (!insideMunicipality(data.latitude, data.longitude)) problems.push(problem('latitude', 'outside_area'));
    else {
      const pinZone = await zoneOfPoint(data.latitude, data.longitude);
      if (zone?.code && pinZone && pinZone.id !== zone.id) {
        problems.push(problem('latitude', 'other_zone', `Pika në hartë është në zonën ${pinZone.name}, jo në ${zone.name}. Lëvizeni pikën ose ndryshoni zonën.`));
      } else pin = { latitude: data.latitude, longitude: data.longitude };
    }
  }
  return { latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null, neighbourhoodId: zone?.id ?? null, address: address || null };
}

type CitizenReport = z.output<typeof citizenReportShape>;

/**
 * Creates a resident's report only when EVERY step is complete:
 * type → location (a point on the map, or zone + lagje/village + street) → photo → description → contact (or anonymous).
 * All problems are returned together, each with the wizard step it belongs to.
 */
export async function createCitizenReport(raw: unknown, options: { citizenId?: string | null } = {}) {
  const problems: ReportProblem[] = [];
  const parsed = check(citizenReportShape, raw);
  if (!parsed.ok) {
    for (const e of parsed.errors) {
      const field = e.field.split('.')[0] ?? '';
      problems.push(problem(field, e.code === 'required' ? 'required' : 'invalid', e.message));
    }
  }

  // When other fields are malformed the location is not checked in full, but a missing one is still named.
  if (!parsed.ok && !problems.some((p) => p.step === 'location')) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (r.locationMode === 'address') {
      if (r.neighbourhoodId === undefined) problems.push(problem('neighbourhoodId', 'required'));
    } else if (r.latitude === undefined || r.longitude === undefined) {
      problems.push(problem('latitude', 'required'));
    }
  }

  let type: RequestType | null = null;
  let place: ResolvedLocation | null = null;
  if (parsed.ok) {
    const data = parsed.data;
    type = await db.requestType.findFirst({ where: { id: data.requestTypeId, active: true, category: { active: true } } });
    if (!type) problems.push(problem('requestTypeId', 'unknown'));

    place = await resolveLocation(data, problems);

    const description = cleanMultiline(data.description);
    if (!description) problems.push(problem('description', 'required'));
    else if (description.length < LIMITS.minDescription) problems.push(problem('description', 'too_short'));

    if (!data.anonymous) {
      const name = clean(data.contactName);
      const email = clean(data.contactEmail);
      const phone = clean(data.contactPhone);
      if (name.length < 2) problems.push(problem('contactName', 'required'));
      if (email && !EMAIL.test(email)) problems.push(problem('contactEmail', 'invalid'));
      if (phone && (phoneDigits(phone) < 6 || !/^[0-9 +()-]+$/.test(phone))) problems.push(problem('contactPhone', 'invalid'));
      if (!email && !phone) problems.push(problem('contactEmail', 'contact_required'));
    }
  }

  if (problems.length || !parsed.ok || !type || !place) {
    // Deduplicate (e.g. latitude + longitude both missing) while keeping the order.
    const seen = new Set<string>();
    const unique = problems.filter((p) => {
      const key = `${p.step}:${p.field === 'longitude' ? 'latitude' : p.field}:${p.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    throw new AppError(400, 'REPORT_INCOMPLETE', 'Plotësoni të gjitha hapat e raportimit.', unique);
  }

  const data = parsed.data;
  const anonymous = data.anonymous;
  const email = anonymous ? '' : clean(data.contactEmail).toLowerCase();
  const phone = anonymous ? '' : clean(data.contactPhone);
  let created;
  try {
    created = await persistNewReport({
      type,
      channel: data.channel,
      description: cleanMultiline(data.description),
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      neighbourhoodId: place.neighbourhoodId,
      anonymous,
      contactName: anonymous ? null : clean(data.contactName),
      contactEmail: email || null,
      contactPhone: phone || null,
      createdById: null,
      citizenId: options.citizenId ?? null,
      clientRef: data.clientRef?.trim() || null,
      photoKey: data.photoKey,
    });
  } catch (err) {
    // A missing, too large or unreadable photo sends the resident back to the photo step.
    if (err instanceof AppError && err.code === 'PHOTO_INVALID') {
      throw new AppError(400, 'REPORT_INCOMPLETE', 'Plotësoni të gjitha hapat e raportimit.', err.details);
    }
    throw err;
  }
  return {
    caseNumber: created.report.caseNumber,
    publicStatus: publicStatusOf(created.report.status as Status),
    trackUrl: tpl.trackUrl(created.report.caseNumber),
    duplicateSubmission: created.duplicateSubmission,
  };
}

/* ───────────────────────── Public views ───────────────────────── */

export async function findNearbyOpen(input: { requestTypeId: number; latitude: number; longitude: number }): Promise<PublicCard[]> {
  const type = await db.requestType.findUnique({ where: { id: input.requestTypeId }, select: { categoryId: true } });
  if (!type) throw notFound('Ky lloj raportimi nuk ekziston.');
  const radius = config().rules.duplicateRadiusMeters;
  const box = boundingBox(input.latitude, input.longitude, radius);
  const candidates = await db.report.findMany({
    where: {
      categoryId: type.categoryId,
      status: { in: [...OPEN_STATUSES] },
      latitude: { gte: box.minLat, lte: box.maxLat },
      longitude: { gte: box.minLng, lte: box.maxLng },
    },
    include: publicInclude,
    take: 50,
  });
  return candidates
    .map((r) => ({ r, d: distanceMeters(input.latitude, input.longitude, r.latitude ?? 0, r.longitude ?? 0) }))
    .filter(({ d }) => d <= radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(({ r, d }) => toPublicCard(r, d));
}

/** Lower case, without the Albanian ë / ç (and other accents), so "Skenderbej" finds "Skënderbej". */
export function plainText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** The same in SQL (PostgreSQL translate() is built in and does not depend on the database locale). */
const plainSql = (column: Prisma.Sql) => Prisma.sql`translate(lower(coalesce(${column}, '')), 'ëçéèËÇÉÈ', 'eceeecee')`;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Home page search: OPEN public reports whose street, area or type match every
 * word typed ("rinia", "gropë rinia", "Skenderbej"), so a resident sees that a
 * problem is already reported before reporting it again. Only what is public
 * anyway is searched (address, area, type) — never the description or contacts.
 */
export async function searchOpenByPlace(q: string, limit = 6): Promise<PublicCard[]> {
  const words = [...new Set(plainText(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2))].slice(0, 5);
  if (!words.length) return [];
  const conditions = words.map((w) => {
    const pattern = `%${likeEscape(w)}%`;
    return Prisma.sql`(${plainSql(Prisma.sql`r.address`)} LIKE ${pattern} ESCAPE '\'
      OR ${plainSql(Prisma.sql`n.name`)} LIKE ${pattern} ESCAPE '\'
      OR ${plainSql(Prisma.sql`t.name_sq`)} LIKE ${pattern} ESCAPE '\'
      OR ${plainSql(Prisma.sql`t.name_en`)} LIKE ${pattern} ESCAPE '\')`;
  });
  const open = publicStatusFilter('open');
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT r.id FROM reports r
    JOIN request_types t ON t.id = r.request_type_id
    LEFT JOIN neighbourhoods n ON n.id = r.neighbourhood_id
    WHERE r.status::text IN (${Prisma.join(open)}) AND ${Prisma.join(conditions, ' AND ')}
    ORDER BY r.supporters_count DESC, r.created_at DESC
    LIMIT ${limit}`;
  if (!rows.length) return [];
  const found = await db.report.findMany({ where: { id: { in: rows.map((r) => r.id) } }, include: publicInclude });
  const byId = new Map(found.map((r) => [r.id, r]));
  return rows.flatMap((r) => {
    const report = byId.get(r.id);
    return report ? [toPublicCard(report)] : [];
  });
}

export async function followReport(caseNumber: string, email: string | undefined) {
  const report = await db.report.findUnique({ where: { caseNumber }, select: { id: true, status: true } });
  if (!report) throw notFound('Raportimi nuk u gjet.');
  if (FINAL_STATUSES.includes(report.status)) throw conflict('Ky raportim është mbyllur tashmë.');
  const updated = await db.$transaction(async (tx) => {
    await tx.reportFollower.create({ data: { reportId: report.id, email: email ?? null } });
    await tx.reportEvent.create({ data: { reportId: report.id, type: 'FOLLOWER_ADDED', message: 'Një qytetar tjetër raportoi të njëjtin problem.' } });
    return tx.report.update({ where: { id: report.id }, data: { supportersCount: { increment: 1 } }, select: { caseNumber: true, supportersCount: true } });
  });
  return { caseNumber: updated.caseNumber, supporters: updated.supportersCount };
}

export async function getPublicCase(caseNumber: string): Promise<PublicCase> {
  const report = await db.report.findUnique({ where: { caseNumber }, include: publicInclude });
  if (!report) throw notFound('Raportimi nuk u gjet.');
  const events = await db.reportEvent.findMany({
    where: { reportId: report.id, isPublic: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { type: true, toStatus: true, message: true, isPublic: true, createdAt: true },
  });
  return toPublicCase(report, events);
}

function publicStatusFilter(status: 'open' | 'closed' | 'all' | undefined): Status[] {
  if (status === 'open') return [...OPEN_STATUSES]; // received, open and in progress
  if (status === 'closed') return ['RESOLVED', 'CLOSED'];
  return [...PUBLIC_LISTED_STATUSES];
}

export async function listRecent(query: RecentQuery): Promise<PublicCard[]> {
  const near = query.latitude !== undefined && query.longitude !== undefined;
  const where: Prisma.ReportWhereInput = { status: { in: publicStatusFilter(query.status) } };
  if (query.q) {
    where.OR = [
      { caseNumber: { contains: query.q, mode: 'insensitive' } },
      { address: { contains: query.q, mode: 'insensitive' } },
      { description: { contains: query.q, mode: 'insensitive' } },
    ];
  }
  if (query.category) where.category = { code: query.category };
  if (near) {
    const box = boundingBox(query.latitude!, query.longitude!, 3000);
    where.latitude = { gte: box.minLat, lte: box.maxLat };
    where.longitude = { gte: box.minLng, lte: box.maxLng };
  }
  const rows = await db.report.findMany({ where, include: publicInclude, orderBy: { createdAt: 'desc' }, take: near ? 200 : query.limit });
  if (!near) return rows.map((r) => toPublicCard(r));
  return rows
    .map((r) => ({ r, d: distanceMeters(query.latitude!, query.longitude!, r.latitude ?? 0, r.longitude ?? 0) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, query.limit)
    .map(({ r, d }) => toPublicCard(r, d));
}

/**
 * Reports given with a typed address and no point on the map, so they can
 * still be seen on the map page (as a list under the map), with the same filters.
 */
export async function unplacedReports(query: MapQuery, limit = 30): Promise<PublicCard[]> {
  const rows = await db.report.findMany({
    where: {
      status: { in: publicStatusFilter(query.status) },
      OR: [{ latitude: null }, { longitude: null }],
      createdAt: { gte: new Date(Date.now() - query.days * 86_400_000) },
      ...(query.category ? { category: { code: query.category } } : {}),
    },
    include: publicInclude,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => toPublicCard(r));
}

export async function mapPoints(query: MapQuery): Promise<MapPoint[]> {
  const rows = await db.report.findMany({
    where: {
      status: { in: publicStatusFilter(query.status) },
      latitude: { not: null },
      longitude: { not: null },
      createdAt: { gte: new Date(Date.now() - query.days * 86_400_000) },
      ...(query.category ? { category: { code: query.category } } : {}),
    },
    select: {
      caseNumber: true, status: true, latitude: true, longitude: true, createdAt: true, isTest: true,
      requestType: { select: { nameSq: true, nameEn: true } },
      category: { select: { code: true, icon: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  });
  return rows.map((r) => ({
    caseNumber: r.caseNumber,
    publicStatus: publicStatusOf(r.status),
    latitude: roundCoord(r.latitude)!,
    longitude: roundCoord(r.longitude)!,
    categoryCode: r.category.code,
    icon: r.category.icon,
    typeNameSq: r.requestType.nameSq,
    typeNameEn: r.requestType.nameEn,
    isTest: r.isTest,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** A photo anyone may see: public, and (for the resident's photo) the report was verified. */
export async function getPublicPhoto(id: string) {
  const attachment = await db.attachment.findUnique({
    where: { id },
    include: { report: { select: { status: true, verifiedAt: true } } },
  });
  if (!attachment || !attachment.isPublic) throw notFound('Fotoja nuk u gjet.');
  if (attachment.kind === 'BEFORE' && !isPubliclyVerified(attachment.report)) throw notFound('Fotoja nuk u gjet.');
  return attachment;
}

/* ───────────────────────── Resident feedback ───────────────────────── */

async function findByFeedbackToken(token: string) {
  const report = await db.report.findUnique({ where: { citizenTokenHash: hashToken(token) }, include: publicInclude });
  if (!report) throw notFound('Ky link nuk është më i vlefshëm.');
  return report;
}

export async function getFeedbackInfo(token: string): Promise<PublicCase> {
  return toPublicCase(await findByFeedbackToken(token));
}

export async function submitCitizenFeedback(input: FeedbackInput) {
  const report = await findByFeedbackToken(input.token);
  if (report.status !== 'RESOLVED') throw conflict('Ky raportim nuk pret konfirmimin tuaj.');
  const comment = input.comment ?? null;
  const rating = input.rating ?? null;
  const confirm = input.action === 'confirm';
  const next = await db.$transaction(async (tx) => {
    // Only the first answer counts: the token is cleared in the same statement.
    const claimed = await tx.report.updateMany({
      where: { id: report.id, status: 'RESOLVED', citizenTokenHash: report.citizenTokenHash },
      data: confirm
        ? { status: 'CLOSED', closedAt: new Date(), citizenRating: rating, citizenComment: comment, citizenTokenHash: null }
        : {
            status: 'IN_PROGRESS', resolvedAt: null, closedAt: null, closingNote: null, citizenRating: rating, citizenComment: comment,
            citizenTokenHash: null, reopenCount: { increment: 1 },
          },
    });
    if (claimed.count === 0) throw conflict('Ky raportim nuk pret konfirmimin tuaj.');
    await tx.reportEvent.create({
      data: confirm
        ? {
            reportId: report.id, type: 'CITIZEN_CONFIRMED', fromStatus: 'RESOLVED', toStatus: 'CLOSED', isPublic: true,
            message: 'Qytetari konfirmoi se problemi u rregullua.', meta: { rating },
          }
        : {
            reportId: report.id, type: 'CITIZEN_REOPENED', fromStatus: 'RESOLVED', toStatus: 'IN_PROGRESS', isPublic: true,
            message: 'Qytetari njoftoi se problemi nuk është rregulluar.', meta: { comment },
          },
    });
    return confirm ? ('CLOSED' as const) : ('IN_PROGRESS' as const);
  });

  if (!confirm && !report.isTest) {
    const to: string[] = [];
    if (report.assignedToId) {
      const assignee = await db.user.findUnique({ where: { id: report.assignedToId }, select: { email: true, active: true } });
      if (assignee?.active) to.push(assignee.email);
    }
    if (!to.length && report.departmentId) to.push(...(await departmentRecipients(report.departmentId)));
    await queueEmails(to, tpl.staffReopened({ caseNumber: report.caseNumber, reportId: report.id, comment }), report.id);
  }
  return { caseNumber: report.caseNumber, publicStatus: publicStatusOf(next) };
}
