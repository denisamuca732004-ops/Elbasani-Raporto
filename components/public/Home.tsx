'use client';
/**
 * Home page in the style of 311.boston.gov: the "Report a problem" button,
 * the categories, the latest public reports and how it works. Questions,
 * report numbers, problems and streets are searched in the box at the top
 * right of the menu (components/site/SiteSearch.tsx), on every page.
 */
import Link from 'next/link';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { CategoryIcon } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { PublicCard } from '@/lib/shared/types';
import { CaseCard } from './Cases';

export default function Home({ recent }: { recent: PublicCard[] | null }) {
  const { t, lang } = useI18n();
  const { catalog } = useCatalog();

  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero-actions">
            <Link href="/raporto" className="btn btn-lg"><Icon name="plus" size={20} />{t('home.reportButton')}</Link>
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
