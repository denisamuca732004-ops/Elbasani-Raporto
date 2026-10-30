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
import ReportList, { type ReportListView } from '@/components/panel/ReportList';
import { getT } from '@/i18n/server';
import { flatParams, pageStaff } from '@/lib/server/pageData';
import { includeTestFromCookie } from '@/lib/server/panel';
import { listReports, priorityCounts, statusCounts } from '@/lib/server/services/report';
import { PRIORITIES, type Priority } from '@/lib/shared/domain';
import { REPORT_SORTS, STATUS_VIEWS, isStatusView, type ReportSort } from '@/lib/shared/reportViews';
import type { Paged, ReportListItem } from '@/lib/shared/types';
import { reportListSchema } from '@/lib/validation/report';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.reports') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await pageStaff('/admin/reports');
  const admin = principal.role === 'ADMIN';
  const params = flatParams(await searchParams);

  // Only known values survive; anything else falls back to the default view.
  const view = isStatusView(params.status) ? params.status : 'open';
  const priority = (PRIORITIES as readonly string[]).includes(params.priority ?? '') ? (params.priority as Priority) : null;
  const sort: ReportSort = (REPORT_SORTS as readonly string[]).includes(params.sort ?? '') ? (params.sort as ReportSort) : 'priority';
  const departmentId = admin && /^\d{1,9}$/.test(params.departmentId ?? '') ? Number(params.departmentId) : null;
  const unrouted = admin && !departmentId && params.unrouted === '1';
  const includeTest = await includeTestFromCookie();

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
