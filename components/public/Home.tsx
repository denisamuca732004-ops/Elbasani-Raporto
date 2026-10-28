'use client';
/** Home page in the style of 311.boston.gov: search, categories, recent reports. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { CategoryIcon } from '@/components/ui';
import { useI18n } from '@/i18n';
import type { PublicCard } from '@/lib/shared/types';
import { CaseCard } from './Cases';

const normalise = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function Home({ recent }: { recent: PublicCard[] | null }) {
  const { t, lang } = useI18n();
  const { catalog, types } = useCatalog();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = normalise(query.trim());
    if (q.length < 2) return [];
    return types
      .filter((ty) => normalise(`${ty.nameSq} ${ty.nameEn} ${ty.category.nameSq} ${ty.category.nameEn}`).includes(q))
      .slice(0, 8);
  }, [query, types]);

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>{t('home.title')}</h1>
          <div className="search-box">
            <label htmlFor="home-search" className="sr-only">{t('home.searchLabel')}</label>
            <input
              id="home-search" type="search" autoComplete="off" placeholder={t('home.searchPlaceholder')}
              value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) router.push(`/raporto?lloji=${matches[0].id}`); }}
            />
            <Icon name="search" size={26} className="search-icon" />
            {matches.length > 0 && (
              <ul className="search-results">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => router.push(`/raporto?lloji=${m.id}`)}>
                      <strong>{lang === 'en' ? m.nameEn : m.nameSq}</strong>
                      <span className="muted small"> · {lang === 'en' ? m.category.nameEn : m.category.nameSq}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim().length >= 2 && matches.length === 0 && (
              <ul className="search-results"><li><button type="button" onClick={() => router.push('/raporto?kategoria=other')}>{t('home.noMatch')}</button></li></ul>
            )}
          </div>
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
