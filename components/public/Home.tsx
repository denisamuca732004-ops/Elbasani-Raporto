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
import { useCatalog, type TypeWithCategory } from '@/components/providers';
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
  points: MapPoint[];
  frequent?: Array<{ id: number; count: number }>;
}

export default function Home({ numbers, fixed, points, frequent = [] }: Props) {
  const { t, lang } = useI18n();
  const { catalog, typeById } = useCatalog();
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
            <ProblemSearch />
            <nav className="home-chips" aria-label={t('home.hero.categories')}>
              {catalog.categories.map((c) => (
                <Link key={c.code} href={`/raporto?kategoria=${c.code}`} className="home-chip">
                  <CategoryIcon icon={c.icon} size={20} />{lang === 'en' ? c.nameEn : c.nameSq}
                </Link>
              ))}
            </nav>
          </div>
          <div className="home-hero-side">
            <CityMap points={points} openNow={numbers?.openNow ?? null} />
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
              <Link href="/harta">{t('home.fixed.seeMap')}</Link>
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

  const open = (ty: TypeWithCategory | undefined) => router.push(ty ? `/raporto?lloji=${ty.id}` : '/raporto');
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

/* ── The schematic city map ── */

// The centre of Elbasan, mapped onto the 660 × 400 drawing (≈ 5 × 3 km). Reports outside it are left out.
const BOX = { west: 20.052, east: 20.112, south: 41.097, north: 41.124 };
const MAP_W = 660;
const MAP_H = 400;
const x = (lng: number) => ((lng - BOX.west) / (BOX.east - BOX.west)) * MAP_W;
const y = (lat: number) => ((BOX.north - lat) / (BOX.north - BOX.south)) * MAP_H;
const MAX_DOTS = 40;

function CityMap({ points, openNow }: { points: MapPoint[]; openNow: number | null }) {
  const { t } = useI18n();
  const dots = points
    .filter((p) => p.longitude > BOX.west && p.longitude < BOX.east && p.latitude > BOX.south && p.latitude < BOX.north)
    .slice(0, MAX_DOTS);
  return (
    <Link href="/harta" className="home-map" aria-label={t('home.map.label')}>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-hidden="true" focusable="false">
        <rect width={MAP_W} height={MAP_H} rx="14" className="m-ground" />
        <g className="m-streets">
          <path d="M60 0 L150 400" /><path d="M200 0 L222 400" /><path d="M360 0 L372 400" />
          <path d="M520 0 L498 400" /><path d="M0 182 Q330 168 660 176" /><path d="M0 300 Q330 290 660 280" />
        </g>
        <path className="m-river" d="M0 372 C 160 352 300 384 440 362 S 600 342 660 352 L 660 400 L 0 400 Z" />
        <rect className="m-park" x="430" y="96" width="92" height="52" rx="10" />
        <path className="m-castle" d="M312 164 h8 v-8 h10 v8 h12 v-8 h10 v8 h12 v-8 h8 v54 h-60 z" />
        <text className="m-label" x="476" y="84" textAnchor="middle">Parku Rinia</text>
        <text className="m-label" x="342" y="238" textAnchor="middle">Kalaja</text>
        <text className="m-label m-river-label" x="610" y="390" textAnchor="end">Shkumbini</text>
        {dots.map((p) => <Dot key={p.caseNumber} p={p} />)}
      </svg>
      {openNow !== null && <span className="home-map-pill"><span className="dot" />{t('home.map.open', { n: openNow })}</span>}
    </Link>
  );
}

function Dot({ p }: { p: MapPoint }) {
  const cx = x(p.longitude), cy = y(p.latitude);
  if (p.publicStatus === 'IN_PROGRESS') return <circle className="m-dot-work" cx={cx} cy={cy} r="7" />;
  if (p.publicStatus === 'RESOLVED' || p.publicStatus === 'CLOSED') {
    return <g className="m-dot-done"><circle cx={cx} cy={cy} r="8" /><path d={`M${cx - 3.5} ${cy} l2.5 2.5 l4.5 -5`} /></g>;
  }
  return <circle className="m-dot-open" cx={cx} cy={cy} r="7" />;
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
