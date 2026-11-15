'use client';
/**
 * Home page, a clean layout of four parts:
 *  1. the photo of Elbasan with the promise ("Raporto. Ndiqe. U rregullua."), the open reports
 *     (to the map) and the one main action in its corner ("Raporto me foto", or the form);
 *  2. right under it, the categories, the most reported first (the form filled in by hand), the rest behind "all";
 *  3. what the platform is, the three steps and its numbers;
 *  4. fixed recently, with the photos, and the map of the fixed ones.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Icon from '@/components/Icon';
import { useCatalog, useSettings, type TypeWithCategory } from '@/components/providers';
import { InstallBar } from '@/components/site/InstallApp';
import { CategoryIcon, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { matchTypes } from '@/lib/shared/guide';
import type { FixedReport, MapPoint } from '@/lib/shared/types';

export interface HomeNumbers {
  /** "2026-11": the month of fixedThisMonth. */
  month: string | null;
  fixedThisMonth: number;
  avgDays: number | null;
  openNow: number;
}

interface Props {
  numbers: HomeNumbers | null;
  fixed: FixedReport[];
  /** No longer drawn on the home page (the photo replaced the schematic map); kept so the page can still pass it. */
  points?: MapPoint[];
  /** The categories, the most reported in the last 90 days first (lib/server/services/publicReport.ts). */
  frequent?: Array<{ code: string; count: number }>;
}

/** The categories that have a photo in public/categories/ (the others keep their icon). */
const CATEGORY_PHOTOS = new Set(['waste', 'streets', 'animals', 'lighting', 'water', 'parks', 'construction', 'health', 'business']);

/** The categories shown before "Më shumë": the most reported ones. */
const TOP_CATEGORIES = 3;

export default function Home({ numbers, fixed, frequent = [] }: Props) {
  const { t, lang } = useI18n();
  const { catalog } = useCatalog();
  const { rules } = useSettings();
  // The categories in the order the server counted them (most reported first), "Tjetër" last;
  // a category the server did not list (just added) goes after the counted ones.
  const categories = useMemo(() => {
    const rank = new Map(frequent.map((f, i) => [f.code, i]));
    return [...catalog.categories].sort((a, b) =>
      Number(a.code === 'other') - Number(b.code === 'other')
      || (rank.get(a.code) ?? 999) - (rank.get(b.code) ?? 999));
  }, [catalog.categories, frequent]);
  const [allCategories, setAllCategories] = useState(false);
  const chipsId = useId();

  const { types } = useCatalog();
  const shown = allCategories ? categories : categories.slice(0, TOP_CATEGORIES);
  const examples = (code: string) => types.filter((ty) => ty.category.code === code && !ty.code.endsWith('.other')).slice(0, 3)
    .map((ty, i) => { const n = lang === 'en' ? ty.nameEn : ty.nameSq; return i ? n.charAt(0).toLowerCase() + n.slice(1) : n; }).join(', ');
  const reportHref = rules.aiChecks ? '/raporto' : '/raporto?menyra=formular';

  return (
    <>
      <InstallBar />

      {/* 1 · The photo of Elbasan, the promise, and the one main action in the corner. */}
      <section className="container hx-hero">
        <div className="hx-hero-media">
          <picture>
            <source srcSet="/elbasan-hero.webp" type="image/webp" />
            <img src="/elbasan-hero.jpg" alt={t('home.photoAlt')} width={1200} height={900} fetchPriority="high" />
          </picture>
          <div className="hx-hero-shade" aria-hidden="true" />
          {numbers && (
            <Link href="/harta" className="hx-hero-chip"><span className="dot" />{t('home.map.open', { n: numbers.openNow })}<Icon name="arrowRight" size={16} /></Link>
          )}
          <div className="hx-hero-copy">
            <h1 className="hx-title">
              <span>{t('home.hero.l1')} {t('home.hero.l2')}</span> <span className="accent">{t('home.hero.l3')}</span>
            </h1>
            <p>{t('home.hero.text')}</p>
          </div>
          {/* The bottom of the photo: "Ndiq raportimin" as a glass button on the left, the main action in the white corner. */}
          <div className="hx-hero-bar">
            <nav className="hx-hero-nav" aria-label={t('nav.menu')}>
              <Link href="/ndiq" className="hx-glass"><Icon name="route" size={18} /><span className="hx-long">{t('nav.track')}</span><span className="hx-short">{t('nav.trackShort')}</span></Link>
            </nav>
            <div className="hx-hero-tab">
              <Link href={reportHref} className="hx-cta">
                <Icon name={rules.aiChecks ? 'camera' : 'pin'} size={20} />
                {rules.aiChecks ? t('home.hero.photoButton') : t('home.hero.button')}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2 · Right under the main action: choosing the type yourself (the form filled in by hand), the most reported first. */}
      <section className="container hx-pick">
        <div className="hx-pick-head">
          <h2>{rules.aiChecks ? t('home.types.pickTitle') : t('home.types.title')}</h2>
          <p className="hx-sub">{rules.aiChecks ? t('home.types.pickSub') : t('home.types.sub')}</p>
        </div>
        {!rules.aiChecks && <ProblemSearch />}
        <ul id={chipsId} className="hx-rows">
          {shown.map((c, i) => {
            const photo = CATEGORY_PHOTOS.has(c.code) ? c.code : null;
            return (
              <li key={c.code}>
                {/* With a photo: text and "Raporto" on the left, the photo on the right (the first, most reported, in green). */}
                <Link href={`/raporto?kategoria=${c.code}`} className={`hx-row${photo ? ' hx-row-photo' : ''}${photo && i === 0 ? ' hx-row-feature' : ''}`}>
                  {!photo && <span className="hx-row-icon" aria-hidden="true"><CategoryIcon icon={c.icon} size={24} /></span>}
                  <span className="hx-row-text">
                    <strong>{lang === 'en' ? c.nameEn : c.nameSq}</strong>
                    {examples(c.code) && <span>{examples(c.code)}</span>}
                    {photo && <span className="hx-row-pill">{t('nav.report')}<Icon name="arrowRight" size={14} /></span>}
                  </span>
                  {photo
                    ? <picture className="hx-row-img"><source srcSet={`/categories/${photo}.webp`} type="image/webp" /><img src={`/categories/${photo}.jpg`} alt="" loading="lazy" width={800} height={600} /></picture>
                    : <Icon name="chevronRight" size={20} className="hx-row-go" />}
                </Link>
              </li>
            );
          })}
        </ul>
        {categories.length > TOP_CATEGORIES && (
          <button type="button" className="hx-more-link" aria-expanded={allCategories} aria-controls={chipsId} onClick={() => setAllCategories((v) => !v)}>
            {allCategories ? t('home.hero.fewerCategories') : t('home.types.all', { n: categories.length })}
            <Icon name={allCategories ? 'chevronUp' : 'chevronDown'} size={18} />
          </button>
        )}
      </section>

      {/* "Ndihmo qytetin": residents fix small things themselves, the group wins a reward. */}
      <section className="container hx-section">
        <Link href="/ndihmo" className="hx-help">
          <span className="hx-help-icon" aria-hidden="true"><Icon name="heart" size={24} /></span>
          <span className="hx-help-text"><strong>{t('community.home.title')}</strong><span>{t('community.home.text')}</span></span>
          <span className="hx-help-go">{t('community.home.button')}<Icon name="arrowRight" size={16} /></span>
        </Link>
      </section>

      {/* 3 · What the platform is, the three steps, and its numbers. */}
      <section className="container hx-about">
        <div>
          <h2>{t('home.about.title')}</h2>
          <p className="hx-lead">{t('home.about.text')}</p>
          <ol className="hx-steps">
            {['step1', 'step2', 'step3'].map((k, i) => (
              <li key={k}><span>{i + 1}</span>{t(`home.how.${k}.title`)}</li>
            ))}
          </ol>
        </div>
        {numbers && (
          <dl className="hx-stats">
            <div><span className="hx-stat-icon" aria-hidden="true"><Icon name="pin" size={18} /></span><dt>{numbers.openNow}</dt><dd>{t('home.numbers.openNow')}</dd></div>
            <div><span className="hx-stat-icon" aria-hidden="true"><Icon name="check" size={18} /></span><dt>{numbers.fixedThisMonth}</dt><dd>{t('home.numbers.fixedIn', { month: monthName(numbers.month, lang) })}</dd></div>
            <div><span className="hx-stat-icon" aria-hidden="true"><Icon name="clock" size={18} /></span><dt>{numbers.avgDays === null ? '–' : (Math.round(numbers.avgDays * 10) / 10).toString().replace('.', lang === 'en' ? '.' : ',')}</dt><dd>{t('home.numbers.avgDays')}</dd></div>
            <div><span className="hx-stat-icon" aria-hidden="true"><Icon name="phone" size={18} /></span><dt>24/7</dt><dd>{t('home.numbers.always')}</dd></div>
          </dl>
        )}
      </section>

      {/* 4 · Fixed recently: the municipality's work, with the photos. */}
      <section className="container hx-section">
        <div className={`hx-fixed hx-fixed-${Math.min(fixed.length, 4)}`}>
          <div className="hx-fixed-intro">
            <h2>{t('home.fixed.title')}</h2>
            <p className="hx-sub">{t('home.fixed.text')}</p>
          </div>
          {fixed.length === 0 && <p className="muted">{t('home.fixed.none')}</p>}
          {fixed.slice(0, 4).map((r, i) => (
            <Link key={r.caseNumber} href={`/ndiq/${r.caseNumber}`} className={`hx-fixed-card hx-f${i + 1}${r.photoUrl ? '' : ' hx-noimg'}`}>
              {r.photoUrl
                ? <img src={r.photoUrl} alt="" loading="lazy" />
                : <span className="hx-fixed-blank" aria-hidden="true"><CategoryIcon icon={r.category?.icon ?? 'other'} size={48} /></span>}
              <span className="hx-fixed-caption">
                <span className="hx-fixed-badge"><Icon name="check" size={13} strokeWidth={3} />{t('home.fixed.badge')}</span>
                <strong>{r.type ? (lang === 'en' ? r.type.nameEn : r.type.nameSq) : r.caseNumber}</strong>
                <span>{[r.place, ago(r.resolvedAt, t)].filter(Boolean).join(' · ')}</span>
              </span>
              {r.isTest && <span className="hx-fixed-test"><TestBadge show /></span>}
            </Link>
          ))}
          <Link href="/harta?status=resolved" className="hx-outline hx-fixed-more">{t('home.fixed.seeMap')}</Link>
        </div>
      </section>

      {/* 5 · Reported most often: the categories as small cards in a row that slides, each opening the form. */}
      <Popular categories={categories.filter((c) => c.code !== 'other').slice(0, 8)} counts={frequent} examples={examples} />
    </>
  );
}

/** "nëntor" / "November" from "2026-11". */
function monthName(month: string | null, lang: string): string {
  if (!month) return '';
  const d = new Date(`${month}-15T12:00:00Z`);
  if (lang === 'en') return d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'][d.getUTCMonth()]!;
}

function ago(iso: string, t: ReturnType<typeof useI18n>['t']): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return t('home.when.today');
  if (days === 1) return t('home.when.yesterday');
  return t('home.when.days', { n: days });
}

/**
 * "What needs fixing?": the problems that match what is typed (the same matching as the help
 * chat); choosing one, or "Report a problem", opens the report form at that type. With nothing
 * matched the form opens at the categories.
 */
function ProblemSearch() {
  const { t, lang } = useI18n();
  const { types } = useCatalog();
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const [closed, setClosed] = useState(false);
  const matches = useMemo(() => matchTypes(types, q, 6), [types, q]);
  const showList = !closed && matches.length > 0;

  const open = (ty: TypeWithCategory | undefined) => router.push(ty ? `/raporto?lloji=${ty.id}` : '/raporto?menyra=formular');
  function submit(e: FormEvent) {
    e.preventDefault();
    open(matches[active] ?? matches[0]);
  }
  function keys(e: KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    if (e.key === 'Escape') setClosed(true);
  }

  return (
    <form className="home-search" onSubmit={submit} role="search">
      <label htmlFor={`${id}-q`}>{t('home.hero.ask')}</label>
      <div className="home-search-row">
        <div className="home-search-field">
          <Icon name="search" size={20} />
          <input
            id={`${id}-q`} type="text" autoComplete="off" maxLength={80} value={q} placeholder={t('home.hero.placeholder')}
            role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={`${id}-list`}
            aria-activedescendant={showList && active >= 0 ? `${id}-o${active}` : undefined}
            onChange={(e) => { setQ(e.target.value); setActive(-1); setClosed(false); }} onKeyDown={keys}
          />
          {showList && (
            <ul id={`${id}-list`} role="listbox" className="home-search-list" aria-label={t('home.hero.suggestions')}>
              {matches.map((ty, i) => (
                <li key={ty.id} id={`${id}-o${i}`} role="option" aria-selected={i === active}>
                  <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => open(ty)}>
                    <CategoryIcon icon={ty.category.icon} size={20} />
                    <span><strong>{lang === 'en' ? ty.nameEn : ty.nameSq}</strong> · {lang === 'en' ? ty.category.nameEn : ty.category.nameSq}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" className="home-report-btn">{t('home.hero.button')}<Icon name="arrowRight" size={20} /></button>
      </div>
    </form>
  );
}


function Popular({ categories, counts, examples }: {
  categories: Array<{ code: string; icon: string; nameSq: string; nameEn: string }>;
  counts: Array<{ code: string; count: number }>;
  examples: (code: string) => string;
}) {
  const { t, lang } = useI18n();
  const track = useRef<HTMLUListElement>(null);
  if (categories.length === 0) return null;
  const countOf = new Map(counts.map((c) => [c.code, c.count]));
  const slide = (dir: 1 | -1) => {
    const el = track.current;
    const card = el?.querySelector('li');
    if (el && card) el.scrollBy({ left: dir * (card.getBoundingClientRect().width + 16), behavior: 'smooth' });
  };
  return (
    <section className="container hx-section hx-popular" aria-labelledby="hx-popular-title">
      <div className="hx-popular-head">
        <div>
          <h2 id="hx-popular-title">{t('home.frequent')}</h2>
          <p className="hx-sub">{t('home.frequentSub')}</p>
        </div>
        <div className="hx-popular-arrows">
          <button type="button" aria-label={t('home.frequentPrev')} onClick={() => slide(-1)}><Icon name="arrowLeft" size={18} /></button>
          <button type="button" aria-label={t('home.frequentNext')} onClick={() => slide(1)}><Icon name="arrowRight" size={18} /></button>
        </div>
      </div>
      <ul className="hx-popular-track" ref={track}>
        {categories.map((c) => {
          const n = countOf.get(c.code) ?? 0;
          return (
            <li key={c.code}>
              <Link href={`/raporto?kategoria=${c.code}`} className="hx-pop-card">
                <span className="hx-pop-photo">
                  {CATEGORY_PHOTOS.has(c.code) ? (
                    <picture>
                      <source srcSet={`/categories/${c.code}.webp`} type="image/webp" />
                      <img src={`/categories/${c.code}.jpg`} alt="" loading="lazy" />
                    </picture>
                  ) : <span className="hx-pop-blank"><CategoryIcon icon={c.icon} size={36} /></span>}
                  {n > 0 && <span className="hx-pop-badge"><Icon name="flag" size={13} />{t('home.frequentBadge', { n })}</span>}
                </span>
                <span className="hx-pop-body">
                  <strong>{lang === 'en' ? c.nameEn : c.nameSq}</strong>
                  <span>{examples(c.code)}</span>
                </span>
                <span className="hx-pop-foot">{t('home.frequentReport')}<Icon name="arrowRight" size={16} /></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
