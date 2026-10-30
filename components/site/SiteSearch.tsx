'use client';
/**
 * The search box in the menu bar, on every page ("Ask or search"). It answers
 * four kinds of input at once:
 *  - a question ("si raportoj", "sa zgjat") → a short answer from the guide the
 *    admin manages, with a button (matched in the browser: instant, no AI);
 *    emergencies ("zjarr") show the emergency numbers first;
 *  - a report number (EL-2026-00042)       → straight to its progress;
 *  - a problem ("gropë")                   → the report type, to report it;
 *  - a street or area ("Rinia")            → the OPEN reports there, so residents see
 *    that a problem is already reported (and support it) instead of reporting it twice.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchOpenReportsAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { GuideAnswer, guideQuestion } from '@/components/public/Guide';
import { StatusBadge, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import { typeName } from '@/lib/client/format';
import { matchGuide, matchTypes, type GuideItem } from '@/lib/shared/guide';
import type { PublicCard } from '@/lib/shared/types';

const CASE_RE = /^[A-Z]{1,6}-\d{4}-\d{5,}$/;
const CASE_START = /^[A-Z]{1,6}-\d/;

export default function SiteSearch({ guide }: { guide: GuideItem[] }) {
  const { t, lang } = useI18n();
  const { types } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<PublicCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Which answer is open: null = the first one, -1 = none (the resident closed it).
  const [openId, setOpenId] = useState<number | null>(null);
  const request = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const compact = trimmed.toUpperCase().replace(/\s+/g, '');
  const isCase = CASE_RE.test(compact);
  const looksLikeCase = CASE_START.test(compact);

  const answers = useMemo(
    () => (trimmed.length < 2 || looksLikeCase ? [] : matchGuide(guide, trimmed).map((m) => m.item)),
    [trimmed, looksLikeCase, guide],
  );
  const matches = useMemo(() => (looksLikeCase ? [] : matchTypes(types, trimmed)), [trimmed, looksLikeCase, types]);

  // Emergencies first (always open). When the text names a problem ("si raportoj një gropë"),
  // the report type comes before the answers and only the best answer is offered, closed.
  const emergencies = answers.filter((a) => a.emergency);
  const others = answers.filter((a) => !a.emergency).slice(0, matches.length ? 1 : 3);

  function type(value: string) {
    setQuery(value);
    setOpenId(null);
  }

  function go(href: string) {
    type('');
    router.push(href);
  }

  // A new page: start empty.
  useEffect(() => { type(''); }, [pathname]);

  // Click outside or Escape closes the results.
  useEffect(() => {
    if (!trimmed) return undefined;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) type('');
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [trimmed]);

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
  const nothing = showBox && !looksLikeCase && answers.length === 0 && matches.length === 0 && !searching && (places?.length ?? 0) === 0;

  function submit() {
    const first = answers[0];
    if (isCase) go(`/ndiq/${compact}`);
    else if (first?.emergency) setOpenId(first.id);
    else if (matches[0]) go(`/raporto?lloji=${matches[0].id}`);
    else if (first) setOpenId(first.id);
  }

  return (
    <div className="site-search" ref={boxRef} role="search">
      <label htmlFor="site-search" className="sr-only">{t('home.searchLabel')}</label>
      <input
        id="site-search" type="search" autoComplete="off" placeholder={t('home.searchPlaceholder')} maxLength={100}
        value={query} onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') type('');
        }}
      />
      <Icon name="search" size={20} className="search-icon" />
      {showBox && (
        <ul className="search-results" aria-live="polite">
          {looksLikeCase && (
            isCase ? (
              <li>
                <button type="button" className="track-hit" onClick={() => go(`/ndiq/${compact}`)}>
                  <Icon name="search" size={18} />{t('home.search.track', { n: compact })} →
                </button>
              </li>
            ) : <li className="search-note">{t('home.search.caseHint')}</li>
          )}

          {emergencies.map((item) => (
            <li key={`guide-${item.id}`} className="guide-hit emergency open">
              <div className="guide-title"><Icon name="alert" size={18} /><strong>{guideQuestion(item, lang)}</strong></div>
              <GuideAnswer item={item} onNavigate={() => type('')} />
            </li>
          ))}

          {matches.length > 0 && <li className="group-title">{t('home.search.report')}</li>}
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => go(`/raporto?lloji=${m.id}`)}>
                <strong>{lang === 'en' ? m.nameEn : m.nameSq}</strong>
                <span className="muted small"> · {lang === 'en' ? m.category.nameEn : m.category.nameSq}</span>
              </button>
            </li>
          ))}

          {others.length > 0 && <li className="group-title">{t('home.search.answers')}</li>}
          {others.map((item, i) => {
            const open = openId === item.id || (openId === null && i === 0 && matches.length === 0);
            return (
              <li key={`guide-${item.id}`} className={`guide-hit${open ? ' open' : ''}`}>
                <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? -1 : item.id)}>
                  <Icon name="help" size={18} />
                  <strong>{guideQuestion(item, lang)}</strong>
                  <Icon name="chevronDown" size={16} className="chevron" />
                </button>
                {open && <GuideAnswer item={item} onNavigate={() => type('')} />}
              </li>
            );
          })}

          {searching && !looksLikeCase && <li className="search-note">{t('home.search.searching')}</li>}
          {places && places.length > 0 && (
            <>
              <li className="group-title">{t('home.search.open')}</li>
              <li className="search-note">{t('home.search.openHint')}</li>
              {places.map((c) => (
                <li key={c.caseNumber}>
                  <Link href={`/ndiq/${c.caseNumber}`} className="search-hit" onClick={() => type('')}>
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

          {nothing && <li><button type="button" onClick={() => go('/raporto?kategoria=other')}>{t('home.noMatch')}</button></li>}
        </ul>
      )}
    </div>
  );
}
