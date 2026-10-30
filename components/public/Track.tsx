'use client';
/**
 * "Ndiq raportimin". /ndiq: a box for the case number. /ndiq/EL-2026-00042:
 * that report only (the number is already on the page, so no search box,
 * unless the number was not found).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { followReportAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { MiniMap } from '@/components/maps';
import { StatusBadge, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { formatDate, key, typeName } from '@/lib/client/format';
import { hasSupported, isMine, rememberSupported } from '@/lib/client/myReports';
import type { PublicCase } from '@/lib/shared/types';
import { PublicTimeline } from './Cases';

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

/**
 * "I have this problem too": for OTHER residents who find a verified, open
 * report (on the map or by searching their street), instead of reporting it
 * again. Never shown to the person who made the report on this device, and
 * only once per device.
 */
function SameProblem({ caseNumber, supporters, mine }: { caseNumber: string; supporters: number; mine: boolean }) {
  const { t } = useI18n();
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  // Decided after loading, from what this device remembers (the server cannot know who made a report).
  const [state, setState] = useState<'unknown' | 'mine' | 'supported' | 'other'>('unknown');
  useEffect(() => {
    setState(mine || isMine(caseNumber) ? 'mine' : hasSupported(caseNumber) ? 'supported' : 'other');
  }, [caseNumber, mine]);
  async function follow() {
    setBusy(true);
    setError(null);
    try {
      const res = await call(followReportAction({ caseNumber }));
      rememberSupported(caseNumber);
      setDone(res.supporters);
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(false);
    }
  }
  if (done !== null) {
    return <div className="alert alert-ok" role="status">{t('track.sameProblemDone')} {t('track.supporters', { n: done })}</div>;
  }
  if (state === 'unknown' || state === 'mine') return null;
  if (state === 'supported') return <p className="hint"><Icon name="check" size={14} /> {t('track.sameProblemAlready')}</p>;
  return (
    <div>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={follow}>
        <Icon name="users" size={18} />{busy ? t('common.wait') : t('track.sameProblem')}
      </button>
      <p className="hint" style={{ marginTop: 6 }}>{supporters > 0 ? `${t('track.supporters', { n: supporters })}. ` : ''}{t('track.sameProblemHint')}</p>
      {error && <div className="alert alert-error" role="alert">{error.code === 'NETWORK' ? t('errors.network') : error.message}</div>}
    </div>
  );
}

export function CaseView({ lookup, mine = false }: { lookup: CaseLookup; mine?: boolean }) {
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
        {/* Only verified, open reports: a just-received report is not public yet, so only its author has the number. */}
        {['OPEN', 'IN_PROGRESS'].includes(data.publicStatus) && <SameProblem key={data.caseNumber} caseNumber={data.caseNumber} supporters={data.supporters} mine={mine} />}
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
      </aside>
    </article>
  );
}

export default function Track({ lookup, mine = false }: { lookup?: CaseLookup; mine?: boolean }) {
  const { t } = useI18n();
  const caseNumber = lookup ? (lookup.found ? lookup.data.caseNumber : lookup.caseNumber) : '';
  return (
    <div className="page">
      <div className="container stack">
        {!lookup && <h1>{t('track.title')}</h1>}
        {!lookup && <p className="muted">{t('track.intro')}</p>}
        {/* The search box only where a number is still needed: no number yet, or one that was not found. */}
        {(!lookup || !lookup.found) && <TrackForm initial={caseNumber} key={caseNumber} />}
        {lookup && !lookup.found && <hr className="divider" />}
        {lookup && <CaseView lookup={lookup} mine={mine} />}
      </div>
    </div>
  );
}
