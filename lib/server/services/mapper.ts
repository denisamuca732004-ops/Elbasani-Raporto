/** Turns database rows into the shapes pages receive (lib/shared/types.ts). */
import 'server-only';
import type { Prisma } from '@/lib/generated/prisma/client';
import {
  ADMIN_SETTABLE_STATUSES, FINAL_STATUSES, OPEN_STATUSES, STATUS_TRANSITIONS, publicStatusOf, type PublicStatus, type Status,
} from '@/lib/shared/domain';
import type {
  CategoryRef, NamedRef, PersonRef, Principal, PublicCard, PublicCase, PublicTimelineItem, ReportDetail, ReportListItem,
  TransferSummary, TypeRef,
} from '@/lib/shared/types';
import { canAccessReport, isAdmin } from './access';
import { roundCoord } from './geo';

/* ─── What to load with each kind of query ─── */

const person = { select: { id: true, name: true } } as const;
const attachmentsInOrder = { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] };

export const publicInclude = {
  requestType: true,
  category: true,
  department: true,
  neighbourhood: true,
  attachments: attachmentsInOrder,
} satisfies Prisma.ReportInclude;

export const listInclude = {
  requestType: true,
  category: true,
  department: true,
  neighbourhood: true,
  assignedTo: person,
  transfers: { where: { status: 'PENDING' }, select: { id: true } },
} satisfies Prisma.ReportInclude;

export const transferInclude = {
  fromDepartment: true,
  suggestedDepartment: true,
  toDepartment: true,
  requestedBy: person,
  decidedBy: person,
} satisfies Prisma.DepartmentTransferInclude;

export const detailInclude = {
  ...listInclude,
  aiSuggestedType: true,
  createdBy: person,
  attachments: attachmentsInOrder,
  transfers: { include: transferInclude, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ReportInclude;

export type PublicRow = Prisma.ReportGetPayload<{ include: typeof publicInclude }>;
export type ListRow = Prisma.ReportGetPayload<{ include: typeof listInclude }>;
export type DetailRow = Prisma.ReportGetPayload<{ include: typeof detailInclude }>;
export type TransferRow = Prisma.DepartmentTransferGetPayload<{ include: typeof transferInclude }>;
type EventRow = Prisma.ReportEventGetPayload<{ include: { actor: typeof person } }>;
type AttachmentRow = { id: string; kind: 'BEFORE' | 'AFTER'; isPublic: boolean; width: number | null; height: number | null; createdAt: Date };

/* ─── Small pieces ─── */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export const publicPhotoUrl = (a: { id: string }): string => `/api/public/photos/${a.id}`;
export const staffPhotoUrl = (a: { id: string }): string => `/api/admin/photos/${a.id}`;

export function isOverdue(r: { dueAt: Date | null; status: Status }, now = new Date()): boolean {
  return Boolean(r.dueAt && OPEN_STATUSES.includes(r.status) && r.dueAt < now);
}

/** Unverified reports keep their description and photo private. */
export const isPubliclyVerified = (r: { status: Status; verifiedAt: Date | null }): boolean =>
  !['PENDING', 'NEEDS_REVIEW'].includes(r.status) || Boolean(r.verifiedAt);

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{7,}\d/g;

/**
 * Public pages never show an email address or a phone number, even when a
 * resident typed one into the description. Staff still see the original text.
 */
export function maskContacts(text: string | null): string | null {
  if (!text) return text;
  return text
    .replace(EMAIL_IN_TEXT, '[email]')
    .replace(PHONE_IN_TEXT, (match) => (match.replace(/\D/g, '').length >= 9 ? '[telefon]' : match));
}

export const typeRef = (t: { id: number; code: string; nameSq: string; nameEn: string; kind: TypeRef['kind'] } | null | undefined): TypeRef | null =>
  (t ? { id: t.id, code: t.code, nameSq: t.nameSq, nameEn: t.nameEn, kind: t.kind } : null);
export const categoryRef = (c: { id: number; code: string; nameSq: string; nameEn: string; icon: string } | null | undefined): CategoryRef | null =>
  (c ? { id: c.id, code: c.code, nameSq: c.nameSq, nameEn: c.nameEn, icon: c.icon } : null);
export const departmentRef = (d: { id: number; code: string; nameSq: string; nameEn: string } | null | undefined): NamedRef | null =>
  (d ? { id: d.id, code: d.code, nameSq: d.nameSq, nameEn: d.nameEn } : null);
const personRef = (p: { id: string; name: string } | null | undefined): PersonRef | null => (p ? { id: p.id, name: p.name } : null);

/* ─── Public ─── */

/**
 * The resident's history. Internal steps that keep the same public status
 * (e.g. VERIFIED → ASSIGNED, both shown as "Open") are left out, unless the
 * step carries a message for the public.
 */
export function publicTimeline(events: Array<{ type: PublicTimelineItem['type']; toStatus: Status | null; message: string | null; isPublic: boolean; createdAt: Date }>): PublicTimelineItem[] {
  const items: PublicTimelineItem[] = [];
  let shown: PublicStatus | null = null;
  for (const e of events) {
    if (!e.isPublic) continue;
    const status = e.toStatus ? publicStatusOf(e.toStatus) : null;
    const message = e.message || null;
    if (e.type === 'STATUS_CHANGED' && status === shown && !message) continue;
    items.push({ type: e.type, status, message, at: e.createdAt.toISOString() });
    if (status) shown = status;
  }
  return items;
}

export function toPublicCase(r: PublicRow, events: Parameters<typeof publicTimeline>[0] = []): PublicCase {
  const verified = isPubliclyVerified(r);
  const before = r.attachments.find((a) => a.kind === 'BEFORE' && a.isPublic);
  const after = [...r.attachments].reverse().find((a) => a.kind === 'AFTER' && a.isPublic);
  return {
    caseNumber: r.caseNumber,
    publicStatus: publicStatusOf(r.status),
    kind: r.kind,
    category: categoryRef(r.category),
    type: typeRef(r.requestType),
    description: verified ? maskContacts(r.description || null) : null,
    address: maskContacts(r.address || null),
    latitude: roundCoord(r.latitude),
    longitude: roundCoord(r.longitude),
    locationApproximate: r.locationApproximate,
    neighbourhood: r.neighbourhood?.name ?? null,
    departmentSq: r.department?.nameSq ?? null,
    departmentEn: r.department?.nameEn ?? null,
    beforePhotoUrl: verified && before ? publicPhotoUrl(before) : null,
    afterPhotoUrl: after ? publicPhotoUrl(after) : null,
    closingNote: r.status === 'RESOLVED' || r.status === 'CLOSED' ? r.closingNote || null : null,
    rejectionReason: r.status === 'REJECTED' ? r.rejectionReason || null : null,
    supporters: r.supportersCount,
    isTest: r.isTest,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    resolvedAt: iso(r.resolvedAt),
    timeline: publicTimeline(events),
  };
}

export function toPublicCard(
  r: Pick<PublicRow, 'caseNumber' | 'status' | 'verifiedAt' | 'category' | 'requestType' | 'address' | 'neighbourhood' | 'latitude' | 'longitude' | 'attachments' | 'supportersCount' | 'createdAt' | 'isTest'>,
  distance: number | null = null,
): PublicCard {
  const before = r.attachments.find((a) => a.kind === 'BEFORE' && a.isPublic);
  return {
    caseNumber: r.caseNumber,
    publicStatus: publicStatusOf(r.status),
    category: categoryRef(r.category),
    type: typeRef(r.requestType),
    address: maskContacts(r.address || null),
    neighbourhood: r.neighbourhood?.name ?? null,
    latitude: roundCoord(r.latitude),
    longitude: roundCoord(r.longitude),
    photoUrl: before && isPubliclyVerified(r) ? publicPhotoUrl(before) : null,
    supporters: r.supportersCount,
    createdAt: r.createdAt.toISOString(),
    distanceMeters: distance === null ? null : Math.round(distance),
    isTest: r.isTest,
  };
}

/* ─── Staff ─── */

export function toTransferSummary(t: TransferRow): TransferSummary {
  return {
    id: t.id,
    status: t.status,
    reason: t.reason,
    fromDepartment: departmentRef(t.fromDepartment),
    suggestedDepartment: departmentRef(t.suggestedDepartment),
    toDepartment: departmentRef(t.toDepartment),
    requestedBy: personRef(t.requestedBy),
    decidedBy: personRef(t.decidedBy),
    decisionNote: t.decisionNote,
    createdAt: t.createdAt.toISOString(),
    decidedAt: iso(t.decidedAt),
  };
}

export function toListItem(r: ListRow | DetailRow): ReportListItem {
  return {
    id: r.id,
    caseNumber: r.caseNumber,
    status: r.status,
    publicStatus: publicStatusOf(r.status),
    priority: r.priority,
    channel: r.channel,
    kind: r.kind,
    type: typeRef(r.requestType),
    category: categoryRef(r.category),
    department: departmentRef(r.department),
    neighbourhood: r.neighbourhood?.name ?? null,
    address: r.address,
    aiSummary: r.aiSummary,
    assignedTo: personRef(r.assignedTo),
    supporters: r.supportersCount,
    dueAt: iso(r.dueAt),
    overdue: isOverdue(r),
    transferPending: r.transfers.some((t) => !('status' in t) || t.status === 'PENDING'),
    isTest: r.isTest,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function allowedStatusesFor(user: Principal, r: { status: Status; departmentId: number | null }): Status[] {
  if (isAdmin(user)) return ADMIN_SETTABLE_STATUSES.filter((s) => s !== r.status);
  if (!canAccessReport(user, r)) return [];
  return [...STATUS_TRANSITIONS[r.status]];
}

function toAttachment(a: AttachmentRow) {
  return { id: a.id, kind: a.kind, isPublic: a.isPublic, url: staffPhotoUrl(a), width: a.width, height: a.height, createdAt: a.createdAt.toISOString() };
}

export function toDetail(r: DetailRow, user: Principal, events: EventRow[]): ReportDetail {
  const admin = isAdmin(user);
  const own = canAccessReport(user, r);
  const final = FINAL_STATUSES.includes(r.status);
  const allowedStatuses = allowedStatusesFor(user, r);
  const transfers = r.transfers.map(toTransferSummary);
  const pendingTransfer = transfers.find((t) => t.status === 'PENDING') ?? null;
  return {
    ...toListItem(r),
    transferPending: Boolean(pendingTransfer),
    description: r.description,
    latitude: r.latitude,
    longitude: r.longitude,
    locationApproximate: r.locationApproximate,
    neighbourhoodId: r.neighbourhoodId,
    departmentId: r.departmentId,
    requestTypeId: r.requestTypeId,
    anonymous: r.anonymous,
    contact: { name: r.contactName, email: r.contactEmail, phone: r.contactPhone, wantsUpdates: r.wantsUpdates },
    ai: {
      status: r.aiStatus,
      summary: r.aiSummary,
      confidence: r.aiConfidence,
      privacyIssue: r.aiPrivacyIssue,
      suggestedType: typeRef(r.aiSuggestedType),
      suggestedPriority: r.aiSuggestedPriority,
      reason: r.aiReason,
      closingFixed: r.closingAiFixed,
      closingConfidence: r.closingAiConfidence,
    },
    rejectionReason: r.rejectionReason,
    closingNote: r.closingNote,
    citizenRating: r.citizenRating,
    citizenComment: r.citizenComment,
    reopenCount: r.reopenCount,
    verifiedAt: iso(r.verifiedAt),
    resolvedAt: iso(r.resolvedAt),
    closedAt: iso(r.closedAt),
    createdBy: personRef(r.createdBy),
    allowedStatuses,
    permissions: {
      canEditDetails: admin,
      canChangeStatus: allowedStatuses.length > 0,
      canSetAnyStatus: admin,
      canAssign: (admin || own) && !final,
      canChangePriority: (admin || own) && !final,
      canRequestTransfer: !admin && own && !final && !pendingTransfer,
      canResolve: allowedStatuses.includes('RESOLVED'),
      canReject: allowedStatuses.includes('REJECTED'),
      canDelete: admin,
    },
    pendingTransfer,
    transfers,
    attachments: r.attachments.map(toAttachment),
    events: events.map((e) => ({
      id: String(e.id),
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      message: e.message,
      isPublic: e.isPublic,
      actor: personRef(e.actor),
      meta: (e.meta as Record<string, unknown> | null) ?? null,
      at: e.createdAt.toISOString(),
    })),
  };
}
