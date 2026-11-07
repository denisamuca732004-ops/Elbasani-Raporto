/**
 * The admin's board (/admin/reports): every report in one column, as it goes from the resident to
 * the sector and back (lib/shared/reportViews.ts, BOARD_BUCKETS):
 *   new → sent → working → resolved, and returned (the sector cannot handle it) / rejected.
 * Sectors work only by e-mail, so "sent" means: the report's e-mail link is working (not revoked).
 */
import 'server-only';
import type { Status } from '@/lib/shared/domain';
import { BOARD_BUCKETS, type BoardBucket } from '@/lib/shared/reportViews';
import type { Board, BoardItem, Principal } from '@/lib/shared/types';
import type { BoardQuery, ReportFilters } from '@/lib/validation/report';
import { db, type Prisma } from '../db';
import { assertAdmin } from './access';
import { listInclude, toListItem, toTransferSummary, transferInclude, type ListRow } from './mapper';
import { buildWhere } from './report';
import { SECTOR_TEMPLATES, mailStatusOf } from './sectorMail';

const WAITING: Status[] = ['PENDING', 'NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED'];

const PENDING_TRANSFER = { some: { status: 'PENDING' as const } };
const NO_PENDING_TRANSFER = { none: { status: 'PENDING' as const } };

export function bucketWhere(bucket: BoardBucket): Prisma.ReportWhereInput {
  switch (bucket) {
    case 'new': return { status: { in: WAITING }, transfers: NO_PENDING_TRANSFER, links: { none: { revokedAt: null } } };
    case 'sent': return { status: { in: WAITING }, transfers: NO_PENDING_TRANSFER, links: { some: { revokedAt: null } } };
    case 'returned': return { status: { notIn: ['RESOLVED', 'CLOSED', 'REJECTED'] }, transfers: PENDING_TRANSFER };
    case 'working': return { status: 'IN_PROGRESS', transfers: NO_PENDING_TRANSFER };
    case 'resolved': return { status: { in: ['RESOLVED', 'CLOSED'] } };
    case 'rejected': return { status: 'REJECTED' };
  }
}

function orderFor(bucket: BoardBucket): Prisma.ReportOrderByWithRelationInput[] {
  if (bucket === 'resolved') return [{ resolvedAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }];
  if (bucket === 'rejected') return [{ updatedAt: 'desc' }, { id: 'asc' }];
  // Waiting and in work: high priority first (it needs action at once), then the oldest (first in, first out).
  return [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }];
}

const boardInclude = {
  ...listInclude,
  links: { where: { revokedAt: null }, orderBy: { sentAt: 'desc' }, take: 1 },
  transfers: { where: { status: 'PENDING' }, include: transferInclude },
  emails: { where: { template: { in: [...SECTOR_TEMPLATES] } }, orderBy: { id: 'desc' }, take: 1, select: { status: true, createdAt: true, sentAt: true, error: true } },
  events: { where: { toStatus: 'IN_PROGRESS' }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
} satisfies Prisma.ReportInclude;
type BoardRow = Prisma.ReportGetPayload<{ include: typeof boardInclude }>;

function toBoardItem(r: BoardRow): BoardItem {
  const link = r.links[0];
  const transfer = r.transfers[0];
  return {
    ...toListItem(r as unknown as ListRow),
    departmentEmail: r.department?.email ?? null,
    sent: link ? {
      email: link.email, sentAt: link.sentAt.toISOString(), remindedAt: link.remindedAt?.toISOString() ?? null,
      lastUsedAt: link.lastUsedAt?.toISOString() ?? null, expiresAt: link.expiresAt.toISOString(),
    } : null,
    returned: transfer ? toTransferSummary(transfer) : null,
    mail: mailStatusOf(r.emails[0]),
    acceptedAt: r.events[0]?.createdAt.toISOString() ?? null,
    closingNote: r.closingNote,
    rejectionReason: r.rejectionReason,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
  };
}

/** The filters every column shares (sector, priority, overdue, search, demo reports). */
function sharedWhere(user: Principal, q: Partial<BoardQuery>): Prisma.ReportWhereInput {
  return buildWhere(user, {
    includeTest: q.includeTest, departmentId: q.departmentId, priority: q.priority, overdue: q.overdue, q: q.q,
  } as ReportFilters);
}

/** How many reports each column holds, with the same filters. */
export async function boardCounts(user: Principal, q: Partial<BoardQuery> = {}): Promise<Record<BoardBucket, number>> {
  const base = sharedWhere(user, q);
  const counts = await Promise.all(BOARD_BUCKETS.map((b) => db.report.count({ where: { AND: [base, bucketWhere(b)] } })));
  return Object.fromEntries(BOARD_BUCKETS.map((b, i) => [b, counts[i]])) as Record<BoardBucket, number>;
}

export async function reportBoard(user: Principal, query: BoardQuery): Promise<Board> {
  assertAdmin(user);
  const where = { AND: [sharedWhere(user, query), bucketWhere(query.bucket)] };
  const [rows, total, counts, priorities] = await Promise.all([
    db.report.findMany({ where, include: boardInclude, orderBy: orderFor(query.bucket), take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
    db.report.count({ where }),
    boardCounts(user, query),
    db.report.groupBy({ by: ['priority'], where, _count: { _all: true } }),
  ]);
  const byPriority = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<string, number>;
  for (const p of priorities) byPriority[p.priority] = p._count._all;
  return {
    bucket: query.bucket, counts, byPriority, items: rows.map(toBoardItem), total, page: query.page,
    pages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
