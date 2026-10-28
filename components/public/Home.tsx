'use client';
/**
 * Home page in the style of 311.boston.gov. The search box has three uses:
 *  - a report number (EL-2026-00042) → straight to its progress;
 *  - a problem ("gropë")            → the report type, to report it;
 *  - a street or area ("Rinia")     → the OPEN reports there, so residents see
 *    that a problem is already reported (and support it) instead of reporting it twice.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchOpenReportsAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { CategoryIcon, StatusBadge, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import { typeName } from '@/lib/client/format';
import type { PublicCard } from '@/lib/shared/types';
import { CaseCard } from './Cases';

const normalise = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const CASE_RE = /^[A-Z]{1,6}-\d{4}-\d{5,}$/;
const CASE_START = /^[A-Z]{1,6}-\d/;

export default function Home({ recent }: { recent: PublicCard[] | null }) {
  const { t, lang } = useI18n();
  const { catalog, types } = useCatalog();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<PublicCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  const request = useRef(0);

  const trimmed = query.trim();
  const compact = trimmed.toUpperCase().replace(/\s+/g, '');
  const isCase = CASE_RE.test(compact);
  const looksLikeCase = CASE_START.test(compact);

  const matches = useMemo(() => {
    const q = normalise(trimmed);
    if (q.length < 2 || looksLikeCase) return [];
    return types
      .filter((ty) => normalise(`${ty.nameSq} ${ty.nameEn} ${ty.category.nameSq} ${ty.category.nameEn}`).includes(q))
      .slice(0, 6);
  }, [trimmed, looksLikeCase, types]);

  // Open reports on that street / in that area (asked a moment after typing stops).
  useEffect(() => {
    const id = ++request.current;
    if (trimmed.length < 3 || looksLikeCase) {
      setPlaces(null);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      call(searchOpenReportsAction({ q: trimmed }))
        .then((list) => { if (id === request.current) setPlaces(list); })
        .catch(() => { if (id === request.current) setPlaces([]); })
        .finally(() => { if (id === request.current) setSearching(false); });
    }, 350);
    return () => clearTimeout(timer);
  }, [trimmed, looksLikeCase]);

  const showBox = trimmed.length >= 2;
  const nothing = showBox && !looksLikeCase && matches.length === 0 && !searching && (places?.length ?? 0) === 0;

  function submit() {
    if (isCase) router.push(`/ndiq/${compact}`);
    else if (matches[0]) router.push(`/raporto?lloji=${matches[0].id}`);
  }

  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>{t('home.title')}</h1>
          <div className="search-box">
            <label htmlFor="home-search" className="sr-only">{t('home.searchLabel')}</label>
            <input
              id="home-search" type="search" autoComplete="off" placeholder={t('home.searchPlaceholder')} maxLength={100}
              value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') setQuery('');
              }}
            />
            <Icon name="search" size={26} className="search-icon" />
            {showBox && (
              <ul className="search-results" aria-live="polite">
                {looksLikeCase && (
                  isCase ? (
                    <li>
                      <button type="button" className="track-hit" onClick={() => router.push(`/ndiq/${compact}`)}>
                        <Icon name="search" size={18} />{t('home.search.track', { n: compact })} →
                      </button>
                    </li>
                  ) : <li className="search-note">{t('home.search.caseHint')}</li>
                )}

                {matches.length > 0 && <li className="group-title">{t('home.search.report')}</li>}
                {matches.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => router.push(`/raporto?lloji=${m.id}`)}>
                      <strong>{lang === 'en' ? m.nameEn : m.nameSq}</strong>
                      <span className="muted small"> · {lang === 'en' ? m.category.nameEn : m.category.nameSq}</span>
                    </button>
                  </li>
                ))}

                {searching && !looksLikeCase && <li className="search-note">{t('home.search.searching')}</li>}
                {places && places.length > 0 && (
                  <>
                    <li className="group-title">{t('home.search.open')}</li>
                    <li className="search-note">{t('home.search.openHint')}</li>
                    {places.map((c) => (
                      <li key={c.caseNumber}>
                        <Link href={`/ndiq/${c.caseNumber}`} className="search-hit">
                          <span>
                            <span className="case-number">{c.caseNumber}</span> · <strong>{typeName(c.type, lang)}</strong>
                            <span className="where">{[c.address, c.neighbourhood].filter(Boolean).join(' · ') || '–'}</span>
                          </span>
                          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><TestBadge show={c.isTest} /><StatusBadge status={c.publicStatus} /></span>
                        </Link>
                      </li>
                    ))}
                  </>
                )}

                {nothing && (
                  <li><button type="button" onClick={() => router.push('/raporto?kategoria=other')}>{t('home.noMatch')}</button></li>
                )}
              </ul>
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
