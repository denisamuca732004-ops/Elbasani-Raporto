/**
 * Public statistics (the "Statistikat" page, cached for 5 minutes) and the
 * CSV export for staff. Demo reports are never counted in public numbers.
 * Months are counted in Albanian time (Europe/Tirane).
 */
import 'server-only';
import { OPEN_STATUSES, publicStatusOf, type Priority, type Status } from '@/lib/shared/domain';
import type { Principal } from '@/lib/shared/types';
import type { ExportQuery } from '@/lib/validation/report';
import { CACHE_KEYS, cached } from '../cache';
import { toCsv } from '../csv';
import { Prisma, db } from '../db';
import { config } from '../env';
import { PRIORITY_SQ } from '../mailTemplates';
import { isAdmin } from './access';

const num = (v: unknown, digits = 1): number | null => (v === null || v === undefined ? null : Number(Number(v).toFixed(digits)));
const OPEN_SQL = Prisma.raw(`(${OPEN_STATUSES.map((s) => `'${s}'`).join(',')})`);

export interface PublicStats {
  totals: { total: number; open: number; resolved: number; avgDaysToResolve: number | null; onTimePct: number | null };
  months: Array<{ month: string; received: number; resolved: number; avgDaysToResolve: number | null }>;
  byCategory: Array<{ code: string; nameSq: string; nameEn: string; total: number; resolved: number }>;
}

export async function publicStats(): Promise<PublicStats> {
  return cached(CACHE_KEYS.publicStats, 300, async () => {
    const tz = config().rules.timezone;
    const [months, totalsRows, byCategory] = await Promise.all([
      db.$queryRaw<Array<{ month: string; received: number; resolved: number; avg_days: number | null }>>`
        WITH m AS (
          SELECT generate_series(date_trunc('month', now() AT TIME ZONE ${tz}::text) - interval '11 months',
                                 date_trunc('month', now() AT TIME ZONE ${tz}::text), interval '1 month') AS month
        )
        SELECT to_char(m.month, 'YYYY-MM') AS month,
               (SELECT count(*) FROM reports r WHERE r.is_test = false
                  AND date_trunc('month', r.created_at AT TIME ZONE ${tz}::text) = m.month)::int AS received,
               (SELECT count(*) FROM reports r WHERE r.is_test = false AND r.resolved_at IS NOT NULL
                  AND date_trunc('month', r.resolved_at AT TIME ZONE ${tz}::text) = m.month)::int AS resolved,
               (SELECT avg(extract(epoch FROM (r.resolved_at - r.created_at)) / 86400) FROM reports r
                  WHERE r.is_test = false AND r.resolved_at IS NOT NULL
                  AND date_trunc('month', r.resolved_at AT TIME ZONE ${tz}::text) = m.month)::float8 AS avg_days
        FROM m ORDER BY m.month`,
      db.$queryRaw<Array<{ total: number; open: number; resolved: number; avg_days: number | null; on_time_pct: number | null }>>`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status IN ('VERIFIED', 'ASSIGNED', 'IN_PROGRESS'))::int AS open,
               count(*) FILTER (WHERE status IN ('RESOLVED', 'CLOSED'))::int AS resolved,
               (avg(extract(epoch FROM (resolved_at - created_at)) / 86400) FILTER (WHERE resolved_at IS NOT NULL))::float8 AS avg_days,
               (100.0 * count(*) FILTER (WHERE resolved_at IS NOT NULL AND resolved_at <= due_at)
                  / NULLIF(count(*) FILTER (WHERE resolved_at IS NOT NULL), 0))::float8 AS on_time_pct
        FROM reports WHERE is_test = false`,
      db.$queryRaw<Array<{ code: string; nameSq: string; nameEn: string; total: number; resolved: number }>>`
        SELECT c.code, c.name_sq AS "nameSq", c.name_en AS "nameEn",
               count(r.id)::int AS total,
               count(r.id) FILTER (WHERE r.status IN ('RESOLVED', 'CLOSED'))::int AS resolved
        FROM categories c LEFT JOIN reports r ON r.category_id = c.id AND r.is_test = false
        WHERE c.active = true
        GROUP BY c.id ORDER BY total DESC, c.sort_order`,
    ]);
    const totals = totalsRows[0];
    return {
      totals: {
        total: totals?.total ?? 0,
        open: totals?.open ?? 0,
        resolved: totals?.resolved ?? 0,
        avgDaysToResolve: num(totals?.avg_days),
        onTimePct: num(totals?.on_time_pct, 0),
      },
      months: months.map((m) => ({ month: m.month, received: m.received, resolved: m.resolved, avgDaysToResolve: num(m.avg_days) })),
      byCategory,
    };
  });
}

interface ExportRow {
  case_number: string; created_at: Date; status: Status; priority: Priority; channel: string; kind: string;
  category: string; type: string; department: string | null; area: string | null; address: string | null;
  latitude: number | null; longitude: number | null; ai_summary: string | null; due_at: Date | null;
  resolved_at: Date | null; closed_at: Date | null; citizen_rating: number | null; supporters_count: number;
  is_test: boolean; overdue: boolean; transfer_pending: boolean;
}

/** CSV for Excel. The admin can export everything; a department head only their department. */
export async function exportCsv(user: Principal, query: ExportQuery): Promise<string> {
  const tz = config().rules.timezone;
  const clauses: Prisma.Sql[] = [];
  if (!query.includeTest) clauses.push(Prisma.sql`r.is_test = false`);
  if (query.from) clauses.push(Prisma.sql`r.created_at >= (CAST(${query.from}::text AS date)::timestamp AT TIME ZONE ${tz}::text)`);
  if (query.to) clauses.push(Prisma.sql`r.created_at < ((CAST(${query.to}::text AS date) + 1)::timestamp AT TIME ZONE ${tz}::text)`);
  const departmentId = isAdmin(user) ? query.departmentId : (user.departmentId ?? -1);
  if (departmentId) clauses.push(Prisma.sql`r.department_id = ${departmentId}::int`);
  else if (isAdmin(user) && query.unrouted) clauses.push(Prisma.sql`r.department_id IS NULL`);
  if (query.status?.length) clauses.push(Prisma.sql`r.status::text IN (${Prisma.join(query.status)})`);
  if (query.priority) clauses.push(Prisma.sql`r.priority::text = ${query.priority}`);
  if (query.categoryId) clauses.push(Prisma.sql`r.category_id = ${query.categoryId}::int`);
  if (query.neighbourhoodId) clauses.push(Prisma.sql`r.neighbourhood_id = ${query.neighbourhoodId}::int`);
  if (query.overdue) clauses.push(Prisma.sql`r.status IN ${OPEN_SQL} AND r.due_at < now()`);
  if (query.assignedToMe) clauses.push(Prisma.sql`r.assigned_to_id = ${user.id}::uuid`);
  if (query.transferPending) clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM department_transfers dt WHERE dt.report_id = r.id AND dt.status = 'PENDING')`);
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    clauses.push(Prisma.sql`(r.case_number ILIKE ${like} OR r.address ILIKE ${like} OR r.description ILIKE ${like} OR r.ai_summary ILIKE ${like})`);
  }
  const where = clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}` : Prisma.empty;
  const rows = await db.$queryRaw<ExportRow[]>`
    SELECT r.case_number, r.created_at, r.status::text AS status, r.priority::text AS priority, r.channel::text AS channel, r.kind::text AS kind,
           c.name_sq AS category, t.name_sq AS type, d.name_sq AS department, n.name AS area,
           r.address, r.latitude, r.longitude, r.ai_summary, r.due_at, r.resolved_at, r.closed_at,
           r.citizen_rating, r.supporters_count, r.is_test,
           (r.status IN ${OPEN_SQL} AND r.due_at < now()) AS overdue,
           EXISTS (SELECT 1 FROM department_transfers dt WHERE dt.report_id = r.id AND dt.status = 'PENDING') AS transfer_pending
    FROM reports r
    JOIN categories c ON c.id = r.category_id
    JOIN request_types t ON t.id = r.request_type_id
    LEFT JOIN departments d ON d.id = r.department_id
    LEFT JOIN neighbourhoods n ON n.id = r.neighbourhood_id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 50000`;

  return toCsv<ExportRow>([
    { label: 'Numri', value: (r) => r.case_number },
    { label: 'Data', value: (r) => r.created_at },
    { label: 'Statusi', value: (r) => r.status },
    { label: 'Statusi publik', value: (r) => publicStatusOf(r.status) },
    { label: 'Prioriteti', value: (r) => PRIORITY_SQ[r.priority] },
    { label: 'Kanali', value: (r) => r.channel },
    { label: 'Lloji', value: (r) => r.kind },
    { label: 'Kategoria', value: (r) => r.category },
    { label: 'Raportimi', value: (r) => r.type },
    { label: 'Sektori', value: (r) => r.department ?? 'Pa sektor' },
    { label: 'Zona', value: (r) => r.area },
    { label: 'Adresa', value: (r) => r.address },
    { label: 'Latitude', value: (r) => r.latitude },
    { label: 'Longitude', value: (r) => r.longitude },
    { label: 'Përmbledhje', value: (r) => r.ai_summary },
    { label: 'Afati', value: (r) => r.due_at },
    { label: 'Me vonesë', value: (r) => (r.overdue ? 'po' : 'jo') },
    { label: 'Rishikim në pritje', value: (r) => (r.transfer_pending ? 'po' : 'jo') },
    { label: 'Zgjidhur më', value: (r) => r.resolved_at },
    { label: 'Mbyllur më', value: (r) => r.closed_at },
    { label: 'Vlerësimi', value: (r) => r.citizen_rating },
    { label: 'Mbështetës', value: (r) => r.supporters_count },
    { label: 'Test', value: (r) => (r.is_test ? 'po' : 'jo') },
  ], rows);
}
