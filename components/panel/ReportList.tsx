'use client';
/**
 * List of reports, split by priority (High / Medium / Low) with a tab each.
 * Used for: all reports (admin), one department (admin), reports without a
 * department (admin) and the own department (department head). The data
 * comes from the server page; filters live in the address, so the back
 * button and shared links return to the same view.
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import {
  EmptyState, InternalStatusBadge, OverdueBadge, Pagination, PriorityBadge, Segmented, TestBadge, TransferBadge,
} from '@/components/ui';
import { useI18n } from '@/i18n';
import { departmentName, formatDate, key, timeAgo, typeName } from '@/lib/client/format';
import type { Priority, Status } from '@/lib/shared/domain';
import { REPORT_SORTS, STATUS_VIEW_NAMES, viewCount, type ReportSort, type StatusView } from '@/lib/shared/reportViews';
import type { Paged, Principal, ReportListItem } from '@/lib/shared/types';

export interface ReportListView {
  scope: 'all' | 'department' | 'unrouted' | 'own';
  departmentId: number | null;
  view: StatusView;
  priority: Priority | null;
  sort: ReportSort;
  q: string;
  overdue: boolean;
  assignedToMe: boolean;
  transferPending: boolean;
  /** Query string for the CSV export with the same filters. */
  exportQuery: string;
}

export default function ReportList({ principal, view, data, counts, statusCounts }: {
  principal: Principal;
  view: ReportListView;
  data: Paged<ReportListItem> | null;
  counts: (Record<Priority, number> & { total: number }) | null;
  /** How many reports of each status (the other filters applied): the numbers on the status tabs. */
  statusCounts: Partial<Record<Status, number>> | null;
}) {
  const { t, lang } = useI18n();
  const { departmentById } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [loading, startTransition] = useTransition();
  const admin = principal.role === 'ADMIN';
  const [search, setSearch] = useState(view.q);
  useEffect(() => setSearch(view.q), [view.q]);

  function update(changes: Record<string, string | number | boolean | null>) {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value === '' || value === null || value === false) next.delete(name);
      else next.set(name, value === true ? '1' : String(value));
    }
    if (!('page' in changes)) next.delete('page');
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const returnTo = `${pathname}${params.size ? `?${params}` : ''}`;
  const detailHref = (id: string) => `/admin/reports/${id}?from=${encodeURIComponent(returnTo)}`;
  const department = view.departmentId ? departmentById(view.departmentId) : null;
  const title = view.scope === 'department'
    ? departmentName(department, lang) ?? t('panel.nav.reports')
    : view.scope === 'unrouted' ? t('panel.nav.unrouted')
      : admin ? t('panel.nav.allReports') : t('reports.ownTitle');
  const showDepartment = admin && view.scope === 'all';

  return (
    <div className="stack">
      {admin && (view.scope === 'department' || view.scope === 'unrouted') && (
        <Link href="/admin/sectors" className="back-link"><Icon name="arrowLeft" size={16} />{t('panel.nav.departments')}</Link>
      )}
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          {view.scope === 'unrouted' && <p className="muted" style={{ margin: 0 }}>{t('reports.unroutedIntro')}</p>}
          {view.scope === 'own' && <p className="muted" style={{ margin: 0 }}>{t('reports.ownIntro')}</p>}
        </div>
        <div className="row">
          <a href={`/api/admin/reports/export?${view.exportQuery}`} className="btn btn-sm btn-outline" download>
            <Icon name="download" size={16} />{t('reports.export')}
          </a>
        </div>
      </div>

      <div className="priority-tabs" role="tablist" aria-label={t('reports.byPriority')}>
        {([
          { value: null, label: t('reports.allPriorities'), count: counts?.total },
          { value: 'HIGH', label: t('priority.high'), count: counts?.HIGH, icon: 'arrowUp' },
          { value: 'MEDIUM', label: t('priority.medium'), count: counts?.MEDIUM, icon: 'minus' },
          { value: 'LOW', label: t('priority.low'), count: counts?.LOW, icon: 'arrowDown' },
        ] as Array<{ value: Priority | null; label: string; count?: number; icon?: string }>).map((tab) => (
          <button
            key={tab.value ?? 'all'} type="button" role="tab" aria-selected={view.priority === tab.value}
            className={`ptab${tab.value ? ` ptab-${key(tab.value)}` : ''}${view.priority === tab.value ? ' active' : ''}`}
            onClick={() => update({ priority: tab.value })}
          >
            {tab.icon && <Icon name={tab.icon} size={14} strokeWidth={2.6} />}
            {tab.label}
            <span className="count">{tab.count ?? '·'}</span>
          </button>
        ))}
      </div>

      <div className="filter-row">
        {/* The statuses of the reports, each with its number; a click shows only that status. */}
        <div className="field inline wrap">
          <span className="label" aria-hidden="true">{t('reports.status')}</span>
          <Segmented<StatusView>
            size="sm"
            label={t('reports.status')}
            value={view.view}
            onChange={(v) => update({ status: v === 'open' ? null : v })}
            options={STATUS_VIEW_NAMES.map((k) => ({ value: k, label: t(`reports.presets.${k}`), count: statusCounts ? viewCount(k, statusCounts) : undefined }))}
          />
        </div>
      </div>
      <div className="filter-row">
        <form className="search-inline" role="search" onSubmit={(e) => { e.preventDefault(); update({ q: search.trim() }); }}>
          <label htmlFor="rl-search" className="sr-only">{t('reports.search')}</label>
          <input id="rl-search" type="search" maxLength={100} placeholder={t('reports.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
          <button type="submit" className="btn btn-sm btn-outline"><Icon name="search" size={16} /><span className="sr-only">{t('reports.search')}</span></button>
        </form>
        <div className="field inline">
          <label htmlFor="rl-sort">{t('reports.sort')}</label>
          <select id="rl-sort" value={view.sort} onChange={(e) => update({ sort: e.target.value === 'priority' ? null : e.target.value })}>
            {REPORT_SORTS.map((s) => <option key={s} value={s}>{t(`reports.sorts.${s}`)}</option>)}
          </select>
        </div>
        <label className="check small"><input type="checkbox" checked={view.overdue} onChange={(e) => update({ overdue: e.target.checked })} /><span>{t('reports.onlyOverdue')}</span></label>
        {!admin && <label className="check small"><input type="checkbox" checked={view.assignedToMe} onChange={(e) => update({ assignedToMe: e.target.checked })} /><span>{t('reports.onlyMine')}</span></label>}
        <label className="check small"><input type="checkbox" checked={view.transferPending} onChange={(e) => update({ transferPending: e.target.checked })} /><span>{t('reports.onlyReviews')}</span></label>
      </div>

      {!data && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
      {data && (
        <div className={loading ? 'refreshing' : ''} aria-busy={loading}>
          <p className="small muted" style={{ margin: '0 0 8px' }}>{t('reports.total', { n: data.total })}</p>
          {data.items.length === 0 ? (
            <EmptyState icon="inbox" title={t('reports.emptyTitle')} text={t('reports.emptyText')} />
          ) : (
            <div className="table-wrap">
              <table className="table report-table">
                <thead>
                  <tr>
                    <th scope="col">{t('reports.cols.report')}</th>
                    <th scope="col">{t('reports.cols.priority')}</th>
                    <th scope="col">{t('reports.cols.status')}</th>
                    {showDepartment && <th scope="col">{t('reports.cols.sector')}</th>}
                    <th scope="col">{t('reports.cols.place')}</th>
                    <th scope="col">{t('reports.cols.due')}</th>
                    <th scope="col">{t('reports.cols.received')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className={`clickable${r.overdue ? ' overdue' : ''}`} onClick={() => router.push(detailHref(r.id))}>
                      <td data-label={t('reports.cols.report')}>
                        <Link href={detailHref(r.id)} className="case-number" onClick={(e) => e.stopPropagation()}>{r.caseNumber}</Link>
                        <div className="strong">{typeName(r.type, lang)}</div>
                        {r.aiSummary && <div className="small muted clamp-2">{r.aiSummary}</div>}
                        <div className="row" style={{ gap: 6, marginTop: 4 }}>
                          <TransferBadge show={r.transferPending} />
                          <TestBadge show={r.isTest} />
                        </div>
                      </td>
                      <td data-label={t('reports.cols.priority')}><PriorityBadge priority={r.priority} /></td>
                      <td data-label={t('reports.cols.status')}>
                        <InternalStatusBadge status={r.status} />
                        {r.assignedTo && <div className="small muted" style={{ marginTop: 4 }}><Icon name="user" size={12} /> {r.assignedTo.name}</div>}
                      </td>
                      {showDepartment && <td data-label={t('reports.cols.sector')}>{departmentName(r.department, lang) ?? <span className="badge badge-overdue">{t('panel.nav.unrouted')}</span>}</td>}
                      <td data-label={t('reports.cols.place')}>{r.address || '–'}{r.neighbourhood && <div className="small muted">{r.neighbourhood}</div>}</td>
                      <td data-label={t('reports.cols.due')} className="nowrap">{r.dueAt ? formatDate(r.dueAt, lang) : '–'}<div><OverdueBadge show={r.overdue} /></div></td>
                      <td data-label={t('reports.cols.received')} className="nowrap">{formatDate(r.createdAt, lang)}<div className="small muted" suppressHydrationWarning>{timeAgo(r.createdAt, t)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={data.page} pages={data.pages} onChange={(p) => update({ page: p === 1 ? null : p })} />
        </div>
      )}
    </div>
  );
}
