'use client';
/**
 * Home page (design v2 by the mentors):
 *  - the first screen: "Report. Track. Fixed.", "What needs fixing?" (a problem typed here opens
 *    its report type), the categories, and a schematic city map with the reports of the last
 *    3 months, the number open, fixed this month and the average days to fix;
 *  - "Recently fixed" with the municipality's note, next to "Frequently reported" (information
 *    only, not links);
 *  - how it works, in three steps.
 * Questions are answered by the help chat at the bottom right (components/site/ChatHelp.tsx).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import Icon from '@/components/Icon';
import { useCatalog, useSettings, type TypeWithCategory } from '@/components/providers';
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
  frequent?: Array<{ id: number; count: number }>;
}

export default function Home({ numbers, fixed, frequent = [] }: Props) {
  const { t, lang } = useI18n();
  const { catalog, typeById } = useCatalog();
  const { rules } = useSettings();
  // Only types still in the catalogue (active), in the order the server counted them.
  const frequentTypes = frequent.flatMap(({ id, count }) => { const ty = typeById(id); return ty ? [{ ty, count }] : []; });

  return (
    <>
      <section className="home-hero">
        <div className="container home-hero-grid">
          <div className="home-hero-text">
            <h1 className="home-title">
              <span>{t('home.hero.l1')}</span>
              <span>{t('home.hero.l2')}</span>
              <span className="accent">{t('home.hero.l3')}</span>
            </h1>
            <p className="home-lead">{t('home.hero.text')}</p>
            {/* With the AI on: one main action, the photo (the type and the description are proposed from it);
                choosing the type yourself stays possible from the categories. Without the AI: the search. */}
            {rules.aiChecks ? (
              <Link href="/raporto" className="home-photo-cta">
                <Icon name="camera" size={24} />
                <span><strong>{t('home.hero.photoButton')}</strong><span>{t('home.hero.photoHint')}</span></span>
                <Icon name="arrowRight" size={20} />
              </Link>
            ) : <ProblemSearch />}
            {rules.aiChecks && <p className="home-chips-label">{t('home.hero.chooseSelf')}</p>}
            <nav className="home-chips" aria-label={rules.aiChecks ? t('home.hero.chooseSelf') : t('home.hero.categories')}>
              {catalog.categories.map((c) => (
                <Link key={c.code} href={`/raporto?kategoria=${c.code}`} className="home-chip">
                  <CategoryIcon icon={c.icon} size={20} />{lang === 'en' ? c.nameEn : c.nameSq}
                </Link>
              ))}
            </nav>
          </div>
          <div className="home-hero-side">
            <CityPhoto openNow={numbers?.openNow ?? null} />
            {numbers && <HomeNumbersLine numbers={numbers} />}
            <Link href="/ndiq" className="home-track"><Icon name="route" size={20} />{t('home.trackButton')}</Link>
          </div>
        </div>
      </section>
      <div className="home-wall" aria-hidden="true" />

      <section className="home-band">
        <div className="container home-columns">
          <div>
            <div className="home-section-head">
              <h2>{t('home.fixed.title')}</h2>
              <Link href="/harta?status=resolved">{t('home.fixed.seeMap')}</Link>
            </div>
            {fixed.length === 0 && <p className="muted">{t('home.fixed.none')}</p>}
            <ul className="home-list">
              {fixed.map((r) => (
                <li key={r.caseNumber}>
                  <span className="home-list-icon"><CategoryIcon icon={r.category?.icon ?? 'other'} size={22} /></span>
                  <div>
                    <div className="home-list-title">
                      <Link href={`/ndiq/${r.caseNumber}`}>{r.type ? (lang === 'en' ? r.type.nameEn : r.type.nameSq) : r.caseNumber}</Link>
                      <span className="home-fixed-badge"><Icon name="check" size={14} strokeWidth={3} />{t('home.fixed.badge')}</span>
                      <TestBadge show={r.isTest} />
                    </div>
                    <div className="home-list-meta">{[r.place, ago(r.resolvedAt, t)].filter(Boolean).join(' · ')}</div>
                    {r.note && <p className="home-list-note">{r.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {frequentTypes.length > 0 && (
            <div>
              <div className="home-section-head"><h2>{t('home.frequent')}</h2></div>
              {/* Information only: a report starts from a category or the search above. */}
              <ul className="home-list">
                {frequentTypes.map(({ ty, count }) => (
                  <li key={ty.id}>
                    <span className="home-list-icon"><CategoryIcon icon={ty.category.icon} size={22} /></span>
                    <div>
                      <div className="home-list-title"><strong>{lang === 'en' ? ty.nameEn : ty.nameSq}</strong></div>
                      <div className="home-list-meta">
                        {lang === 'en' ? ty.category.nameEn : ty.category.nameSq}{count > 0 && ` · ${t('home.frequentCount', { n: count })}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="container home-how">
          <h2>{t('home.how.title')}</h2>
          <ol className="home-steps">
            {['step1', 'step2', 'step3'].map((k, i) => (
              <li key={k}>
                <span className="home-step-number">{i + 1}</span>
                <h3>{t(`home.how.${k}.title`)}</h3>
                <p>{t(`home.how.${k}.text`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
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

/* ── The photo of Elbasan (Kalaja and the clock tower), with the open reports linking to the map ── */
function CityPhoto({ openNow }: { openNow: number | null }) {
  const { t } = useI18n();
  return (
    <Link href="/harta" className="home-photo" aria-label={t('home.map.label')}>
      <picture>
        <source srcSet="/elbasan-hero.webp" type="image/webp" />
        <img src="/elbasan-hero.jpg" alt={t('home.photoAlt')} width={1200} height={900} fetchPriority="high" />
      </picture>
      {openNow !== null && <span className="home-map-pill"><span className="dot" />{t('home.map.open', { n: openNow })}</span>}
    </Link>
  );
}

// Browsers do not all carry Albanian month names, so they are written here.
const MONTHS_SQ = ['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function HomeNumbersLine({ numbers }: { numbers: HomeNumbers }) {
  const { t, lang } = useI18n();
  const m = numbers.month ? Number(numbers.month.slice(5, 7)) - 1 : -1;
  const month = (lang === 'en' ? MONTHS_EN : MONTHS_SQ)[m] ?? '';
  const days = numbers.avgDays === null ? null : (Math.round(numbers.avgDays * 10) / 10).toString().replace('.', lang === 'en' ? '.' : ',');
  return (
    <p className="home-numbers">
      <span><strong>{numbers.fixedThisMonth}</strong> {t('home.numbers.fixedIn', { month })}</span>
      {days !== null && <span><strong>{days}</strong> {t('home.numbers.avgDays')}</span>}
      <span><strong>{numbers.openNow}</strong> {t('home.numbers.openNow')}</span>
    </p>
  );
}
