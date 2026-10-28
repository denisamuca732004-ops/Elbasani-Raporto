'use client';
/** Public statistics: transparency about how fast the municipality responds. */
import { BarList, ColumnChart } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatBucket } from '@/lib/client/format';
import type { PublicStats } from '@/lib/server/services/stats';

export default function StatsPage({ data }: { data: PublicStats | null }) {
  const { t, lang } = useI18n();
  return (
    <div className="page">
      <div className="container">
        <h1>{t('stats.title')}</h1>
        <p className="muted">{t('stats.intro')}</p>
        {!data && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
        {data && (
          <>
            <div className="kpis">
              <div className="kpi"><div className="value">{data.totals.total}</div><div className="label">{t('stats.total')}</div></div>
              <div className="kpi"><div className="value">{data.totals.open}</div><div className="label">{t('stats.open')}</div></div>
              <div className="kpi"><div className="value">{data.totals.resolved}</div><div className="label">{t('stats.resolved')}</div></div>
              <div className="kpi"><div className="value">{data.totals.avgDaysToResolve ?? '–'}</div><div className="label">{t('stats.avgDays')}</div></div>
              <div className="kpi"><div className="value">{data.totals.onTimePct !== null ? `${data.totals.onTimePct}%` : '–'}</div><div className="label">{t('stats.onTime')}</div></div>
            </div>
            <div className="grid-stats">
              <section className="card">
                <h2 className="card-title">{t('stats.byMonth')}</h2>
                <ColumnChart
                  rows={data.months.map((m) => ({ label: formatBucket(`${m.month}-01`, 'month', lang, { withYear: true }), short: formatBucket(`${m.month}-01`, 'month', lang), a: m.received, b: m.resolved }))}
                  aLabel={t('stats.received')} bLabel={t('stats.resolved')}
                />
              </section>
              <section className="card">
                <h2 className="card-title">{t('stats.byCategory')}</h2>
                <div className="legend"><span><i style={{ background: 'var(--series-b)' }} />{t('stats.resolved')}</span><span><i style={{ background: 'var(--series-a)' }} />{t('stats.notYet')}</span><span className="legend-note">{t('stats.numbersNote')}</span></div>
                <BarList
                  rows={data.byCategory.filter((c) => c.total > 0).map((c) => ({ key: c.code, label: lang === 'en' ? c.nameEn : c.nameSq, total: c.total, resolved: c.resolved }))}
                  withResolved emptyText={t('stats.empty')}
                />
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
