/**
 * Dashboard statistics for a week, a month or a year, in Albanian time.
 *   week  = today and the 6 days before   (7 daily columns)
 *   month = today and the 29 days before  (30 daily columns)
 *   year  = this month and the 11 before  (12 monthly columns)
 * Each period is compared with the period of the same length just before it.
 * The admin sees the whole municipality (or one department); a department
 * head only ever sees their own department.
 *
 * The SQL is written by hand for speed, with Prisma.sql: every value is a
 * bound parameter, never pasted into the query text.
 */
import 'server-only';
import { OPEN_STATUSES, type DashboardPeriod, type Priority, type Status } from '@/lib/shared/domain';
import type { NamedRef, Principal } from '@/lib/shared/types';
import type { DashboardQuery } from '@/lib/validation/report';
import { Prisma, db } from '../db';
import { config } from '../env';
import { isAdmin } from './access';
import { departmentRef } from './mapper';
import { pendingTransferCount } from './transfer';

const PERIODS: Record<DashboardPeriod, { unit: 'day' | 'month'; count: number; step: string }> = {
  week: { unit: 'day', count: 7, step: '1 day' },
  month: { unit: 'day', count: 30, step: '1 day' },
  year: { unit: 'month', count: 12, step: '1 month' },
};

/** Fixed list from the code (not user input), so it can be part of the query text. */
const OPEN_SQL = Prisma.raw(`(${OPEN_STATUSES.map((s) => `'${s}'`).join(',')})`);

const num = (v: unknown, digits = 1): number | null => (v === null || v === undefined ? null : Number(Number(v).toFixed(digits)));
const int = (v: unknown): number => Number(v ?? 0);

/** Start and end of the current and the previous period, computed in Tirana time (CTEs b and w). */
function windowCteFor(period: DashboardPeriod): Prisma.Sql {
  const spec = PERIODS[period];
  const tz = config().rules.timezone;
  return Prisma.sql`
    b AS (
      SELECT date_trunc(${spec.unit}::text, now() AT TIME ZONE ${tz}::text) - (${spec.count}::int - 1) * CAST(${spec.step}::text AS interval) AS from_local,
             date_trunc(${spec.unit}::text, now() AT TIME ZONE ${tz}::text) + CAST(${spec.step}::text AS interval) AS to_local
    ),
    w AS (
      SELECT (b.from_local AT TIME ZONE ${tz}::text) AS t0,
             (b.to_local AT TIME ZONE ${tz}::text) AS t1,
             ((b.from_local - ${spec.count}::int * CAST(${spec.step}::text AS interval)) AT TIME ZONE ${tz}::text) AS p0
      FROM b
    )`;
}

export type SectorRow = {
  id: number | null; code: string | null; nameSq: string | null; nameEn: string | null;
  /** total: every report of the sector, any status, any date (the number on its card). */
  total: number; received: number; resolved: number; open: number; overdue: number; openHigh: number;
};

/**
 * One row per sector (active, or with open reports), plus one for the reports
 * without a sector when there are any: the admin's sector cards. Admin only.
 */
export async function sectorRows(user: Principal, period: DashboardPeriod, includeTest = false): Promise<SectorRow[]> {
  if (!isAdmin(user)) return [];
  const windowCte = windowCteFor(period);
  const testFilter = includeTest ? Prisma.empty : Prisma.sql`AND r.is_test = false`;
  const inPeriod = (column: Prisma.Sql) => Prisma.sql`${column} >= w.t0 AND ${column} < w.t1`;
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
    WITH ${windowCte},
    agg AS (
      SELECT r.department_id,
        count(*)::int AS total,
        count(*) FILTER (WHERE ${inPeriod(Prisma.raw('r.created_at'))})::int AS received,
        count(*) FILTER (WHERE ${inPeriod(Prisma.raw('r.resolved_at'))})::int AS resolved,
        count(*) FILTER (WHERE r.status IN ${OPEN_SQL})::int AS open,
        count(*) FILTER (WHERE r.status IN ${OPEN_SQL} AND r.due_at < now())::int AS overdue,
        count(*) FILTER (WHERE r.status IN ${OPEN_SQL} AND r.priority = 'HIGH')::int AS open_high
      FROM reports r CROSS JOIN w
      WHERE TRUE ${testFilter}
      GROUP BY r.department_id
    )
    SELECT d.id, d.code, d.name_sq AS "nameSq", d.name_en AS "nameEn", coalesce(agg.total, 0)::int AS total,
           coalesce(agg.received, 0)::int AS received, coalesce(agg.resolved, 0)::int AS resolved,
           coalesce(agg.open, 0)::int AS open, coalesce(agg.overdue, 0)::int AS overdue, coalesce(agg.open_high, 0)::int AS open_high
    FROM departments d LEFT JOIN agg ON agg.department_id = d.id
    WHERE d.active = true OR coalesce(agg.open, 0) > 0
    UNION ALL
    SELECT NULL, NULL, NULL, NULL, total, received, resolved, open, overdue, open_high FROM agg WHERE agg.department_id IS NULL
    ORDER BY open DESC, received DESC, "nameSq" NULLS LAST`;
  return rows.map((r) => ({
    id: r.id === null || r.id === undefined ? null : Number(r.id),
    code: (r.code as string | null) ?? null,
    nameSq: (r.nameSq as string | null) ?? null,
    nameEn: (r.nameEn as string | null) ?? null,
    total: int(r.total), received: int(r.received), resolved: int(r.resolved), open: int(r.open), overdue: int(r.overdue), openHigh: int(r.open_high),
  }));
}

export interface DashboardResult {
  period: DashboardPeriod;
  unit: 'day' | 'month';
  range: { from: string; to: string; previousFrom: string };
  department: NamedRef | null;
  includeTest: boolean;
  totals: {
    received: number; resolved: number; rejected: number;
    receivedPrevious: number; resolvedPrevious: number;
    avgDaysToResolve: number | null; onTimePct: number | null; avgRating: number | null; ratings: number;
    openNow: number; overdueNow: number; waitingReviewNow: number;
  };
  openByPriority: Record<Priority, number>;
  receivedByPriority: Record<Priority, number>;
  trend: Array<{ bucket: string; received: number; resolved: number }>;
  byStatus: Array<{ status: Status; count: number }>;
  byCategory: Array<{ code: string; nameSq: string; nameEn: string; received: number; resolved: number }>;
  byNeighbourhood: Array<{ name: string; received: number }>;
  byDepartment: SectorRow[] | null;
  pendingTransfers: number;
}

export async function getDashboard(user: Principal, query: DashboardQuery): Promise<DashboardResult> {
  const period = query.period;
  const spec = PERIODS[period];
  const includeTest = Boolean(query.includeTest);
  const admin = isAdmin(user);
  const departmentId: number | null = admin ? (query.departmentId ?? null) : (user.departmentId ?? -1);
  const tz = config().rules.timezone;
  const windowCte = windowCteFor(period);
  const testFilter = includeTest ? Prisma.empty : Prisma.sql`AND r.is_test = false`;
  const departmentFilter = departmentId !== null ? Prisma.sql`AND r.department_id = ${departmentId}::int` : Prisma.empty;
  const base = Prisma.sql`${testFilter} ${departmentFilter}`;
  const inPeriod = (column: Prisma.Sql) => Prisma.sql`${column} >= w.t0 AND ${column} < w.t1`;
  const created = Prisma.raw('r.created_at');
  const resolvedAt = Prisma.raw('r.resolved_at');
  const closedAt = Prisma.raw('r.closed_at');

  const [totalsRows, trend, byStatus, byCategory, byNeighbourhood, windowRows] = await Promise.all([
    db.$queryRaw<Array<Record<string, unknown>>>`
      WITH ${windowCte}
      SELECT
        count(*) FILTER (WHERE ${inPeriod(created)})::int AS received,
        count(*) FILTER (WHERE r.created_at >= w.p0 AND r.created_at < w.t0)::int AS received_prev,
        count(*) FILTER (WHERE ${inPeriod(resolvedAt)})::int AS resolved,
        count(*) FILTER (WHERE r.resolved_at >= w.p0 AND r.resolved_at < w.t0)::int AS resolved_prev,
        count(*) FILTER (WHERE ${inPeriod(created)} AND r.status = 'REJECTED')::int AS rejected,
        avg(extract(epoch FROM (r.resolved_at - r.created_at)) / 86400) FILTER (WHERE ${inPeriod(resolvedAt)})::float8 AS avg_days,
        (100.0 * count(*) FILTER (WHERE ${inPeriod(resolvedAt)} AND r.resolved_at <= r.due_at)
          / NULLIF(count(*) FILTER (WHERE ${inPeriod(resolvedAt)}), 0))::float8 AS on_time_pct,
        avg(r.citizen_rating) FILTER (WHERE ${inPeriod(closedAt)})::float8 AS avg_rating,
        count(r.citizen_rating) FILTER (WHERE ${inPeriod(closedAt)})::int AS ratings,
        count(*) FILTER (WHERE r.status IN ${OPEN_SQL})::int AS open_now,
        count(*) FILTER (WHERE r.status IN ${OPEN_SQL} AND r.due_at < now())::int AS overdue_now,
        count(*) FILTER (WHERE r.status IN ('PENDING', 'NEEDS_REVIEW'))::int AS review_now,
        count(*) FILTER (WHERE r.status IN ${OPEN_SQL} AND r.priority = 'HIGH')::int AS open_high,
        count(*) FILTER (WHERE r.status IN ${OPEN_SQL} AND r.priority = 'MEDIUM')::int AS open_medium,
        count(*) FILTER (WHERE r.status IN ${OPEN_SQL} AND r.priority = 'LOW')::int AS open_low,
        count(*) FILTER (WHERE ${inPeriod(created)} AND r.priority = 'HIGH')::int AS rec_high,
        count(*) FILTER (WHERE ${inPeriod(created)} AND r.priority = 'MEDIUM')::int AS rec_medium,
        count(*) FILTER (WHERE ${inPeriod(created)} AND r.priority = 'LOW')::int AS rec_low
      FROM reports r CROSS JOIN w
      WHERE TRUE ${base}`,
    db.$queryRaw<Array<{ bucket: string; received: number; resolved: number }>>`
      WITH ${windowCte},
      s AS (SELECT generate_series(b.from_local, b.to_local - CAST(${spec.step}::text AS interval), CAST(${spec.step}::text AS interval)) AS bucket FROM b),
      rc AS (
        SELECT date_trunc(${spec.unit}::text, r.created_at AT TIME ZONE ${tz}::text) AS bucket, count(*)::int AS n
        FROM reports r CROSS JOIN w WHERE ${inPeriod(created)} ${base} GROUP BY 1
      ),
      rs AS (
        SELECT date_trunc(${spec.unit}::text, r.resolved_at AT TIME ZONE ${tz}::text) AS bucket, count(*)::int AS n
        FROM reports r CROSS JOIN w WHERE ${inPeriod(resolvedAt)} ${base} GROUP BY 1
      )
      SELECT to_char(s.bucket, 'YYYY-MM-DD') AS bucket, coalesce(rc.n, 0)::int AS received, coalesce(rs.n, 0)::int AS resolved
      FROM s LEFT JOIN rc ON rc.bucket = s.bucket LEFT JOIN rs ON rs.bucket = s.bucket
      ORDER BY s.bucket`,
    db.$queryRaw<Array<{ status: Status; count: number }>>`
      WITH ${windowCte}
      SELECT r.status::text AS status, count(*)::int AS count
      FROM reports r CROSS JOIN w
      WHERE ${inPeriod(created)} ${base}
      GROUP BY r.status`,
    db.$queryRaw<Array<{ code: string; nameSq: string; nameEn: string; received: number; resolved: number }>>`
      WITH ${windowCte}
      SELECT c.code, c.name_sq AS "nameSq", c.name_en AS "nameEn", count(r.id)::int AS received,
             count(r.id) FILTER (WHERE r.status IN ('RESOLVED', 'CLOSED'))::int AS resolved
      FROM reports r JOIN categories c ON c.id = r.category_id CROSS JOIN w
      WHERE ${inPeriod(created)} ${base}
      GROUP BY c.id, c.code, c.name_sq, c.name_en
      ORDER BY received DESC, c.name_sq
      LIMIT 10`,
    db.$queryRaw<Array<{ name: string; received: number }>>`
      WITH ${windowCte}
      SELECT coalesce(n.name, 'Pa zonë') AS name, count(r.id)::int AS received
      FROM reports r LEFT JOIN neighbourhoods n ON n.id = r.neighbourhood_id CROSS JOIN w
      WHERE ${inPeriod(created)} ${base}
      GROUP BY n.id, n.name
      ORDER BY received DESC, name
      LIMIT 8`,
    db.$queryRaw<Array<{ t0: Date; t1: Date; p0: Date }>>`WITH ${windowCte} SELECT t0, t1, p0 FROM w`,
  ]);

  const byDepartment = admin && departmentId === null ? await sectorRows(user, period, includeTest) : null;

  const t = totalsRows[0] ?? {};
  const win = windowRows[0]!;
  const department = departmentId !== null && departmentId > 0 ? await db.department.findUnique({ where: { id: departmentId } }) : null;
  const pendingTransfers = admin && departmentId !== null
    ? await db.departmentTransfer.count({ where: { status: 'PENDING', fromDepartmentId: departmentId } })
    : await pendingTransferCount(user);

  return {
    period,
    unit: spec.unit,
    range: { from: new Date(win.t0).toISOString(), to: new Date(win.t1).toISOString(), previousFrom: new Date(win.p0).toISOString() },
    department: departmentRef(department),
    includeTest,
    totals: {
      received: int(t.received),
      resolved: int(t.resolved),
      rejected: int(t.rejected),
      receivedPrevious: int(t.received_prev),
      resolvedPrevious: int(t.resolved_prev),
      avgDaysToResolve: num(t.avg_days),
      onTimePct: num(t.on_time_pct, 0),
      avgRating: num(t.avg_rating),
      ratings: int(t.ratings),
      openNow: int(t.open_now),
      overdueNow: int(t.overdue_now),
      waitingReviewNow: int(t.review_now),
    },
    openByPriority: { HIGH: int(t.open_high), MEDIUM: int(t.open_medium), LOW: int(t.open_low) },
    receivedByPriority: { HIGH: int(t.rec_high), MEDIUM: int(t.rec_medium), LOW: int(t.rec_low) },
    trend: trend.map((r) => ({ bucket: r.bucket, received: int(r.received), resolved: int(r.resolved) })),
    byStatus: byStatus.map((r) => ({ status: r.status, count: int(r.count) })),
    byCategory: byCategory.map((r) => ({ ...r, received: int(r.received), resolved: int(r.resolved) })),
    byNeighbourhood: byNeighbourhood.map((r) => ({ name: r.name, received: int(r.received) })),
    byDepartment,
    pendingTransfers,
  };
}

export interface SidebarCounts {
  role: Principal['role'];
  openTotal: number;
  highTotal: number;
  pendingTransfers: number;
  unrouted?: number;
  departments?: Array<NamedRef & { open: number; high: number }>;
  assignedToMe?: number;
}

/** Small numbers for the left menu: open reports per department, high priority, requests waiting. */
export async function sidebarCounts(user: Principal, includeTest = false): Promise<SidebarCounts> {
  const testFilter = includeTest ? Prisma.empty : Prisma.sql`AND r.is_test = false`;
  const pendingTransfers = await pendingTransferCount(user);
  if (isAdmin(user)) {
    const [rows, departments] = await Promise.all([
      db.$queryRaw<Array<{ department_id: number | null; open: number; high: number }>>`
        SELECT r.department_id, count(*)::int AS open, count(*) FILTER (WHERE r.priority = 'HIGH')::int AS high
        FROM reports r WHERE r.status IN ${OPEN_SQL} ${testFilter} GROUP BY r.department_id`,
      db.department.findMany({ where: { active: true }, orderBy: { nameSq: 'asc' } }),
    ]);
    const byDepartment = new Map(rows.map((r) => [r.department_id === null ? null : Number(r.department_id), r]));
    return {
      role: user.role,
      openTotal: rows.reduce((acc, r) => acc + int(r.open), 0),
      highTotal: rows.reduce((acc, r) => acc + int(r.high), 0),
      unrouted: int(byDepartment.get(null)?.open),
      departments: departments.map((d) => ({
        id: d.id, code: d.code, nameSq: d.nameSq, nameEn: d.nameEn,
        open: int(byDepartment.get(d.id)?.open), high: int(byDepartment.get(d.id)?.high),
      })),
      pendingTransfers,
    };
  }
  const [row] = await db.$queryRaw<Array<{ open: number; high: number; mine: number }>>`
    SELECT count(*)::int AS open,
           count(*) FILTER (WHERE r.priority = 'HIGH')::int AS high,
           count(*) FILTER (WHERE r.assigned_to_id = ${user.id}::uuid)::int AS mine
    FROM reports r WHERE r.status IN ${OPEN_SQL} AND r.department_id = ${user.departmentId ?? -1}::int ${testFilter}`;
  return {
    role: user.role,
    openTotal: int(row?.open),
    highTotal: int(row?.high),
    assignedToMe: int(row?.mine),
    pendingTransfers,
  };
}
