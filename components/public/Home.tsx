'use client';
/**
 * Home page: the "Track a report" button, how it works (3 steps), the
 * categories (a report starts ONLY by choosing one), the latest public
 * reports and the problems reported most often (for information, not links). Questions are
 * answered by the help chat at the bottom right (components/site/ChatHelp.tsx).
 */
import Link from 'next/link';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { CategoryIcon } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { PublicCard } from '@/lib/shared/types';
import { CaseCard } from './Cases';

export default function Home({ recent, frequent = [] }: { recent: PublicCard[] | null; frequent?: Array<{ id: number; count: number }> }) {
  const { t, lang } = useI18n();
  const { catalog, typeById } = useCatalog();
  // Only types still in the catalogue (active), in the order the server counted them.
  const frequentTypes = frequent.flatMap(({ id, count }) => { const ty = typeById(id); return ty ? [{ ty, count }] : []; });

  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero-actions">
            <Link href="/ndiq" className="btn btn-lg"><Icon name="search" size={20} />{t('home.trackButton')}</Link>
          </div>
        </div>
      </section>

      {/* How it works: at the top, before the categories. */}
      <section className="section how-steps">
        <div className="container grid-3">
          {['step1', 'step2', 'step3'].map((k, i) => (
            <div key={k}>
              <div className="head" style={{ fontSize: '2rem', color: 'var(--brand-button)' }}>{i + 1}</div>
              <h3>{t(`home.how.${k}.title`)}</h3>
              <p className="muted">{t(`home.how.${k}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-title"><h2>{t('home.categories')}</h2></div>
          {catalog.categories.length === 0 && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
          <div className="category-grid">
            {catalog.categories.map((c) => (
              <Link key={c.code} href={`/raporto?kategoria=${c.code}`} className="category-tile">
                <CategoryIcon icon={c.icon} />
                {lang === 'en' ? c.nameEn : c.nameSq}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ background: 'var(--bg-soft)' }}>
        <div className="container">
          <div className="section-title">
            <h2>{t('home.recent')}</h2>
            <Link href="/harta" className="small head">{t('home.seeMap')} →</Link>
          </div>
          {recent === null && <div className="alert alert-error" role="alert">{t('errors.generic')}</div>}
          {recent && recent.length === 0 && <p className="muted">{t('home.noRecent')}</p>}
          {recent && recent.length > 0 && <div className="case-list">{recent.map((r) => <CaseCard key={r.caseNumber} item={r} />)}</div>}
        </div>
      </section>

      {frequentTypes.length > 0 && (
        <section className="section">
          <div className="container">
            <div className="section-title"><h2>{t('home.frequent')}</h2></div>
            {/* Information only: a report starts by choosing a category above. */}
            <ul className="frequent-list">
              {frequentTypes.map(({ ty, count }) => (
                <li key={ty.id}>
                  <span className="frequent-icon" aria-hidden="true"><CategoryIcon icon={ty.category.icon} size={24} /></span>
                  <span className="frequent-name">
                    <strong>{lang === 'en' ? ty.nameEn : ty.nameSq}</strong>
                    <span>{lang === 'en' ? ty.category.nameEn : ty.category.nameSq}</span>
                  </span>
                  {count > 0 && <span className="frequent-count">{t('home.frequentCount', { n: count })}</span>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
