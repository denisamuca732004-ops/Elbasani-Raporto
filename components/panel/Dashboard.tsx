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

/** By category: a tile per category, with its icon (as on the public site), how many came in and a ring of how many are fixed. */
function CategoryTiles({ rows }: { rows: DashboardResult['byCategory'] }) {
  const { t, lang } = useI18n();
  const { catalog } = useCatalog();
  if (!rows.length) return <p className="muted">{t('dashboard.empty')}</p>;
  const iconOf = new Map(catalog.categories.map((c) => [c.code, c.icon]));
  const R = 17, C = 2 * Math.PI * R;
  return (
    <ul className="cat-tiles">
      {rows.map((c) => {
        const icon = iconOf.get(c.code) ?? 'other';
        const share = c.received ? c.resolved / c.received : 0;
        return (
          <li key={c.code}>
            <span className="cat-icon" aria-hidden="true"><Icon name={icon as Parameters<typeof Icon>[0]['name']} size={22} strokeWidth={2.2} /></span>
            <span className="cat-name">{lang === 'en' ? c.nameEn : c.nameSq}</span>
            <span className="cat-num">{c.received}</span>
            <span className="cat-fixed">
              <svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">
                <circle cx="20" cy="20" r={R} className="ring-track" />
                <circle cx="20" cy="20" r={R} className="ring-fill" strokeDasharray={`${share * C} ${C}`} transform="rotate(-90 20 20)" />
              </svg>
              {t('dashboard.catFixed', { n: c.resolved, total: c.received })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** By area: one pill per area, warmer the more reports it has. */
function AreaPills({ rows }: { rows: DashboardResult['byNeighbourhood'] }) {
  const { t } = useI18n();
  if (!rows.length) return <p className="muted">{t('dashboard.empty')}</p>;
  const max = Math.max(1, ...rows.map((r) => r.received));
  return (
    <ul className="area-pills">
      {rows.map((a) => {
        const k = a.received / max;
        const level = k > 0.75 ? 4 : k > 0.5 ? 3 : k > 0.25 ? 2 : 1;
        return <li key={a.name} className={`heat-${level}`}><span>{a.name}</span><strong>{a.received}</strong></li>;
      })}
    </ul>
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
              <CategoryTiles rows={data.byCategory} />
            </section>
            <section className="card">
              <h2 className="card-title">{t('dashboard.byArea')}</h2>
              <AreaPills rows={data.byNeighbourhood} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
