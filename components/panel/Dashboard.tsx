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
import { BarList, KpiTile, Segmented } from '@/components/ui';
import { useI18n } from '@/i18n';
import { departmentName, formatDate, key } from '@/lib/client/format';
import { storage } from '@/lib/client/storage';
import type { DashboardResult } from '@/lib/server/services/dashboard';
import { PRIORITIES, STATUSES, type DashboardPeriod } from '@/lib/shared/domain';
import type { Principal } from '@/lib/shared/types';

const ONBOARDING_KEY = 'er_onboarding_hidden';

export interface OnboardingInfo { activeDepartments: number; withoutHead: Array<{ nameSq: string; nameEn: string }> }

/** First steps for a new admin: departments → report types → accounts of the department heads. */
/** Open reports by priority: one proportion bar, then a row per priority (click → the list). */
function PriorityCard({ open, received, listPath }: { open: Record<string, number>; received: Record<string, number>; listPath: string }) {
  const { t } = useI18n();
  const order = [...PRIORITIES].reverse();
  const total = order.reduce((n, p) => n + (open[p] ?? 0), 0);
  return (
    <section className="card">
      <div className="dash-card-head">
        <h2 className="card-title">{t('dashboard.openByPriority')}</h2>
        <span className="dash-card-meta">{total}</span>
      </div>
      <div className="prio-bar" aria-hidden="true">
        {total > 0 && order.map((p) => (open[p] ? <span key={p} className={`prio-${key(p)}`} style={{ flexGrow: open[p] }} /> : null))}
      </div>
      <div className="prio-list">
        {order.map((p) => (
          <Link key={p} href={`${listPath}priority=${p}&status=open`} className={`prio-item prio-${key(p)}`}>
            <span className="prio-name"><i aria-hidden="true" />{t(`priority.${key(p)}`)}</span>
            <span className="prio-value">{open[p] ?? 0}</span>
            <span className="prio-sub">{t('dashboard.receivedInPeriod', { n: received[p] ?? 0 })}</span>
          </Link>
        ))}
      </div>
    </section>
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
      <div className="page-head">
        <div>
          <h1>{t('panel.nav.dashboard')}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {scopeName}
            {data && ` · ${formatDate(data.range.from, lang)} – ${formatDate(new Date(new Date(data.range.to).getTime() - 1), lang)}`}
          </p>
        </div>
      </div>

      <div className="filter-row">
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

          <section aria-label={t('dashboard.kpis', { period: periodLabel })}>
            <div className="kpis">
              <KpiTile icon="inbox" tone="blue" label={t('dashboard.received')} value={data.totals.received} previous={data.totals.receivedPrevious} upIsGood={null} />
              <KpiTile icon="check" tone="green" label={t('dashboard.resolved')} value={data.totals.resolved} previous={data.totals.resolvedPrevious} />
              <KpiTile icon="layers" tone="amber" label={t('dashboard.openNow')} value={data.totals.openNow} hint={t('dashboard.waitingReview', { n: data.totals.waitingReviewNow })} />
              <KpiTile icon="alert" tone="coral" label={t('dashboard.overdueNow')} value={data.totals.overdueNow} accent={data.totals.overdueNow ? 'alert' : undefined} />
              <KpiTile icon="clock" tone="violet" label={t('dashboard.avgDays')} value={data.totals.avgDaysToResolve} />
              <KpiTile icon="flag" tone="teal" label={t('dashboard.onTime')} value={data.totals.onTimePct} suffix={data.totals.onTimePct === null ? '' : '%'} />
            </div>
          </section>

          <PriorityCard open={data.openByPriority} received={data.receivedByPriority} listPath={listPath} />

          <section className="card">
            <h2 className="card-title">{t('dashboard.trendTitle', { period: periodLabel.toLowerCase() })}</h2>
            <TrendChart rows={data.trend} unit={data.unit} series={series} title={t('dashboard.trendTitle', { period: periodLabel.toLowerCase() })} />
          </section>

          <div className="grid-stats">
            <section className="card">
              <h2 className="card-title">{t('dashboard.byStatus')}</h2>
              <p className="hint" style={{ marginTop: -6 }}>{t('dashboard.byStatusHint', { period: periodLabel.toLowerCase() })}</p>
              <BarList
                rows={[...data.byStatus]
                  .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status))
                  .map((s) => ({ key: s.status, label: t(`internalStatus.${key(s.status)}`), total: s.count }))}
                emptyText={t('dashboard.empty')}
              />
            </section>
            <section className="card">
              <h2 className="card-title">{t('dashboard.byCategory')}</h2>
              <div className="legend"><span><i style={{ background: 'var(--series-b)' }} />{t('dashboard.resolved')}</span><span><i style={{ background: 'var(--series-a)' }} />{t('dashboard.stillOpen')}</span><span className="legend-note">{t('dashboard.numbersNote')}</span></div>
              <BarList
                rows={data.byCategory.map((c) => ({ key: c.code, label: lang === 'en' ? c.nameEn : c.nameSq, total: c.received, resolved: c.resolved }))}
                withResolved
                emptyText={t('dashboard.empty')}
              />
            </section>
            <section className="card">
              <h2 className="card-title">{t('dashboard.byArea')}</h2>
              <BarList rows={data.byNeighbourhood.map((n) => ({ key: n.name, label: n.name, total: n.received }))} emptyText={t('dashboard.empty')} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
