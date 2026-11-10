'use client';
/**
 * Dashboard of report statistics for a week, a month or a year.
 * The admin sees the whole municipality (or one department), starting with a
 * card for each sector (its reports → their statuses → each report); a
 * department head sees their department.
 * The period and department live in the address (?period=week&departmentId=3).
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import TrendChart from '@/components/charts/TrendChart';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { Segmented } from '@/components/ui';
import { useI18n } from '@/i18n';
import { departmentName, formatDate, key } from '@/lib/client/format';
import { storage } from '@/lib/client/storage';
import type { DashboardResult } from '@/lib/server/services/dashboard';
import { PRIORITIES, STATUSES, type DashboardPeriod } from '@/lib/shared/domain';
import type { Principal } from '@/lib/shared/types';

const ONBOARDING_KEY = 'er_onboarding_hidden';

export interface OnboardingInfo { activeDepartments: number; withoutHead: Array<{ nameSq: string; nameEn: string }> }

/** First steps for a new admin: departments → report types → accounts of the department heads. */
const FLOW: Array<{ key: 'waiting' | 'working' | 'fixed' | 'rejected'; statuses: string[] }> = [
  { key: 'waiting', statuses: ['PENDING', 'NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED'] },
  { key: 'working', statuses: ['IN_PROGRESS'] },
  { key: 'fixed', statuses: ['RESOLVED', 'CLOSED'] },
  { key: 'rejected', statuses: ['REJECTED'] },
];

/** The five figures of the period in one strip: open, overdue, received, resolved, days to resolve. */
function KpiStrip({ data, listPath }: { data: DashboardResult; listPath: string }) {
  const { t, lang } = useI18n();
  const tot = data.totals;
  const num = (v: number | null | undefined, suffix = '') => (v === null || v === undefined ? '–' : `${v.toLocaleString(lang === 'en' ? 'en-GB' : 'sq-AL')}${suffix}`);
  const before = (n: number) => (n ? t('dashboard.vsPrevious', { n }) : t('dashboard.noPrevious'));
  const cells = [
    { label: t('dashboard.openNow'), value: num(tot.openNow), note: t('dashboard.waitingReview', { n: tot.waitingReviewNow }), href: `${listPath}status=open` },
    { label: t('dashboard.overdueNow'), value: num(tot.overdueNow), note: null, href: `${listPath}overdue=1`, alert: tot.overdueNow > 0 },
    { label: t('dashboard.received'), value: num(tot.received), note: before(tot.receivedPrevious) },
    { label: t('dashboard.resolved'), value: num(tot.resolved), note: before(tot.resolvedPrevious) },
    { label: t('dashboard.avgDays'), value: num(tot.avgDaysToResolve), note: tot.onTimePct === null ? null : `${tot.onTimePct}% ${t('dashboard.onTime').toLowerCase()}` },
  ];
  return (
    <section className="kpi-strip" aria-label={t('dashboard.kpis', { period: t(`dashboard.periods.${data.period}`) })}>
      {cells.map((c) => {
        const body = (
          <>
            <span className="kpi-label">{c.label}</span>
            <span className={`kpi-value${c.alert ? ' is-alert' : ''}`}>{c.value}</span>
            {c.note && <span className="kpi-note">{c.note}</span>}
          </>
        );
        return c.href ? <Link key={c.label} href={c.href} className="kpi-cell">{body}</Link> : <div key={c.label} className="kpi-cell">{body}</div>;
      })}
    </section>
  );
}

/** Open reports by priority: three rows, each opens the list. */
function PriorityList({ open, received, listPath }: { open: Record<string, number>; received: Record<string, number>; listPath: string }) {
  const { t } = useI18n();
  return (
    <section className="card">
      <h2 className="card-title">{t('dashboard.openByPriority')}</h2>
      <ul className="row-list">
        {[...PRIORITIES].reverse().map((p) => (
          <li key={p}>
            <Link href={`${listPath}priority=${p}&status=open`} className="row-link">
              <span className={`pill pill-${key(p)}`}>{t(`priority.${key(p)}`)}</span>
              <span className="row-note">{t('dashboard.receivedInPeriod', { n: received[p] ?? 0 })}</span>
              <span className="row-value">{open[p] ?? 0}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Where this period's reports are now: one thin bar and four figures. */
function StatusBreakdown({ data }: { data: DashboardResult }) {
  const { t } = useI18n();
  const flow = FLOW.map((f) => ({ ...f, n: data.byStatus.filter((s) => f.statuses.includes(s.status)).reduce((a, s) => a + s.count, 0) }));
  const total = flow.reduce((a, f) => a + f.n, 0);
  return (
    <section className="card">
      <h2 className="card-title">{t('dashboard.byStatus')}</h2>
      {total === 0 ? <p className="muted">{t('dashboard.pulse.none')}</p> : (
        <>
          <div className="flow-bar" aria-hidden="true">{flow.map((f) => (f.n ? <span key={f.key} className={`flow-${f.key}`} style={{ flexGrow: f.n }} /> : null))}</div>
          <dl className="flow-figures">
            {flow.map((f) => <div key={f.key} className={`flow-${f.key}`}><dt><i aria-hidden="true" />{t(`dashboard.pulse.${f.key}`)}</dt><dd>{f.n}</dd></div>)}
          </dl>
        </>
      )}
    </section>
  );
}

/** A plain list of names with their numbers (categories, areas). */
function CountList({ rows, empty }: { rows: Array<{ key: string; label: string; value: number; note?: string }>; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="row-list">
      {rows.map((r) => (
        <li key={r.key} className="row-plain">
          <span className="row-name">{r.label}</span>
          {r.note && <span className="row-note">{r.note}</span>}
          <span className="row-value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function Onboarding({ info }: { info: OnboardingInfo }) {
  const { t, lang } = useI18n();
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(storage.get(ONBOARDING_KEY) === '1'), []);
  if (hidden || !info.withoutHead.length) return null;
  return (
    <section className="card onboarding">
      <div className="row-between">
        <h2 className="card-title" style={{ margin: 0 }}><Icon name="flag" size={18} /> {t('dashboard.onboarding.title')}</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => { storage.set(ONBOARDING_KEY, '1'); setHidden(true); }}>
          {t('dashboard.onboarding.hide')}
        </button>
      </div>
      <ol>
        <li><Link href="/admin/departments">{t('dashboard.onboarding.sectors', { n: info.activeDepartments })}</Link></li>
        <li><Link href="/admin/report-types">{t('dashboard.onboarding.types')}</Link></li>
        <li>
          <Link href="/admin/departments">{t('dashboard.onboarding.heads')}</Link>
          <div className="small muted">{t('dashboard.onboarding.missing', { list: info.withoutHead.map((s) => (lang === 'en' ? s.nameEn : s.nameSq)).join(', ') })}</div>
        </li>
      </ol>
    </section>
  );
}

export default function Dashboard({ principal, data, onboarding }: { principal: Principal; data: DashboardResult | null; onboarding: OnboardingInfo | null }) {
  const { t, lang } = useI18n();
  const { departments } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [loading, startTransition] = useTransition();
  const admin = principal.role === 'ADMIN';
  const period: DashboardPeriod = data?.period ?? 'month';
  const departmentId = admin ? params.get('departmentId') ?? '' : '';

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  }

  /** Where a click on a number leads: the list with the same scope. */
  const listPath = admin && departmentId ? `/admin/reports?departmentId=${departmentId}&` : '/admin/reports?';
  const scopeName = data?.department
    ? departmentName(data.department, lang)
    : admin ? t('dashboard.wholeMunicipality') : (lang === 'en' ? principal.departmentNameEn : principal.departmentNameSq);
  const periodLabel = t(`dashboard.periods.${period}`);
  const series = [
    { key: 'received', label: t('dashboard.received'), color: 'var(--series-a)' },
    { key: 'resolved', label: t('dashboard.resolved'), color: 'var(--series-b)' },
  ];

  return (
    <div className="stack dash">
      <div className="page-head dash-head">
        <div>
          <h1>{t('panel.nav.dashboard')}</h1>
          <p className="page-sub">{scopeName}{data && <> · {formatDate(data.range.from, lang)} – {formatDate(new Date(new Date(data.range.to).getTime() - 1), lang)}</>}</p>
        </div>
        <div className="dash-filters">
          <Segmented<DashboardPeriod>
            label={t('dashboard.period')}
            value={period}
            onChange={(v) => setParam('period', v)}
            options={[
              { value: 'week', label: t('dashboard.periods.week') },
              { value: 'month', label: t('dashboard.periods.month') },
              { value: 'year', label: t('dashboard.periods.year') },
            ]}
          />
          {admin && (
            <div className="field inline">
              <label htmlFor="dash-sector">{t('dashboard.sector')}</label>
              <select id="dash-sector" value={departmentId} onChange={(e) => setParam('departmentId', e.target.value)}>
                <option value="">{t('dashboard.allSectors')}</option>
                {departments.map((s) => <option key={s.id} value={s.id}>{departmentName(s, lang)}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {admin && !departmentId && onboarding && <Onboarding info={onboarding} />}
      {!data && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}

      {data && (
        <div className={`stack${loading ? ' refreshing' : ''}`} aria-busy={loading}>
          {data.pendingTransfers > 0 && (
            <Link href={admin ? '/admin/reports?tab=returned' : '/admin/transfers'} className="callout">
              <Icon name="transfer" size={20} />
              <span>{admin ? t('dashboard.pendingReviewsAdmin', { n: data.pendingTransfers }) : t('dashboard.pendingReviewsSector', { n: data.pendingTransfers })}</span>
              <Icon name="chevronRight" size={18} />
            </Link>
          )}

          <KpiStrip data={data} listPath={listPath} />

          <div className="dash-row">
            <section className="card">
              <h2 className="card-title">{t('dashboard.trendTitle', { period: periodLabel.toLowerCase() })}</h2>
              <TrendChart rows={data.trend} unit={data.unit} series={series} title={t('dashboard.trendTitle', { period: periodLabel.toLowerCase() })} />
            </section>
            <PriorityList open={data.openByPriority} received={data.receivedByPriority} listPath={listPath} />
          </div>

          <div className="dash-row3">
            <StatusBreakdown data={data} />
            <section className="card">
              <h2 className="card-title">{t('dashboard.byCategory')}</h2>
              <CountList
                rows={data.byCategory.map((c) => ({ key: c.code, label: lang === 'en' ? c.nameEn : c.nameSq, value: c.received, note: t('dashboard.catFixed', { n: c.resolved, total: c.received }) }))}
                empty={t('dashboard.empty')}
              />
            </section>
            <section className="card">
              <h2 className="card-title">{t('dashboard.byArea')}</h2>
              <CountList rows={data.byNeighbourhood.map((n) => ({ key: n.name, label: n.name, value: n.received }))} empty={t('dashboard.empty')} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
