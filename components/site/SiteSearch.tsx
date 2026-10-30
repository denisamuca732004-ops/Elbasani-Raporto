'use client';
/**
 * The search box in the menu bar, on every page ("Ask or search"). Clicked
 * before anything is typed, it lists the common questions (the first ones of
 * the guide, in the admin's order); each one opens its answer in place.
 * Typed text answers four kinds of input at once:
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
import { commonQuestions, matchGuide, matchTypes, type GuideItem } from '@/lib/shared/guide';
import type { PublicCard } from '@/lib/shared/types';

const CASE_RE = /^[A-Z]{1,6}-\d{4}-\d{5,}$/;
const CASE_START = /^[A-Z]{1,6}-\d/;

/** One question of the list: the question as a button; pressed, its answer opens under it. */
function Question({ item, open, onToggle, onNavigate }: { item: GuideItem; open: boolean; onToggle: () => void; onNavigate: () => void }) {
  const { lang } = useI18n();
  return (
    <li className={`guide-hit${open ? ' open' : ''}${item.emergency ? ' urgent' : ''}`}>
      <button type="button" aria-expanded={open} onClick={onToggle}>
        <Icon name={item.emergency ? 'alert' : 'help'} size={18} />
        <strong>{guideQuestion(item, lang)}</strong>
        <Icon name="chevronDown" size={16} className="chevron" />
      </button>
      {open && <GuideAnswer item={item} onNavigate={onNavigate} />}
    </li>
  );
}

export default function SiteSearch({ guide }: { guide: GuideItem[] }) {
  const { t, lang } = useI18n();
  const { types } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<PublicCard[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Which answer is open. Typed results: null = the first one, -1 = none (the resident
  // closed it). Common questions: only the one pressed.
  const [openId, setOpenId] = useState<number | null>(null);
  // The list under the box is shown (the box was clicked or typed in).
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
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

  // Before anything is typed: the common questions, "all questions" on request, emergencies last.
  const common = useMemo(() => commonQuestions(guide), [guide]);
  const allQuestions = useMemo(() => guide.filter((g) => !g.emergency), [guide]);
  const urgent = useMemo(() => guide.filter((g) => g.emergency), [guide]);
  const listed = showAll ? allQuestions : common;

  function type(value: string) {
    setQuery(value);
    setOpenId(null);
    setOpen(true);
  }

  /** Empty and closed: after choosing something, on a new page, or with Escape. */
  function reset() {
    setQuery('');
    setOpenId(null);
    setOpen(false);
    setShowAll(false);
  }

  function go(href: string) {
    reset();
    router.push(href);
  }

  // A new page: start empty.
  useEffect(() => { reset(); }, [pathname]);

  // A click or tap outside closes the list; the typed text stays, and clicking the box shows it again.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

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

  const showFaq = open && trimmed.length < 2 && (common.length > 0 || urgent.length > 0);
  const showBox = open && trimmed.length >= 2;
  const nothing = showBox && !looksLikeCase && answers.length === 0 && matches.length === 0 && !searching && (places?.length ?? 0) === 0;

  function submit() {
    const first = answers[0];
    if (isCase) go(`/ndiq/${compact}`);
    else if (first?.emergency) setOpenId(first.id);
    else if (matches[0]) go(`/raporto?lloji=${matches[0].id}`);
    else if (first) setOpenId(first.id);
  }

  return (
    <div
      className="site-search" ref={boxRef} role="search"
      // Tab out of the box (to another link or field) closes the list too.
      onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <label htmlFor="site-search" className="sr-only">{t('home.searchLabel')}</label>
      <input
        id="site-search" type="search" autoComplete="off" placeholder={t('home.searchPlaceholder')} maxLength={100}
        value={query} onChange={(e) => type(e.target.value)}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          // First Escape closes the list, a second one empties the box (not the browser's own clearing).
          if (e.key === 'Escape') { e.preventDefault(); if (open) setOpen(false); else reset(); }
        }}
      />
      <Icon name="search" size={20} className="search-icon" />
      {showFaq && (
        <ul className="search-results">
          <li className="group-title">{t('home.search.faq')}</li>
          {listed.map((item) => (
            <Question key={item.id} item={item} open={openId === item.id} onToggle={() => setOpenId(openId === item.id ? null : item.id)} onNavigate={reset} />
          ))}
          {!showAll && allQuestions.length > common.length && (
            <li><button type="button" className="more-hit" onClick={() => setShowAll(true)}>{t('home.search.more', { n: allQuestions.length })}</button></li>
          )}
          {urgent.map((item) => (
            <Question key={item.id} item={item} open={openId === item.id} onToggle={() => setOpenId(openId === item.id ? null : item.id)} onNavigate={reset} />
          ))}
          <li className="search-note">{t('home.search.faqHint')}</li>
        </ul>
      )}
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
              <GuideAnswer item={item} onNavigate={reset} />
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
            const expanded = openId === item.id || (openId === null && i === 0 && matches.length === 0);
            return <Question key={`guide-${item.id}`} item={item} open={expanded} onToggle={() => setOpenId(expanded ? -1 : item.id)} onNavigate={reset} />;
          })}

          {searching && !looksLikeCase && <li className="search-note">{t('home.search.searching')}</li>}
          {places && places.length > 0 && (
            <>
              <li className="group-title">{t('home.search.open')}</li>
              <li className="search-note">{t('home.search.openHint')}</li>
              {places.map((c) => (
                <li key={c.caseNumber}>
                  <Link href={`/ndiq/${c.caseNumber}`} className="search-hit" onClick={reset}>
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
