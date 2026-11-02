'use client';
/**
 * "Ndiq raportimin". /ndiq: the report number, OR (no number at hand) a search
 * by the day of the report, its zone, its category, or the name and phone
 * left on it (both: a name alone finds nothing). /ndiq/EL-2026-00042: that
 * report only (the number is already on the page, so no form, unless the
 * number was not found). The page only shows the report: no "I have this
 * problem too" button (the report form offers that, where it avoids a duplicate).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { findReportsAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { MiniMap } from '@/components/maps';
import { useCatalog } from '@/components/providers';
import { ErrorAlert, Field, StatusBadge, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { formatDate, key, typeName } from '@/lib/client/format';
import type { PublicCard, PublicCase } from '@/lib/shared/types';
import { PublicTimeline } from './Cases';

/** Today in the browser, for the highest date that can be chosen. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** No number at hand: find the report by the day, the zone, the category, or the name + phone left on it. */
export function TrackSearch() {
  const { t, lang } = useI18n();
  const { catalog } = useCatalog();
  const [form, setForm] = useState({ date: '', zoneId: '', category: '', name: '', phone: '' });
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PublicCard[] | null>(null);
  const set = (k: keyof typeof form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setProblem(null); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!form.date && !form.zoneId && !form.category && !name && !phone) { setProblem(t('track.search.needOne')); return; }
    if (Boolean(name) !== Boolean(phone)) { setProblem(t('track.search.needBoth')); return; }
    setBusy(true);
    setError(null);
    try {
      setResults(await call(findReportsAction({
        ...(form.date ? { date: form.date } : {}),
        ...(form.zoneId ? { zoneId: Number(form.zoneId) } : {}),
        ...(form.category ? { category: form.category } : {}),
        ...(name ? { name, phone } : {}),
      })));
    } catch (err) {
      setResults(null);
      setError(err as ActionFailure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card track-search" aria-labelledby="track-search-title">
      <h2 id="track-search-title">{t('track.search.title')}</h2>
      <p className="muted">{t('track.search.intro')}</p>
      <form onSubmit={submit} noValidate>
        <div className="grid-3">
          <Field label={t('track.search.date')} htmlFor="ts-date">
            <input id="ts-date" type="date" value={form.date} max={today()} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label={t('track.search.zone')} htmlFor="ts-zone">
            <select id="ts-zone" value={form.zoneId} onChange={(e) => set('zoneId', e.target.value)}>
              <option value="">{t('track.search.anyZone')}</option>
              {catalog.neighbourhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </Field>
          <Field label={t('track.category')} htmlFor="ts-category">
            <select id="ts-category" value={form.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">{t('track.search.anyCategory')}</option>
              {catalog.categories.map((c) => <option key={c.code} value={c.code}>{lang === 'en' ? c.nameEn : c.nameSq}</option>)}
            </select>
          </Field>
        </div>
        <p className="track-or">{t('track.search.contactTitle')}</p>
        <div className="grid-2">
          <Field label={t('track.search.name')} htmlFor="ts-name">
            <input id="ts-name" type="text" autoComplete="name" maxLength={160} value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={t('track.search.phone')} htmlFor="ts-phone">
            <input id="ts-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={form.phone} onChange={(e) => set('phone', e.target.value.replace(/[^0-9 +()-]/g, ''))} />
          </Field>
        </div>
        <p className="hint" style={{ marginTop: -4 }}>{t('track.search.contactHint')}</p>
        {problem && <div className="alert alert-warn" role="alert">{problem}</div>}
        <ErrorAlert error={error} />
        <button className="btn" type="submit" disabled={busy}><Icon name="search" size={18} />{busy ? t('track.search.searching') : t('track.find')}</button>
      </form>
      {results && (
        <div className="track-results" aria-live="polite">
          <p><strong>{results.length ? t('track.search.found', { n: results.length }) : t('track.search.none')}</strong></p>
          {results.length > 0 && (
            <ul className="chat-links">
              {results.map((c) => (
                <li key={c.caseNumber}>
                  <Link href={`/ndiq/${c.caseNumber}`}>
                    <span>
                      <span className="case-number">{c.caseNumber}</span> · <strong>{typeName(c.type, lang)}</strong>
                      <span className="where">{[formatDate(c.createdAt, lang), c.address || c.neighbourhood].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><TestBadge show={c.isTest} /><StatusBadge status={c.publicStatus} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {results.length >= 20 && <p className="hint">{t('track.search.narrow')}</p>}
        </div>
      )}
    </section>
  );
}

export const CASE_NUMBER_RE = /^[A-Z]{1,6}-\d{4}-\d{5,}$/;

export function TrackForm({ initial = '', basePath = '/ndiq' }: { initial?: string; basePath?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    const v = value.trim().toUpperCase().replace(/\s+/g, '');
    if (!CASE_NUMBER_RE.test(v)) {
      setInvalid(true);
      return;
    }
    router.push(`${basePath}/${v}`);
  }
  return (
    <form onSubmit={submit} className="row" style={{ alignItems: 'flex-end' }} noValidate>
      <div className="field" style={{ flex: '1 1 260px', margin: 0 }}>
        <label htmlFor="case">{t('track.caseNumber')}</label>
        <input id="case" type="text" placeholder="EL-2026-00042" value={value} onChange={(e) => { setValue(e.target.value); setInvalid(false); }} />
      </div>
      <button className="btn" type="submit"><Icon name="search" size={18} />{t('track.find')}</button>
      {invalid && <div className="alert alert-warn" style={{ width: '100%', margin: '8px 0 0' }}>{t('track.invalid')}</div>}
    </form>
  );
}

export type CaseLookup = { found: true; data: PublicCase } | { found: false; caseNumber: string; error?: boolean };

export function CaseView({ lookup }: { lookup: CaseLookup }) {
  const { t, lang } = useI18n();
  if (!lookup.found) {
    return lookup.error
      ? <div className="alert alert-error" role="alert">{t('errors.generic')}</div>
      : <div className="alert alert-warn">{t('track.notFound', { n: lookup.caseNumber })}</div>;
  }
  const data = lookup.data;
  return (
    <article className="detail-grid">
      <div className="stack">
        <div className="row"><StatusBadge status={data.publicStatus} /><TestBadge show={data.isTest} /></div>
        <h1 style={{ marginBottom: 4 }}>{typeName(data.type, lang)}</h1>
        <p className="case-number" style={{ fontSize: '1.2rem' }}>{data.caseNumber}</p>
        <p className="muted">{t(`statusHelp.${key(data.publicStatus)}`)}</p>
        {data.rejectionReason && <div className="alert alert-error"><strong>{t('track.rejectionReason')}:</strong> {data.rejectionReason}</div>}
        {data.closingNote && <div className="alert alert-ok"><strong>{t('track.closingNote')}:</strong> {data.closingNote}</div>}
        {(data.beforePhotoUrl || data.afterPhotoUrl) && (
          <div className="photos">
            {/* eslint-disable @next/next/no-img-element -- photos come from our own protected route */}
            {data.beforePhotoUrl && <figure><img src={data.beforePhotoUrl} alt={t('track.before')} loading="lazy" /><figcaption>{t('track.before')}</figcaption></figure>}
            {data.afterPhotoUrl && <figure><img src={data.afterPhotoUrl} alt={t('track.after')} loading="lazy" /><figcaption>{t('track.after')}</figcaption></figure>}
            {/* eslint-enable @next/next/no-img-element */}
          </div>
        )}
        {data.description && <div><h3>{t('report.description')}</h3><p>{data.description}</p></div>}
        <div>
          <h3>{t('track.history')}</h3>
          <PublicTimeline items={data.timeline} />
        </div>
      </div>
      <aside className="stack">
        <div className="card">
          <dl className="kv">
            <dt>{t('track.category')}</dt><dd>{(lang === 'en' ? data.category?.nameEn : data.category?.nameSq) ?? '–'}</dd>
            <dt>{t('track.opened')}</dt><dd>{formatDate(data.createdAt, lang, true)}</dd>
            <dt>{t('track.updated')}</dt><dd>{formatDate(data.updatedAt, lang, true)}</dd>
            {data.resolvedAt && (<><dt>{t('track.resolvedOn')}</dt><dd>{formatDate(data.resolvedAt, lang, true)}</dd></>)}
            <dt>{t('track.sector')}</dt><dd>{(lang === 'en' ? data.departmentEn : data.departmentSq) || '–'}</dd>
            <dt>{t('track.location')}</dt><dd>{data.address || data.neighbourhood || '–'}</dd>
            {data.supporters > 0 && (<><dt>{t('track.others')}</dt><dd>{t('track.supporters', { n: data.supporters })}</dd></>)}
          </dl>
        </div>
        <MiniMap latitude={data.latitude} longitude={data.longitude} />
        {data.locationApproximate && <p className="hint" style={{ marginTop: 0 }}>{t('map.approximateCase')}</p>}
      </aside>
    </article>
  );
}

export default function Track({ lookup }: { lookup?: CaseLookup }) {
  const { t } = useI18n();
  const caseNumber = lookup ? (lookup.found ? lookup.data.caseNumber : lookup.caseNumber) : '';
  return (
    <div className="page">
      <div className="container stack">
        {!lookup && <h1>{t('track.title')}</h1>}
        {!lookup && <p className="muted">{t('track.intro')}</p>}
        {/* The number field only where a number is still needed: no number yet, or one that was not found. */}
        {(!lookup || !lookup.found) && <TrackForm initial={caseNumber} key={caseNumber} />}
        {lookup && !lookup.found && <hr className="divider" />}
        {lookup && <CaseView lookup={lookup} />}
        {(!lookup || !lookup.found) && <TrackSearch />}
      </div>
    </div>
  );
}
