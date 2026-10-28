'use client';
/** "Ndiq kërkesën": find a request by its case number and see its progress. */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import Icon from '@/components/Icon';
import { MiniMap } from '@/components/maps';
import { StatusBadge, TestBadge } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDate, key, typeName } from '@/lib/client/format';
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
        <TrackForm initial={caseNumber} key={caseNumber} />
        {lookup && <><hr className="divider" /><CaseView lookup={lookup} /></>}
      </div>
    </div>
  );
}
