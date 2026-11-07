/**
 * /admin/reports — the report list of the municipal panel (Server Component).
 *
 * Security, in this order:
 *  1. proxy.ts already refused anyone without a session of role
 *     MUNICIPALITY_STAFF or ADMIN (redirect to /hyrje).
 *  2. pageStaff() checks the account again in the database: active, same
 *     session version, permanent password. Role and department always come
 *     from the database, never from the browser.
 *  3. Every value in the address is validated with Zod (reportListSchema):
 *     unknown statuses, priorities, sorts or page sizes are dropped, so the
 *     query never receives anything outside the allowed values.
 *  4. The service applies the department scope in SQL (reportScope): a
 *     department head only ever gets their own department's reports, even
 *     if they type ?departmentId=… for another department.
 *
 * The page reads straight from the database (Prisma), so the list is always
 * current; every Server Action that changes a report revalidates /admin.
 */
import type { Metadata } from 'next';
import Board, { type BoardFilters } from '@/components/panel/Board';
import ReportList, { type ReportListView } from '@/components/panel/ReportList';
import { getT } from '@/i18n/server';
import { PANEL_INCLUDES_DEMO, flatParams, pageStaff } from '@/lib/server/pageData';
import { boardCounts, reportBoard } from '@/lib/server/services/board';
import { listReports, priorityCounts, statusCounts } from '@/lib/server/services/report';
import { PRIORITIES, type Priority } from '@/lib/shared/domain';
import { REPORT_SORTS, STATUS_VIEWS, isBoardBucket, isStatusView, type BoardBucket, type ReportSort } from '@/lib/shared/reportViews';
import type { Board as BoardData, Paged, Principal, ReportListItem } from '@/lib/shared/types';
import { boardSchema, reportListSchema } from '@/lib/validation/report';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.reports') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The admin sees the board (reports split by where they are: Të reja, Dërguar, Kthyer, Në punë,
 * Zgjidhur, Refuzuar). Without a column in the address it opens the first one that holds reports,
 * in the order the admin works them.
 */
async function adminBoard(principal: Principal, params: Record<string, string | undefined>) {
  const filters: BoardFilters = {
    departmentId: /^\d{1,9}$/.test(params.departmentId ?? '') ? Number(params.departmentId) : null,
    priority: (PRIORITIES as readonly string[]).includes(params.priority ?? '') ? (params.priority as Priority) : null,
    overdue: params.overdue === '1',
    q: (params.q ?? '').slice(0, 100),
  };
  const base = {
    departmentId: filters.departmentId ?? undefined, priority: filters.priority ?? undefined, overdue: filters.overdue || undefined,
    q: filters.q || undefined, includeTest: PANEL_INCLUDES_DEMO,
  };
  let data: BoardData | null = null;
  try {
    let bucket: BoardBucket;
    if (isBoardBucket(params.tab)) bucket = params.tab;
    else {
      const counts = await boardCounts(principal, base);
      bucket = (['new', 'returned', 'sent', 'working'] as const).find((b) => counts[b] > 0) ?? 'new';
    }
    data = await reportBoard(principal, boardSchema.parse({ ...base, bucket, page: params.page ?? '1' }));
  } catch (err) {
    console.error('[reports] board failed', err);
  }
  return <Board data={data} filters={filters} />;
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await pageStaff('/admin/reports');
  const admin = principal.role === 'ADMIN';
  const params = flatParams(await searchParams);
  if (admin) return adminBoard(principal, params);

  // Only known values survive; anything else falls back to the default view.
  const view = isStatusView(params.status) ? params.status : 'open';
  const priority = (PRIORITIES as readonly string[]).includes(params.priority ?? '') ? (params.priority as Priority) : null;
  const sort: ReportSort = (REPORT_SORTS as readonly string[]).includes(params.sort ?? '') ? (params.sort as ReportSort) : 'priority';
  const departmentId = admin && /^\d{1,9}$/.test(params.departmentId ?? '') ? Number(params.departmentId) : null;
  const unrouted = admin && !departmentId && params.unrouted === '1';
  const includeTest = PANEL_INCLUDES_DEMO;

  const filters = {
    status: STATUS_VIEWS[view],
    priority: priority ?? undefined,
    departmentId: departmentId ?? undefined,
    unrouted: unrouted || undefined,
    overdue: params.overdue === '1' || undefined,
    assignedToMe: (!admin && params.assignedToMe === '1') || undefined,
    transferPending: params.transferPending === '1' || undefined,
    includeTest,
    q: params.q?.slice(0, 100),
  };
  const parsed = reportListSchema.safeParse({ ...filters, sort, page: params.page ?? '1', pageSize: '25' });
  const query = parsed.success ? parsed.data : reportListSchema.parse({ status: 'open', includeTest });

  let data: Paged<ReportListItem> | null = null;
  let counts: Awaited<ReturnType<typeof priorityCounts>> | null = null;
  let byStatus: Awaited<ReturnType<typeof statusCounts>> | null = null;
  try {
    [data, counts, byStatus] = await Promise.all([listReports(principal, query), priorityCounts(principal, query), statusCounts(principal, query)]);
  } catch (err) {
    console.error('[reports] list failed', err);
  }

  // The CSV export receives exactly the same (validated) filters.
  const exportQuery = new URLSearchParams();
  exportQuery.set('status', STATUS_VIEWS[view]);
  if (query.priority) exportQuery.set('priority', query.priority);
  if (query.departmentId) exportQuery.set('departmentId', String(query.departmentId));
  if (query.unrouted) exportQuery.set('unrouted', '1');
  if (query.overdue) exportQuery.set('overdue', '1');
  if (query.assignedToMe) exportQuery.set('assignedToMe', '1');
  if (query.transferPending) exportQuery.set('transferPending', '1');
  if (query.includeTest) exportQuery.set('includeTest', '1');
  if (query.q) exportQuery.set('q', query.q);

  const listView: ReportListView = {
    scope: !admin ? 'own' : query.departmentId ? 'department' : query.unrouted ? 'unrouted' : 'all',
    departmentId: query.departmentId ?? null,
    view,
    priority: query.priority ?? null,
    sort: query.sort,
    q: query.q ?? '',
    overdue: Boolean(query.overdue),
    assignedToMe: Boolean(query.assignedToMe),
    transferPending: Boolean(query.transferPending),
    exportQuery: exportQuery.toString(),
  };
  return <ReportList principal={principal} view={listView} data={data} counts={counts} statusCounts={byStatus} />;
}
