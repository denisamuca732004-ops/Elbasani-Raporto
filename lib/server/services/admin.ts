/**
 * Administration (admin only): departments, report categories and types (and
 * the department each type is routed to), areas, appearance, email log, demo
 * data. Every change to the catalogue clears its cache.
 */
import 'server-only';
import { OPEN_STATUSES, type Channel, type Priority, type Status } from '@/lib/shared/domain';
import type { AppSettings, Paged, Principal } from '@/lib/shared/types';
import { zoneCodeAt } from '@/lib/shared/zones';
import type { DepartmentInput, DepartmentPatch, EmailLogQuery, LocalityInput, LocalityPatch, RequestTypeInput, SettingsInput } from '@/lib/validation/admin';
import { Prisma, db } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { deleteStoredImage } from '../storage';
import { assertAdmin } from './access';
import { nextCaseNumber } from './caseNumber';
import { invalidateCatalog } from './catalog';
import { ELBASAN_CENTER } from './geo';
import { getSettings, updateSettings } from './settings';

const DAY_MS = 86_400_000;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);

async function saveUnique<T>(fn: () => Promise<T>, field = 'code'): Promise<T> {
  try {
    const result = await fn();
    await invalidateCatalog();
    return result;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('Ky kod ose emër përdoret tashmë.', { field });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw notFound();
    throw err;
  }
}

/* ── Departments ── */

export async function listDepartments(admin: Principal) {
  assertAdmin(admin);
  const [departments, heads, types, open] = await Promise.all([
    db.department.findMany({ orderBy: [{ active: 'desc' }, { nameSq: 'asc' }] }),
    db.user.findMany({ where: { role: 'MUNICIPALITY_STAFF' }, select: { id: true, name: true, email: true, departmentId: true, active: true }, orderBy: { name: 'asc' } }),
    db.requestType.groupBy({ by: ['departmentId'], where: { active: true }, _count: { _all: true } }),
    db.report.groupBy({ by: ['departmentId'], where: { status: { in: [...OPEN_STATUSES] }, isTest: false }, _count: { _all: true } }),
  ]);
  const typesBy = new Map(types.map((t) => [t.departmentId, t._count._all]));
  const openBy = new Map(open.map((o) => [o.departmentId, o._count._all]));
  return departments.map((d) => ({
    id: d.id,
    code: d.code,
    nameSq: d.nameSq,
    nameEn: d.nameEn,
    description: d.description,
    email: d.email,
    active: d.active,
    heads: heads.filter((h) => h.departmentId === d.id).map((h) => ({ id: h.id, name: h.name, email: h.email, active: h.active })),
    activeTypes: typesBy.get(d.id) ?? 0,
    openReports: openBy.get(d.id) ?? 0,
  }));
}
export type DepartmentRow = Awaited<ReturnType<typeof listDepartments>>[number];

export async function createDepartment(admin: Principal, input: DepartmentInput) {
  assertAdmin(admin);
  return saveUnique(() => db.department.create({
    data: { code: input.code, nameSq: input.nameSq, nameEn: input.nameEn, description: input.description ?? null, email: input.email ?? null, active: input.active },
  }));
}

export async function updateDepartment(admin: Principal, id: number, input: DepartmentPatch) {
  assertAdmin(admin);
  const department = await db.department.findUnique({ where: { id } });
  if (!department) throw notFound('Sektori nuk u gjet.');
  if (input.active === false && department.active) {
    const [types, open] = await Promise.all([
      db.requestType.count({ where: { departmentId: id, active: true } }),
      db.report.count({ where: { departmentId: id, status: { in: [...OPEN_STATUSES] } } }),
    ]);
    if (types || open) {
      throw conflict(
        `Ky sektor ka ${[
          types ? (types === 1 ? '1 lloj raportimi aktiv' : `${types} lloje raportimesh aktive`) : '',
          open ? (open === 1 ? '1 raportim të hapur' : `${open} raportime të hapura`) : '',
        ].filter(Boolean).join(' dhe ')}. Kalojini te një sektor tjetër para se ta çaktivizoni.`,
        { activeTypes: types, openReports: open },
      );
    }
  }
  return saveUnique(() => db.department.update({
    where: { id },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.nameSq !== undefined ? { nameSq: input.nameSq } : {}),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
      ...('description' in input ? { description: input.description ?? null } : {}),
      ...('email' in input ? { email: input.email ?? null } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  }));
}

/* ── Categories and report types ── */

export async function listCategories(admin: Principal) {
  assertAdmin(admin);
  return db.category.findMany({
    include: { requestTypes: { include: { department: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
}
export type CategoryWithTypes = Awaited<ReturnType<typeof listCategories>>[number];

export async function createCategory(admin: Principal, input: { code: string; nameSq: string; nameEn: string; icon: string; sortOrder: number; active: boolean }) {
  assertAdmin(admin);
  return saveUnique(() => db.category.create({ data: input }));
}

export async function updateCategory(admin: Principal, id: number, input: Partial<{ code: string; nameSq: string; nameEn: string; icon: string; sortOrder: number; active: boolean }>) {
  assertAdmin(admin);
  return saveUnique(() => db.category.update({ where: { id }, data: input }));
}

async function assertTypeRefs(input: Partial<RequestTypeInput>): Promise<void> {
  if (input.categoryId !== undefined && !(await db.category.findUnique({ where: { id: input.categoryId } }))) {
    throw badRequest('Kjo kategori nuk ekziston.', [{ field: 'categoryId', code: 'unknown', message: 'Kjo kategori nuk ekziston.' }]);
  }
  if (input.departmentId) {
    const department = await db.department.findUnique({ where: { id: input.departmentId } });
    if (!department || !department.active) {
      throw badRequest('Ky sektor nuk ekziston ose është çaktivizuar.', [{ field: 'departmentId', code: 'unknown', message: 'Ky sektor nuk ekziston ose është çaktivizuar.' }]);
    }
  }
}

export async function createRequestType(admin: Principal, input: RequestTypeInput) {
  assertAdmin(admin);
  await assertTypeRefs(input);
  return saveUnique(() => db.requestType.create({ data: { ...input, keywords: input.keywords ?? null } }));
}

/** Changing a type's department only affects NEW reports; existing ones stay where they are. */
export async function updateRequestType(admin: Principal, id: number, input: Partial<RequestTypeInput>) {
  assertAdmin(admin);
  await assertTypeRefs(input);
  return saveUnique(() => db.requestType.update({ where: { id }, data: { ...input, ...('keywords' in input ? { keywords: input.keywords ?? null } : {}) } }));
}

/* ── Areas ── */

export async function listNeighbourhoods(admin: Principal) {
  assertAdmin(admin);
  const zones = await db.neighbourhood.findMany({
    include: { localities: { select: { id: true, name: true, active: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  return zones.map((z) => ({ ...z, localities: [...z.localities].sort((a, b) => a.name.localeCompare(b.name, 'sq', { numeric: true })) }));
}

export async function createNeighbourhood(admin: Principal, input: { name: string; sortOrder: number; active: boolean }) {
  assertAdmin(admin);
  return saveUnique(() => db.neighbourhood.create({ data: input }), 'name');
}

export async function updateNeighbourhood(admin: Principal, id: number, input: Partial<{ name: string; sortOrder: number; active: boolean }>) {
  assertAdmin(admin);
  return saveUnique(() => db.neighbourhood.update({ where: { id }, data: input }), 'name');
}

/* ── Lagje and villages of a zone ── */

export async function createLocality(admin: Principal, input: LocalityInput) {
  assertAdmin(admin);
  if (!(await db.neighbourhood.findUnique({ where: { id: input.neighbourhoodId } }))) throw notFound('Zona nuk u gjet.');
  return saveUnique(() => db.locality.create({ data: input }), 'name');
}

export async function updateLocality(admin: Principal, id: number, input: LocalityPatch) {
  assertAdmin(admin);
  return saveUnique(() => db.locality.update({ where: { id }, data: input }), 'name');
}

/* ── Appearance ── */

export async function readSettings(admin: Principal): Promise<AppSettings> {
  assertAdmin(admin);
  return getSettings();
}

export async function saveSettings(admin: Principal, input: SettingsInput): Promise<AppSettings> {
  assertAdmin(admin);
  return updateSettings(input);
}

/* ── Email log ── */

export interface EmailLogItem {
  id: string; toAddress: string; subject: string; bodyText: string; template: string | null; reportId: string | null;
  status: string; error: string | null; attempts: number; createdAt: string; sentAt: string | null;
}

export async function listEmailLog(admin: Principal, query: EmailLogQuery): Promise<Paged<EmailLogItem>> {
  assertAdmin(admin);
  const where: Prisma.EmailLogWhereInput = query.q
    ? { OR: [{ toAddress: { contains: query.q, mode: 'insensitive' } }, { subject: { contains: query.q, mode: 'insensitive' } }] }
    : {};
  const [rows, total] = await Promise.all([
    db.emailLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
    db.emailLog.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: String(r.id), toAddress: r.toAddress, subject: r.subject, bodyText: r.bodyText, template: r.template, reportId: r.reportId,
      status: r.status, error: r.error, attempts: r.attempts, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null,
    })),
    total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/* ── Demo data (clearly marked as test, never counted in public statistics) ── */

const SAMPLE_DESCRIPTIONS = [
  'Ka disa ditë që mbetjet janë grumbulluar pranë kontejnerit dhe vjen erë e keqe.',
  'Gropë e thellë në mes të rrugës, rrezik për motorët dhe makinat.',
  'Drita e rrugës nuk ndizet prej një jave, rruga është shumë e errët.',
  'Rrjedh ujë nga tubi në trotuar që prej mëngjesit.',
  'Pemë me degë të thyera mbi trotuar, kalimtarët kalojnë në rrugë.',
  'Qen endacakë pranë shkollës në mëngjes, fëmijët kanë frikë.',
  'Kanali bllokohet sa herë bie shi dhe uji del në rrugë.',
  'Kërkoj marrjen e një divani të vjetër nga para pallatit.',
  'Lokali ka muzikë shumë të lartë pas mesnate çdo fundjavë.',
  'Kantieri nuk ka rrethim dhe materialet bien në trotuar.',
];
const SAMPLE_STREETS = [
  'Rruga Qemal Stafa', 'Bulevardi Aqif Pasha', 'Rruga Rinia', 'Sheshi Skënderbej', 'Rruga Kristoforidhi',
  'Rruga e Kalasë', 'Rruga Ismail Bey', 'Rruga 11 Nëntori',
];

/** Deterministic plan: many recent reports (week and month) and a steady flow over the year. */
function sampleDaysAgo(i: number): number {
  if (i < 14) return i * 0.45 + 0.1; // last week
  if (i < 34) return 7 + (i - 14) * 1.1; // rest of the month
  return 30 + (i - 34) * 12.5; // rest of the year
}

function sampleStatus(i: number, daysAgo: number): Status {
  if (daysAgo > 30) return i % 9 === 0 ? 'REJECTED' : i % 4 === 0 ? 'RESOLVED' : 'CLOSED';
  const recent: Status[] = ['NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED', 'IN_PROGRESS', 'CLOSED', 'ASSIGNED'];
  return recent[i % recent.length]!;
}

export async function loadSampleData(admin: Principal, count = 60) {
  assertAdmin(admin);
  const [types, areas, departments, heads] = await Promise.all([
    db.requestType.findMany({ where: { active: true }, orderBy: { id: 'asc' } }),
    db.neighbourhood.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
    db.department.findMany({ where: { active: true }, orderBy: { id: 'asc' } }),
    db.user.findMany({ where: { role: 'MUNICIPALITY_STAFF', active: true } }),
  ]);
  if (!types.length) throw badRequest('Ngarkoni më parë të dhënat bazë (llojet e raportimeve).');
  const now = new Date();
  const created: string[] = [];
  let transfers = 0;
  const channels: Channel[] = ['WEB', 'APP', 'FACEBOOK', 'WEB', 'PHONE', 'EMBED'];

  for (let i = 0; i < count; i += 1) {
    const type = types[(i * 7) % types.length]!;
    const daysAgo = sampleDaysAgo(i);
    const createdAt = addDays(now, -daysAgo);
    const status = sampleStatus(i, daysAgo);
    const done = status === 'RESOLVED' || status === 'CLOSED';
    const departmentId = departments.find((d) => d.id === type.departmentId)?.id ?? null;
    const head = heads.find((h) => h.departmentId === departmentId) ?? null;
    const priority: Priority = i % 5 === 0 ? 'HIGH' : i % 7 === 0 ? 'LOW' : type.defaultPriority;
    const resolveDays = Math.min(type.slaDays + (i % 3 === 0 ? 2 : -1), Math.max(daysAgo - 0.05, 0.05));
    const resolvedAt = done ? addDays(createdAt, Math.max(resolveDays, 0.05)) : null;
    const street = SAMPLE_STREETS[i % SAMPLE_STREETS.length]!;
    const latitude = ELBASAN_CENTER.latitude + (((i * 37) % 40) - 20) / 2000;
    const longitude = ELBASAN_CENTER.longitude + (((i * 53) % 40) - 20) / 2000;
    // The zone always matches the point (the sample streets are in the city).
    const zoneCode = zoneCodeAt(latitude, longitude);

    await db.$transaction(async (tx) => {
      const caseNumber = await nextCaseNumber(tx, createdAt);
      const report = await tx.report.create({
        data: {
          caseNumber,
          requestTypeId: type.id,
          categoryId: type.categoryId,
          departmentId,
          neighbourhoodId: areas.find((a) => a.code !== null && a.code === zoneCode)?.id ?? null,
          kind: type.kind,
          status,
          priority,
          channel: channels[i % channels.length]!,
          description: SAMPLE_DESCRIPTIONS[i % SAMPLE_DESCRIPTIONS.length]!,
          address: `${street} ${10 + i}`,
          latitude,
          longitude,
          anonymous: i % 3 === 0,
          contactName: i % 3 === 0 ? null : 'Qytetar Shembull',
          contactPhone: i % 3 === 0 ? null : '+355 69 000 0000',
          assignedToId: (status === 'ASSIGNED' || status === 'IN_PROGRESS') && head ? head.id : null,
          aiStatus: 'DISABLED',
          aiSummary: `${type.nameSq} – ${street}`,
          dueAt: addDays(createdAt, type.slaDays),
          verifiedAt: status === 'NEEDS_REVIEW' ? null : addDays(createdAt, 0.02),
          resolvedAt,
          closedAt: status === 'CLOSED' && resolvedAt ? addDays(resolvedAt, Math.min(1, Math.max(daysAgo - resolveDays - 0.02, 0.01))) : null,
          closingNote: done ? 'Problemi u rregullua nga ekipi i sektorit.' : null,
          rejectionReason: status === 'REJECTED' ? 'Problemi ndodhet në pronë private dhe nuk është në kompetencë të Bashkisë.' : null,
          citizenRating: status === 'CLOSED' ? 3 + (i % 3) : null,
          supportersCount: i % 4,
          isTest: true,
          createdAt,
          updatedAt: resolvedAt ?? createdAt,
        },
      });
      await tx.reportEvent.createMany({
        data: [
          { reportId: report.id, type: 'CREATED', toStatus: 'PENDING', isPublic: true, createdAt },
          { reportId: report.id, type: 'STATUS_CHANGED', fromStatus: 'PENDING', toStatus: status, isPublic: status !== 'NEEDS_REVIEW', createdAt: addDays(createdAt, 0.02) },
        ],
      });
      // Two open reports wait for the admin's review ("not our department").
      if (departmentId && transfers < 2 && (status === 'VERIFIED' || status === 'NEEDS_REVIEW') && daysAgo < 7) {
        const other = departments.find((d) => d.id !== departmentId);
        await tx.departmentTransfer.create({
          data: {
            reportId: report.id, pendingReportId: report.id, fromDepartmentId: departmentId, suggestedDepartmentId: other?.id ?? null,
            reason: 'Shembull: ky problem nuk i përket sektorit tonë, por sektorit të sugjeruar.', requestedById: head?.id ?? null,
          },
        });
        transfers += 1;
      }
      created.push(caseNumber);
    });
  }
  return { created: created.length, caseNumbers: created, pendingTransfers: transfers };
}

export async function deleteSampleData(admin: Principal) {
  assertAdmin(admin);
  const photos = await db.attachment.findMany({ where: { report: { isTest: true } }, select: { storageKey: true } });
  const { count } = await db.report.deleteMany({ where: { isTest: true } });
  for (const p of photos) await deleteStoredImage(p.storageKey);
  return { deleted: count };
}

