'use client';
/**
 * "Krijo një aksion": the photo (the AI can fill in the rest from it), what, where on the map,
 * when, how many people, the organiser (first name public, phone never), the safety rules.
 * The secret organiser link is kept in this browser (lib/client/community.ts).
 */
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createActionAction, draftActionAction } from '@/actions/community';
import { placeAtAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import PhotoInput from '@/components/PhotoInput';
import { LocationPicker } from '@/components/maps';
import { useSettings } from '@/components/providers';
import { ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call, fieldErrorsOf } from '@/lib/client/action';
import { deviceRef, durationText, saveOrganizerToken, takeHandedPhoto } from '@/lib/client/community';
import { formToken, prefetchFormToken } from '@/lib/client/formToken';
import type { LatLng } from '@/lib/client/format';
import { askPushPermission, browserSubscription, pushSupport } from '@/lib/client/push';
import { uploadPhoto } from '@/lib/client/upload';
import type { CommunitySettings } from '@/lib/shared/types';

const pad = (n: number) => String(n).padStart(2, '0');
/** The next full hour, as the value of <input type="datetime-local">. */
function nextHour(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export default function ActionCreate({ settings }: { settings: CommunitySettings }) {
  const { t, lang } = useI18n();
  const { rules } = useSettings();
  const honeypot = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bring, setBring] = useState('');
  const [place, setPlace] = useState('');
  const [point, setPoint] = useState<LatLng | null>(null);
  const [startsAt, setStartsAt] = useState(nextHour);
  const [minutes, setMinutes] = useState(60);
  const [people, setPeople] = useState(3);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [safety, setSafety] = useState(false);
  const [notify, setNotify] = useState(false);
  const [canPush, setCanPush] = useState(false);
  const [ai, setAi] = useState<{ busy: boolean; done: boolean; no: string | null }>({ busy: false, done: false, no: null });
  const [problem, setProblem] = useState('');
  /** The AI's proposal is shown as a card; "Ndrysho" opens the fields (always open without the AI). */
  const [editing, setEditing] = useState(!rules.aiChecks);
  const [goOn, setGoOn] = useState(false);
  const placeSeq = useRef(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ code: string; status: string } | null>(null);

  useEffect(() => {
    prefetchFormToken();
    setCanPush(Boolean(rules.pushKey) && pushSupport() === 'yes');
    // A photo handed over from the report form ("Këtë mund ta rregulloni edhe ju!"): fill in with the AI at once.
    const handed = takeHandedPhoto();
    if (handed) {
      setPhoto(handed.blob);
      setPhotoKey(handed.key);
      setNotes(handed.notes);
      if (rules.aiChecks) void runDraft(handed.blob, handed.key, handed.notes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureKey(blob = photo, key = photoKey): Promise<string> {
    if (key) return key;
    if (!blob) throw new ActionFailure({ code: 'VALIDATION_ERROR', status: 400, message: t('community.form.needPhoto'), details: [{ field: 'photoKey', code: 'required', message: t('community.form.needPhoto') }] });
    const k = await uploadPhoto(blob);
    setPhotoKey(k);
    return k;
  }

  async function runDraft(blob = photo, key = photoKey, words = notes) {
    if (!blob) { setErrors({ photoKey: t('community.form.needPhoto') }); return; }
    setAi({ busy: true, done: false, no: null });
    try {
      const k = await ensureKey(blob, key);
      const d = await call(draftActionAction({ photoKey: k, notes: words }));
      if (!d.available) { setAi({ busy: false, done: false, no: null }); setEditing(true); return; }
      if (!d.citizensCanDo) { setAi({ busy: false, done: false, no: d.reason || '' }); return; }
      setProblem(d.problem);
      if (d.title) setTitle(d.title);
      if (d.description) setDescription(d.description);
      if (d.bring) setBring(d.bring);
      setPeople(d.peopleNeeded);
      setMinutes([30, 60, 90, 120, 180, 240].reduce((best, m) => (Math.abs(m - d.minutes) < Math.abs(best - d.minutes) ? m : best), 60));
      setAi({ busy: false, done: true, no: null });
    } catch {
      setAi({ busy: false, done: false, no: null });
      setEditing(true); // no answer: the resident writes it
    }
  }

  function onPhoto(p: Blob | null) {
    setPhoto(p);
    setPhotoKey(null);
    setAi({ busy: false, done: false, no: null });
    setGoOn(false);
    // As soon as the photo is chosen, the AI reads it and fills in the rest.
    if (p && rules.aiChecks) void runDraft(p, null, notes);
  }

  function onPoint(p: LatLng) {
    setPoint(p);
    const seq = ++placeSeq.current;
    call(placeAtAction({ latitude: p.latitude, longitude: p.longitude }))
      .then((r) => { if (seq === placeSeq.current && r.label) setPlace(r.label.slice(0, 200)); })
      .catch(() => { /* the point is enough */ });
  }

  function check(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!photo) e.photoKey = t('community.form.needPhoto');
    if (title.trim().length < 6) e.title = t('community.form.required');
    if (description.trim().length < 15) e.description = t('community.form.required');
    if (!point) e.latitude = t('community.form.needPlace');
    if (!startsAt) e.startsAt = t('community.form.required');
    if (phone.replace(/\D/g, '').length < 9) e.organizerPhone = t('community.form.required');
    if (!safety) e.safetyAccepted = t('community.form.needSafety');
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    const e = check();
    setErrors(e);
    if (Object.keys(e).length) {
      if (e.title || e.description) setEditing(true);
      document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    try {
      const key = await ensureKey();
      const push = notify && rules.pushKey ? await browserSubscription(rules.pushKey) : null;
      const res = await call(createActionAction({
        photoKey: key, title, description, bring, place: place.trim().length >= 3 ? place.trim() : 'Elbasan', latitude: point!.latitude, longitude: point!.longitude,
        startsAt: new Date(startsAt).toISOString(), minutes, peopleNeeded: people,
        organizerName: name, organizerPhone: phone, deviceRef: deviceRef(), safetyAccepted: true,
        ...(push ? { push } : {}), lang: lang === 'en' ? 'en' : 'sq',
        website: honeypot.current?.value ?? '', formToken: await formToken().catch(() => undefined),
      }));
      saveOrganizerToken(res.code, res.organizerToken);
      setCreated({ code: res.code, status: res.status });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setErrors(fieldErrorsOf(err));
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!settings.enabled) return <div className="container cm-page"><h1>{t('community.form.title')}</h1><p className="lead">{t('community.off')}</p></div>;

  if (created) {
    const published = created.status === 'PUBLISHED';
    return (
      <div className="container cm-page cm-narrow">
        <div className="cm-done-box">
          <span className="cm-done-icon" aria-hidden="true"><Icon name={published ? 'heart' : 'clock'} size={30} /></span>
          <h1>{t(published ? 'community.form.publishedTitle' : 'community.form.reviewTitle')}</h1>
          <p className="lead">{t(published ? 'community.form.publishedText' : 'community.form.reviewText')}</p>
          <p className="cm-code">{created.code}</p>
          <Link href={`/ndihmo/${created.code}`} className="btn btn-lg">{t('community.form.open')}<Icon name="arrowRight" size={18} /></Link>
          <p className="hint">{t('community.form.keepLink')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container cm-page cm-narrow">
      <Link href="/ndihmo" className="cm-back"><Icon name="arrowLeft" size={16} />{t('community.page.back')}</Link>
      <h1>{t('community.form.title')}</h1>
      <p className="lead">{t('community.form.lead')}</p>

      <form className="cm-form" onSubmit={submit} noValidate>
        {/* A trap for robots only: a name no browser or password manager fills in by itself. */}
      <input ref={honeypot} type="text" name="er_trap_leave_empty" className="hp-field" tabIndex={-1} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" aria-hidden="true" defaultValue="" />

        <fieldset className="cm-fieldset">
          <legend><span>1</span>{t('community.form.step1')}</legend>
          <PhotoInput value={photo} onChange={onPhoto} required error={errors.photoKey} maxBytes={rules.maxUploadBytes} idPrefix="action-photo" />
          {ai.busy && <p className="cm-reading"><span className="cm-dots" aria-hidden="true" />{t('community.form.reading')}</p>}
          {ai.no !== null && !goOn && (
            <div className="cm-ai-no">
              <p><strong>{t('community.form.aiNo')}</strong> {ai.no}</p>
              <div className="cm-invite-row">
                <Link href="/raporto" className="btn btn-sm">{t('community.form.reportInstead')}</Link>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => { setGoOn(true); setEditing(true); }}>{t('community.form.continueAnyway')}</button>
              </div>
            </div>
          )}
          {photo && !ai.busy && (ai.no === null || goOn) && (
            editing ? (
              <div className="cm-edit">
                <Field label={t('community.form.titleField')} htmlFor="cm-title" required error={errors.title}>
                  <input id="cm-title" value={title} maxLength={120} placeholder={t('community.form.titlePh')} onChange={(e) => setTitle(e.target.value)} />
                </Field>
                <Field label={t('community.form.description')} htmlFor="cm-desc" required error={errors.description}>
                  <textarea id="cm-desc" rows={3} value={description} maxLength={1000} placeholder={t('community.form.descriptionPh')} onChange={(e) => setDescription(e.target.value)} />
                </Field>
                <div className="cm-row3">
                  <Field label={t('community.form.people')} htmlFor="cm-people">
                    <select id="cm-people" value={people} onChange={(e) => setPeople(Number(e.target.value))}>
                      {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </Field>
                  <Field label={t('community.form.minutes')} htmlFor="cm-min">
                    <select id="cm-min" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                      {[30, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{durationText(m, t)}</option>)}
                    </select>
                  </Field>
                  <Field label={t('community.form.bring')} htmlFor="cm-bring">
                    <input id="cm-bring" value={bring} maxLength={200} placeholder={t('community.form.bringPh')} onChange={(e) => setBring(e.target.value)} />
                  </Field>
                </div>
                {ai.done && <button type="button" className="btn btn-sm btn-outline cm-edit-done" onClick={() => setEditing(false)}><Icon name="check" size={16} />{t('community.form.doneEdit')}</button>}
              </div>
            ) : ai.done && (
              <div className="cm-proposal">
                <div className="cm-proposal-top">
                  <span className="cm-ai-tag"><Icon name="sparkle" size={14} />AI</span>
                  {problem && <span className="cm-chip">{problem}</span>}
                  <button type="button" className="cm-link" onClick={() => setEditing(true)}><Icon name="edit" size={14} />{t('community.form.edit')}</button>
                </div>
                <strong>{title}</strong>
                <p>{description}</p>
                <div className="cm-proposal-meta">
                  <span><Icon name="users" size={15} />{t('community.form.peopleShort', { n: people })}</span>
                  <span><Icon name="clock" size={15} />{durationText(minutes, t)}</span>
                  {bring && <span><Icon name="list" size={15} />{bring}</span>}
                </div>
              </div>
            )
          )}
        </fieldset>

        {photo && !ai.busy && (ai.no === null || goOn) && (
          <>
            <fieldset className="cm-fieldset">
              <legend><span>2</span>{t('community.form.step2')}</legend>
              <LocationPicker value={point} onChange={onPoint} error={errors.latitude} autoLocate />
              <div className="cm-row2">
                <Field label={t('community.form.place')} htmlFor="cm-place">
                  <input id="cm-place" value={place} maxLength={200} placeholder={t('community.form.placePh')} onChange={(e) => setPlace(e.target.value)} />
                </Field>
                <Field label={t('community.form.startsAt')} htmlFor="cm-start" required error={errors.startsAt}>
                  <input id="cm-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </Field>
              </div>
            </fieldset>

            <fieldset className="cm-fieldset">
              <legend><span>3</span>{t('community.form.step3')}</legend>
              <div className="cm-row2">
                <Field label={t('community.form.phone')} htmlFor="cm-phone" required error={errors.organizerPhone} hint={t('community.form.phoneHint')}>
                  <input id="cm-phone" type="tel" inputMode="tel" value={phone} maxLength={30} autoComplete="tel" placeholder="06x xxx xxxx" onChange={(e) => setPhone(e.target.value)} />
                </Field>
                <Field label={t('community.form.name')} htmlFor="cm-name">
                  <input id="cm-name" value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
                </Field>
              </div>
              <div className={`field${errors.safetyAccepted ? ' has-error' : ''}`}>
                <label className="check cm-check">
                  <input type="checkbox" checked={safety} onChange={(e) => setSafety(e.target.checked)} />
                  <span>{t('community.form.safetyShort')}</span>
                </label>
                {errors.safetyAccepted && <div className="field-error" role="alert"><Icon name="alert" size={14} />{errors.safetyAccepted}</div>}
              </div>
              {canPush && (
                <label className="switch">
                  <input type="checkbox" role="switch" checked={notify} aria-checked={notify} onChange={async (e) => setNotify(e.target.checked ? await askPushPermission() : false)} />
                  <span className="switch-track" aria-hidden="true" />
                  <span>{t('community.form.notify')}</span>
                </label>
              )}
            </fieldset>
          </>
        )}

        {error ? <ErrorAlert error={error} /> : null}
        {photo && !ai.busy && (ai.no === null || goOn) && <button type="submit" className="btn btn-lg cm-submit" disabled={busy}>
          <Icon name="heart" size={20} />{busy ? t('community.form.sending') : t('community.form.submit')}
        </button>}
      </form>
    </div>
  );
}
