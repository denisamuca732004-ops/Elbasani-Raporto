'use client';
/**
 * The report as a sector that works by e-mail sees it from its link (no account): every detail,
 * the photos, the resident's contact, the history. First "E pranojmë" (→ "Në punë") or "Nuk mund ta
 * trajtojmë" (reason → back to the admin); once accepted, "U zgjidh" (note + optional "after" photo).
 */
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { sectorResolveAction, sectorReviewAction, sectorStartAction } from '@/actions/sector';
import Icon from '@/components/Icon';
import { MiniMap } from '@/components/maps';
import PhotoInput from '@/components/PhotoInput';
import { useSettings } from '@/components/providers';
import { CategoryIcon, ErrorAlert, Field, InternalStatusBadge, OverdueBadge, PriorityBadge, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { formatDate } from '@/lib/client/format';
import { uploadPhoto } from '@/lib/client/upload';
import { LIMITS } from '@/lib/shared/domain';
import type { SectorLookup } from '@/lib/server/services/sectorLink';
import { PublicTimeline } from './Cases';

type Panel = 'start' | 'resolve' | 'review' | null;

export default function SectorReport({ lookup }: { lookup: SectorLookup }) {
  const { t, lang } = useI18n();
  const { rules } = useSettings();
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [reason, setReason] = useState('');
  const [suggested, setSuggested] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!lookup.ok) {
    return (
      <div className="page">
        <div className="container stack" style={{ maxWidth: 720 }}>
          <h1>{t('sector.title')}</h1>
          <div className="alert alert-warn" role="alert">{lookup.message || t('sector.invalid')}</div>
        </div>
      </div>
    );
  }
  const r = lookup.view;
  const accepted = r.status === 'IN_PROGRESS';

  function open(next: Panel) {
    setPanel(panel === next ? null : next);
    setError(null);
    setDone(null);
  }

  async function act(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await run();
      setDone(message);
      setPanel(null);
      setNote('');
      setPhoto(null);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(false);
    }
  }

  const start = () => act(() => call(sectorStartAction(r.token, note.trim() ? { note: note.trim() } : {})), t('sector.startDone'));
  const resolve = () => act(async () => {
    const photoKey = photo ? await uploadPhoto(photo) : undefined;
    return call(sectorResolveAction(r.token, { note: note.trim(), ...(photoKey ? { photoKey } : {}) }));
  }, t('sector.resolveDone'));
  const review = () => act(() => call(sectorReviewAction(r.token, {
    reason: reason.trim(), ...(suggested ? { suggestedDepartmentId: Number(suggested) } : {}),
  })), t('sector.reviewDone'));

  const kv = (label: string, value: ReactNode) => (<><dt>{label}</dt><dd>{value || '–'}</dd></>);

  return (
    <div className="page">
      <div className="container stack">
        <p className="step-label" style={{ margin: 0 }}>{t('sector.for', { sector: r.departmentSq })}</p>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <CategoryIcon icon={r.categoryIcon} size={36} />
          <div>
            <h1 style={{ margin: 0 }}>{r.typeSq}</h1>
            <p className="case-number" style={{ margin: '4px 0 0', fontSize: '1.1rem' }}>{r.caseNumber}</p>
          </div>
        </div>
        <div className="row"><InternalStatusBadge status={r.status} /><PriorityBadge priority={r.priority} /><OverdueBadge show={r.overdue} /></div>

        {done && <SuccessAlert>{done}</SuccessAlert>}
        {r.pendingReview && (
          <div className="alert alert-warn" role="status">
            <strong>{t('sector.pendingTitle')}</strong> {t('sector.pendingText', { date: formatDate(r.pendingReview.at, lang) })} “{r.pendingReview.reason}”
          </div>
        )}
        {r.lastDecision && !r.lastDecision.approved && !r.pendingReview && (
          <div className="alert alert-warn" role="status">
            <strong>{t('sector.declinedTitle')}</strong> {r.lastDecision.note ? `“${r.lastDecision.note}”` : ''} {t('sector.declinedText')}
          </div>
        )}

        {/* The three actions, while the report is still to be done. */}
        {!r.final && (
          <section className="card sector-actions" aria-labelledby="sector-actions-title">
            <h2 id="sector-actions-title">{t('sector.actionsTitle')}</h2>
            {/* First the sector accepts the report (or sends it back); once accepted, it marks it fixed. */}
            {!accepted && <p className="hint" style={{ marginTop: 0 }}>{t('sector.acceptIntro')}</p>}
            <div className="row">
              {!accepted && (
                <button type="button" className={`btn${panel === 'start' ? '' : ' btn-outline'}`} aria-expanded={panel === 'start'} onClick={() => open('start')}>
                  <Icon name="check" size={18} />{t('sector.start')}
                </button>
              )}
              {accepted && (
                <button type="button" className={`btn${panel === 'resolve' ? '' : ' btn-outline'}`} aria-expanded={panel === 'resolve'} onClick={() => open('resolve')}>
                  <Icon name="check" size={18} />{t('sector.resolve')}
                </button>
              )}
              {!r.pendingReview && (
                <button type="button" className={`btn btn-ghost${panel === 'review' ? ' active' : ''}`} aria-expanded={panel === 'review'} onClick={() => open('review')}>
                  <Icon name="transfer" size={18} />{t('sector.review')}
                </button>
              )}
            </div>

            {panel === 'start' && (
              <div className="sector-form">
                <Field label={t('sector.startNote')} hint={t('sector.publicHint')} htmlFor="s-note">
                  <textarea id="s-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 70 }} />
                </Field>
                <button type="button" className="btn" disabled={busy} onClick={start}>{busy ? t('common.wait') : t('sector.startConfirm')}</button>
              </div>
            )}
            {panel === 'resolve' && (
              <div className="sector-form">
                <Field label={t('sector.resolveNote')} hint={t('sector.publicHint')} htmlFor="s-done" required>
                  <textarea id="s-done" value={note} maxLength={2000} aria-required="true" onChange={(e) => setNote(e.target.value)} style={{ minHeight: 80 }} />
                </Field>
                <div className="field">
                  <span className="label">{t('sector.afterPhoto')}</span>
                  <PhotoInput value={photo} onChange={setPhoto} maxBytes={rules.maxUploadBytes} idPrefix="after" />
                </div>
                <button type="button" className="btn" disabled={busy || note.trim().length < 5} onClick={resolve}>{busy ? t('common.wait') : t('sector.resolveConfirm')}</button>
              </div>
            )}
            {panel === 'review' && (
              <div className="sector-form">
                <p className="hint" style={{ marginTop: 0 }}>{t('sector.reviewIntro')}</p>
                <Field label={t('sector.reviewReason')} htmlFor="s-reason" required>
                  <textarea id="s-reason" value={reason} maxLength={1000} aria-required="true" onChange={(e) => setReason(e.target.value)} style={{ minHeight: 80 }} />
                </Field>
                <Field label={t('sector.reviewSuggest')} htmlFor="s-suggest">
                  <select id="s-suggest" value={suggested} onChange={(e) => setSuggested(e.target.value)}>
                    <option value="">{t('sector.reviewSuggestNone')}</option>
                    {r.departments.map((d) => <option key={d.id} value={d.id}>{d.nameSq}</option>)}
                  </select>
                </Field>
                <button type="button" className="btn" disabled={busy || reason.trim().length < LIMITS.minTransferReason} onClick={review}>
                  {busy ? t('common.wait') : t('sector.reviewConfirm')}
                </button>
              </div>
            )}
            <ErrorAlert error={error} />
          </section>
        )}
        {r.final && (
          <div className="alert alert-ok" role="status">
            {t('sector.finalText')}{r.closingNote ? ` “${r.closingNote}”` : ''}{r.rejectionReason ? ` “${r.rejectionReason}”` : ''}
          </div>
        )}

        <div className="detail-grid">
          <div className="stack">
            <div><h3>{t('report.description')}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{r.description || '–'}</p></div>
            {r.photos.length > 0 && (
              <div className="photos">
                {/* eslint-disable @next/next/no-img-element -- photos come from our own protected route */}
                {r.photos.map((p) => (
                  <figure key={p.id}><img src={p.url} alt={p.kind === 'AFTER' ? t('track.after') : t('track.before')} loading="lazy" /><figcaption>{p.kind === 'AFTER' ? t('track.after') : t('track.before')}</figcaption></figure>
                ))}
                {/* eslint-enable @next/next/no-img-element */}
              </div>
            )}
            <div><h3>{t('track.history')}</h3><PublicTimeline items={r.timeline} /></div>
          </div>
          <aside className="stack">
            <div className="card">
              <dl className="kv">
                {kv(t('track.category'), `${r.categorySq} · ${r.typeSq}`)}
                {kv(t('sector.received'), formatDate(r.createdAt, lang, true))}
                {kv(t('sector.due'), r.dueAt ? formatDate(r.dueAt, lang) : null)}
                {kv(t('track.location'), [r.address, r.zone].filter(Boolean).join(' · '))}
                {kv(t('sector.resident'), r.contact
                  ? <>{r.contact.name || '–'}{r.contact.phone && <><br /><a href={`tel:${r.contact.phone.replace(/\s/g, '')}`}><Icon name="phone" size={14} /> {r.contact.phone}</a></>}</>
                  : t('sector.anonymous'))}
              </dl>
            </div>
            <MiniMap latitude={r.latitude} longitude={r.longitude} />
            {r.approximate && <p className="hint" style={{ marginTop: 0 }}>{t('map.approximateCase')}</p>}
            <p className="small muted">{t('sector.linkNote', { date: formatDate(r.linkExpires, lang) })}</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
