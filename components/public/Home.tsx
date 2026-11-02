'use client';
/**
 * Home page: the "Report a problem" and "Track a report" buttons, the
 * categories, the latest public reports, the problems reported most often
 * (each a shortcut straight into the form) and how it works. Questions, report numbers, problems and streets are also
 * searched in the box at the top right of the menu
 * (components/site/SiteSearch.tsx), on every page.
 */
import Link from 'next/link';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { CategoryIcon } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { PublicCard } from '@/lib/shared/types';
import { CaseCard } from './Cases';

export default function Home({ recent, frequent = [] }: { recent: PublicCard[] | null; frequent?: number[] }) {
  const { t, lang } = useI18n();
  const { catalog, typeById } = useCatalog();
  // Only types still in the catalogue (active), in the order the server counted them.
  const frequentTypes = frequent.map((id) => typeById(id)).filter((ty) => ty !== undefined);

  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero-actions">
            <Link href="/raporto" className="btn btn-lg"><Icon name="plus" size={20} />{t('home.reportButton')}</Link>
            <Link href="/ndiq" className="btn btn-lg btn-outline"><Icon name="search" size={20} />{t('home.trackButton')}</Link>
          </div>
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
            <ul className="frequent-list">
              {frequentTypes.map((ty) => (
                <li key={ty.id}>
                  <Link href={`/raporto?kategoria=${ty.category.code}&lloji=${ty.id}`}>
                    <span className="frequent-icon" aria-hidden="true"><CategoryIcon icon={ty.category.icon} size={24} /></span>
                    <span className="frequent-name">
                      <strong>{lang === 'en' ? ty.nameEn : ty.nameSq}</strong>
                      <span>{lang === 'en' ? ty.category.nameEn : ty.category.nameSq}</span>
                    </span>
                    <Icon name="chevronRight" size={20} />
                  </Link>
                </li>
              ))}
            </ul>
            <div className="frequent-all">
              <Link href="/raporto" className="btn btn-outline">{t('home.allCategories')}</Link>
            </div>
          </div>
        </section>
      )}

      <section className="section">
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
    </>
  );
}
