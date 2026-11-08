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
import { BarList, Segmented } from '@/components/ui';
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

/**
 * The top of the dashboard: how many reports are open right now (the one big number), the period's
 * figures beside it, and a band showing where this period's reports are now (waiting → being fixed
 * → fixed), in the same colours as the public map.
 */
function Pulse({ data }: { data: DashboardResult }) {
  const { t, lang } = useI18n();
  const tot = data.totals;
  const flow = FLOW.map((f) => ({ ...f, n: data.byStatus.filter((s) => f.statuses.includes(s.status)).reduce((a, s) => a + s.count, 0) }));
  const flowTotal = flow.reduce((a, f) => a + f.n, 0);
  const num = (v: number | null | undefined, suffix = '') => (v === null || v === undefined ? '–' : `${v.toLocaleString(lang === 'en' ? 'en-GB' : 'sq-AL')}${suffix}`);
  const change = (now: number, before: number) => {
    if (!before) return null;
    const pct = Math.round(((now - before) / before) * 100);
    return `${pct > 0 ? '+' : ''}${pct}% ${t('dashboard.vsPrevious', { n: before })}`;
  };
  const figures = [
    { label: t('dashboard.received'), value: num(tot.received), note: change(tot.received, tot.receivedPrevious) },
    { label: t('dashboard.resolved'), value: num(tot.resolved), note: change(tot.resolved, tot.resolvedPrevious) },
    { label: t('dashboard.avgDays'), value: num(tot.avgDaysToResolve), note: null },
    { label: t('dashboard.onTime'), value: num(tot.onTimePct, tot.onTimePct === null ? '' : '%'), note: null },
  ];
  return (
    <>
      <div className="pulse-main">
        <div className="pulse-open">
          <span className="pulse-big">{num(tot.openNow)}</span>
          <span className="pulse-open-text">
            <strong>{t('dashboard.pulse.open', { n: tot.openNow })}</strong>
            <span>{t('dashboard.waitingReview', { n: tot.waitingReviewNow })}</span>
            {tot.overdueNow > 0 && <span className="pulse-late"><Icon name="clock" size={15} strokeWidth={2.4} />{t('dashboard.pulse.overdue', { n: tot.overdueNow })}</span>}
          </span>
        </div>
        <dl className="pulse-figures">
          {figures.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
              {f.note && <dd className="pulse-note">{f.note}</dd>}
            </div>
          ))}
        </dl>
      </div>
      <div className="pulse-flow">
        <p className="pulse-flow-title">{t('dashboard.pulse.flowTitle')}</p>
        {flowTotal === 0 ? <p className="pulse-flow-empty">{t('dashboard.pulse.none')}</p> : (
          <>
            <div className="flow-band" aria-hidden="true">
              {flow.map((f) => (f.n ? <span key={f.key} className={`flow-${f.key}`} style={{ flexGrow: f.n }} /> : null))}
            </div>
            <ul className="flow-legend">
              {flow.map((f) => (
                <li key={f.key} className={`flow-${f.key}`}><i aria-hidden="true" /><strong>{f.n}</strong> {t(`dashboard.pulse.${f.key}`)}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

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
      <section className={`pulse${loading ? ' refreshing' : ''}`} aria-labelledby="pulse-title">
        <div className="pulse-top">
          <div>
            <h1 id="pulse-title">{t('panel.nav.dashboard')}</h1>
            <p className="pulse-scope">
              {scopeName}
              {data && <span>{formatDate(data.range.from, lang)} – {formatDate(new Date(new Date(data.range.to).getTime() - 1), lang)}</span>}
            </p>
          </div>
          <div className="pulse-filters">
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
        {data && <Pulse data={data} />}
      </section>

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

          <PriorityCard open={data.openByPriority} received={data.receivedByPriority} listPath={listPath} />

          <section className="card">
            <h2 className="card-title">{t('dashboard.trendTitle', { period: periodLabel.toLowerCase() })}</h2>
            <TrendChart rows={data.trend} unit={data.unit} series={series} title={t('dashboard.trendTitle', { period: periodLabel.toLowerCase() })} />
          </section>

          <div className="grid-stats">
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
