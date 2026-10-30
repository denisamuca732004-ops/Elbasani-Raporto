'use client';
/**
 * The admin's sector cards: one per sector with its number of reports (open,
 * high priority, overdue, and the period's received / resolved), plus a red
 * one for the reports still waiting for a sector. A card opens the sector's
 * reports with every status; the status tabs there show how many are in each,
 * and each report opens for editing. Shown on the dashboard and on the
 * "Departamentet" page of the menu (/admin/sectors).
 */
import Link from 'next/link';
import Icon from '@/components/Icon';
import { EmptyState } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { SectorRow } from '@/lib/server/services/dashboard';
import type { DashboardPeriod } from '@/lib/shared/domain';

function SectorCard({ sector, periodLabel }: { sector: SectorRow; periodLabel: string }) {
  const { t, lang } = useI18n();
  const unrouted = sector.id === null;
  const href = unrouted ? '/admin/reports?unrouted=1' : `/admin/reports?departmentId=${sector.id}&status=all`;
  const count = unrouted ? sector.open : sector.total;
  return (
    <Link href={href} className={`sector-card${unrouted ? ' unrouted' : ''}`}>
      <span className="sector-name">
        <Icon name={unrouted ? 'alert' : 'layers'} size={18} />
        {unrouted ? t('panel.nav.unrouted') : (lang === 'en' ? sector.nameEn : sector.nameSq)}
      </span>
      <span className="sector-total">
        <strong>{count}</strong> {t(unrouted ? 'dashboard.sectorWaiting' : 'dashboard.sectorReports', { n: count })}
      </span>
      {!unrouted && (
        <span className="sector-meta">
          <span>{t('dashboard.sectorOpen', { n: sector.open })}</span>
          {sector.openHigh > 0 && <span className="priority priority-high"><Icon name="arrowUp" size={12} strokeWidth={3} />{sector.openHigh}<span className="sr-only"> {t('dashboard.highOpen')}</span></span>}
          {sector.overdue > 0 && <span className="badge badge-overdue">{t('dashboard.sectorOverdue', { n: sector.overdue })}</span>}
        </span>
      )}
      {!unrouted && <span className="small muted">{t('dashboard.sectorPeriod', { period: periodLabel, received: sector.received, resolved: sector.resolved })}</span>}
      <span className="sector-go">{t('dashboard.sectorOpenList')}<Icon name="chevronRight" size={16} /></span>
    </Link>
  );
}

export function SectorCards({ rows, period }: { rows: SectorRow[]; period: DashboardPeriod }) {
  const { t } = useI18n();
  // The "without a sector" card only while some of those reports are open.
  const shown = rows.filter((s) => s.id !== null || s.open > 0);
  if (!shown.length) return <EmptyState icon="layers" title={t('sectors.emptyTitle')} text={t('sectors.emptyText')} />;
  return (
    <div className="sector-grid">
      {shown.map((s) => <SectorCard key={s.id ?? 'none'} sector={s} periodLabel={t(`dashboard.periods.${period}`)} />)}
    </div>
  );
}

/** /admin/sectors: the "Departamentet" item of the menu. */
export default function SectorsPage({ rows }: { rows: SectorRow[] | null }) {
  const { t } = useI18n();
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t('panel.nav.departments')}</h1>
          <p className="muted" style={{ margin: 0 }}>{t('dashboard.sectorsHint')}</p>
        </div>
      </div>
      {rows === null ? <div className="alert alert-error" role="alert">{t('errors.generic')}</div> : <SectorCards rows={rows} period="month" />}
    </div>
  );
}
