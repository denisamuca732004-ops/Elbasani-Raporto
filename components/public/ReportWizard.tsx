'use client';
/**
 * Reporting flow like the BOS:311 app, one step per screen:
 * type → location → photo → description → contact → review → case number.
 * The location is given ONE of two ways: GPS / a tap on the map (the zone is
 * found from the point, no address needed), or by hand: zone → one of THAT
 * zone's lagje or villages → street. So the zone and the place always match.
 * EVERY step is mandatory: the next step opens only when the current one is
 * complete, and the server (createReportAction) refuses incomplete reports
 * anyway, telling the wizard which step to go back to.
 * The photo goes straight to Vercel Blob with a one-file upload token.
 * Used on /raporto and inside the /embed widget.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createReportAction, findNearbyAction, followReportAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { LocationPicker } from '@/components/maps';
import PhotoInput from '@/components/PhotoInput';
import { useCatalog, useSettings } from '@/components/providers';
import { CategoryIcon, ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { distanceLabel, EMAIL_RE, insideArea, key, phoneDigits, typeName, type LatLng } from '@/lib/client/format';
import { isMine, rememberMine, rememberSupported } from '@/lib/client/myReports';
import { newClientRef, queueReport } from '@/lib/client/offlineQueue';
import { uploadPhoto } from '@/lib/client/upload';
import { LIMITS } from '@/lib/shared/domain';
import type { PublicCard } from '@/lib/shared/types';
import { otherZonePlace, zoneCodeAt } from '@/lib/shared/zones';

const STEPS = ['type', 'location', 'photo', 'details', 'contact', 'review'] as const;
type StepName = (typeof STEPS)[number];
/** Field (as named by the server) → wizard step. */
const STEP_OF_FIELD: Record<string, StepName> = {
  requestTypeId: 'type', locationMode: 'location', latitude: 'location', longitude: 'location', address: 'location', neighbourhoodId: 'location', localityId: 'location',
  photo: 'photo', photoKey: 'photo', description: 'details', anonymous: 'contact', contactName: 'contact', contactEmail: 'contact', contactPhone: 'contact',
};
type Errors = Partial<Record<string, string>>;

export default function ReportWizard({ embedded = false, initialCategory, initialType }: { embedded?: boolean; initialCategory?: string; initialType?: number }) {
  const { t, lang } = useI18n();
  const { catalog, typeById, categoryByCode } = useCatalog();
  const { rules } = useSettings();
  const trackBase = embedded ? '/embed/ndiq' : '/ndiq';
  const initialTypeValid = initialType && typeById(initialType) ? initialType : null;
  const [step, setStep] = useState(initialTypeValid ? 1 : 0);
  const [categoryCode, setCategoryCode] = useState<string | null>(initialCategory ?? null);
  const [typeId, setTypeId] = useState<number | null>(initialTypeValid);
  const [locationMode, setLocationMode] = useState<'map' | 'address' | null>(null);
  const [location, setLocation] = useState<LatLng | null>(null);
  const [reference, setReference] = useState(''); // map mode: optional landmark
  const [neighbourhoodId, setNeighbourhoodId] = useState(''); // address mode
  const [localityId, setLocalityId] = useState('');
  const [street, setStreet] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [description, setDescription] = useState('');
  const [contactMode, setContactMode] = useState<'contact' | 'anonymous' | null>(null); // null until the resident chooses
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [duplicates, setDuplicates] = useState<PublicCard[]>([]);
  const [followed, setFollowed] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<{ caseNumber?: string; queued?: boolean } | null>(null);
  const [clientRef] = useState(newClientRef);
  const uploaded = useRef<{ photo: Blob; key: string } | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // A change made by the resident clears the server's message for that step.
  useEffect(() => {
    setServerErrors({});
  }, [typeId, locationMode, reference, neighbourhoodId, localityId, street, description, contact, contactMode]);

  const type = typeId ? typeById(typeId) ?? null : null;
  // Map mode: the zone of the pin, from the zone borders (works offline too).
  const pin = locationMode === 'map' ? location : null;
  const pinZoneCode = pin && insideArea(pin, rules.serviceArea) ? zoneCodeAt(pin.latitude, pin.longitude) : null;
  const pinZone = pinZoneCode ? catalog.neighbourhoods.find((n) => n.code === pinZoneCode) : undefined;
  // Address mode: the chosen zone and its own lagje / villages.
  const zone = catalog.neighbourhoods.find((n) => n.id === Number(neighbourhoodId));
  const locality = zone?.localities.find((l) => l.id === Number(localityId));
  const category = type?.category ?? (categoryCode ? categoryByCode(categoryCode) ?? null : null);
  const stepName = STEPS[step]!;

  // Duplicate check: open reports of the same kind close by.
  useEffect(() => {
    if (!type || !pin || !pinZoneCode) {
      setDuplicates([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      call(findNearbyAction({ requestTypeId: type.id, latitude: pin.latitude, longitude: pin.longitude }))
        .then((items) => { if (!cancelled) setDuplicates(items.filter((d) => !isMine(d.caseNumber))); })
        .catch(() => { if (!cancelled) setDuplicates([]); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [type, pin, pinZoneCode]);

  /** What is still missing in a step (field → message). Empty object = the step is complete. */
  const errorsFor = useCallback((name: StepName): Errors => {
    const e: Errors = {};
    if (name === 'type' && !type) e.requestTypeId = t('report.errors.type');
    if (name === 'location') {
      if (!locationMode) e.locationMode = t('report.errors.locationMode');
      if (locationMode === 'map') {
        if (!location) e.latitude = t('report.errors.pin');
        else if (!pinZoneCode) e.latitude = t('report.outsideArea');
      }
      if (locationMode === 'address') {
        if (!zone) e.neighbourhoodId = t('report.errors.area');
        else if (zone.localities.length > 0 && !locality) e.localityId = t('report.errors.locality');
        const text = street.trim();
        if (!text) e.address = t('report.errors.street');
        else if (text.length < LIMITS.minAddress) e.address = t('report.errors.addressShort', { n: LIMITS.minAddress });
        else if (zone) {
          const other = otherZonePlace(text, zone.id, catalog.neighbourhoods);
          if (other) e.address = t('report.errors.otherZone', { place: other.place, zone: other.zone });
        }
      }
    }
    if (name === 'photo' && !photo) e.photo = t('report.errors.photo');
    if (name === 'details') {
      if (!description.trim()) e.description = t('report.errors.description');
      else if (description.trim().length < LIMITS.minDescription) e.description = t('report.errors.descriptionShort', { n: LIMITS.minDescription });
    }
    if (name === 'contact') {
      if (!contactMode) e.anonymous = t('report.errors.contactChoice');
      if (contactMode === 'contact') {
        const email = contact.email.trim();
        const phone = contact.phone.trim();
        if (contact.name.trim().length < 2) e.contactName = t('report.errors.name');
        if (!email && !phone) e.contactEmail = t('report.errors.contactWay');
        if (email && !EMAIL_RE.test(email)) e.contactEmail = t('report.errors.email');
        if (phone && phoneDigits(phone) < 6) e.contactPhone = t('report.errors.phone');
      }
    }
    return e;
  }, [type, locationMode, location, pinZoneCode, zone, locality, street, catalog.neighbourhoods, photo, description, contactMode, contact, t]);

  const currentErrors = useMemo(() => errorsFor(stepName), [errorsFor, stepName]);
  const firstIncompleteStep = useMemo(() => STEPS.findIndex((s) => s !== 'review' && Object.keys(errorsFor(s)).length > 0), [errorsFor]);
  const visibleError = (field: string) => (showErrors ? currentErrors[field] : null) || serverErrors[field] || null;

  function goTo(index: number) {
    setStep(index);
    setShowErrors(false);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function next() {
    if (Object.keys(currentErrors).length) {
      setShowErrors(true);
      requestAnimationFrame(() => topRef.current?.querySelector<HTMLElement>('.has-error input, .has-error select, .has-error textarea, .has-error button')?.focus());
      return;
    }
    goTo(step + 1);
  }

  const onLocation = useCallback((p: LatLng) => {
    setLocation(p);
    setServerErrors((e) => ({ ...e, latitude: undefined }));
  }, []);

  async function follow(caseNumber: string) {
    try {
      const email = contactMode === 'contact' && EMAIL_RE.test(contact.email.trim()) ? contact.email.trim() : undefined;
      await call(followReportAction({ caseNumber, ...(email ? { email } : {}) }));
      rememberSupported(caseNumber);
      setFollowed(caseNumber);
    } catch (err) {
      setError(err as ActionFailure);
    }
  }

  async function photoKeyFor(current: Blob): Promise<string> {
    if (uploaded.current?.photo === current) return uploaded.current.key;
    const keyValue = await uploadPhoto(current);
    uploaded.current = { photo: current, key: keyValue };
    return keyValue;
  }

  async function submit() {
    if (firstIncompleteStep >= 0) {
      setStep(firstIncompleteStep);
      setShowErrors(true);
      return;
    }
    if (!type || !photo || !locationMode || (locationMode === 'map' && !location)) return;
    setSubmitting(true);
    setError(null);
    setServerErrors({});
    const anonymous = contactMode === 'anonymous';
    const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
    const data = {
      requestTypeId: type.id,
      locationMode,
      ...(locationMode === 'map' && location
        ? { latitude: location.latitude, longitude: location.longitude, address: reference.trim() }
        : { neighbourhoodId: Number(neighbourhoodId), ...(locality ? { localityId: locality.id } : {}), address: street.trim() }),
      description: description.trim(),
      anonymous,
      ...(anonymous ? {} : {
        contactName: contact.name.trim(),
        ...(contact.email.trim() ? { contactEmail: contact.email.trim() } : {}),
        ...(contact.phone.trim() ? { contactPhone: contact.phone.trim() } : {}),
      }),
      channel: embedded ? 'EMBED' : standalone ? 'APP' : 'WEB',
      clientRef,
    };
    try {
      if (!navigator.onLine) throw new ActionFailure({ code: 'NETWORK', status: 0, message: 'network' });
      const photoKey = await photoKeyFor(photo);
      const res = await call(createReportAction({ ...data, photoKey }));
      rememberMine(res.caseNumber);
      setResult({ caseNumber: res.caseNumber });
    } catch (raw) {
      const err = raw as ActionFailure;
      if (err.code === 'NETWORK') {
        try {
          await queueReport(data, photo);
          window.dispatchEvent(new Event('er-queue-changed'));
          setResult({ queued: true });
        } catch {
          setError(err);
        }
      } else if ((err.code === 'REPORT_INCOMPLETE' || err.code === 'PHOTO_INVALID') && Array.isArray(err.details)) {
        // The server found something missing: go back to the first step concerned and show it there.
        const byField: Errors = {};
        let target = STEPS.length - 1;
        for (const d of err.details as Array<{ field: string; message: string; step?: string }>) {
          const field = d.field === 'longitude' ? 'latitude' : d.field === 'photoKey' ? 'photo' : d.field;
          byField[field] = d.message;
          const index = STEPS.indexOf((d.step ?? STEP_OF_FIELD[d.field] ?? 'review') as StepName);
          if (index >= 0) target = Math.min(target, index);
        }
        if (byField.photo) uploaded.current = null;
        setServerErrors(byField);
        setStep(target);
        setError(target === STEPS.length - 1 ? err : null);
      } else {
        setError(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (catalog.categories.length === 0) return <div className="alert alert-error" role="alert">{t('errors.generic')}</div>;

  if (followed) {
    return (
      <div className="done-box">
        <Icon name="check" size={48} />
        <h2>{t('report.followedTitle')}</h2>
        <p>{t('report.followedText')}</p>
        <span className="case-number">{followed}</span>
        <Link className="btn" href={`${trackBase}/${followed}`}>{t('report.trackIt')}</Link>
      </div>
    );
  }

  if (result) {
    const email = contactMode === 'contact' ? contact.email.trim() : '';
    return (
      <div className="done-box" role="status">
        <Icon name="check" size={48} />
        {result.queued ? (
          <>
            <h2>{t('report.queuedTitle')}</h2>
            <p>{t('report.queuedText')}</p>
          </>
        ) : (
          <>
            <h2>{t('report.doneTitle')}</h2>
            <p>{t('report.doneText')}</p>
            <span className="case-number">{result.caseNumber}</span>
            <p className="small muted">{email ? t('report.doneEmail', { email }) : t('report.doneNoEmail')}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link className="btn" href={`${trackBase}/${result.caseNumber}`}>{t('report.trackIt')}</Link>
              <button type="button" className="btn btn-outline" onClick={() => window.location.assign(embedded ? '/embed' : '/raporto')}>{t('report.another')}</button>
            </div>
          </>
        )}
      </div>
    );
  }

  const placeSummary = locationMode === 'map'
    ? [t('report.pinOnMap'), pinZone?.name, reference.trim()].filter(Boolean).join(' · ')
    : locationMode === 'address' ? [[street.trim(), locality?.name].filter(Boolean).join(', '), zone?.name].filter(Boolean).join(' · ') : '';
  return (
    <div className="wizard" ref={topRef}>
      <ol className="stepper" aria-label={t('report.progress')}>
        {STEPS.map((s, i) => {
          const done = i < step;
          return (
            <li key={s} className={i === step ? 'current' : done ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <button type="button" disabled={!done} onClick={() => goTo(i)} aria-label={`${i + 1}. ${t(`report.steps.${s}`)}`}>
                <span className="num">{done ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}</span>
                <span className="name">{t(`report.steps.${s}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="step-label">{t('report.stepOf', { n: step + 1, total: STEPS.length })} · {t(`report.steps.${stepName}`)}</div>

      {stepName === 'type' && (
        <section>
          <h2>{t('report.chooseType')}</h2>
          <div className="category-grid" style={{ marginBottom: 20 }}>
            {catalog.categories.map((c) => (
              <button key={c.code} type="button" className={`category-tile${category?.code === c.code ? ' selected' : ''}`} aria-pressed={category?.code === c.code} onClick={() => { setCategoryCode(c.code); setTypeId(null); }}>
                <CategoryIcon icon={c.icon} size={30} />{lang === 'en' ? c.nameEn : c.nameSq}
              </button>
            ))}
          </div>
          {category && (
            <>
              <h3>{lang === 'en' ? category.nameEn : category.nameSq}</h3>
              <ul className="type-list">
                {category.types.map((ty) => (
                  <li key={ty.id}>
                    <button type="button" className={ty.id === typeId ? 'selected' : ''} aria-pressed={ty.id === typeId} onClick={() => { setTypeId(ty.id); goTo(1); }}>
                      <span>{lang === 'en' ? ty.nameEn : ty.nameSq}</span>
                      <span className="badge status-received">{t(`kind.${key(ty.kind)}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {(showErrors ? currentErrors.requestTypeId : serverErrors.requestTypeId) && (
            <div className="field-error" role="alert"><Icon name="alert" size={14} />{showErrors ? currentErrors.requestTypeId : serverErrors.requestTypeId}</div>
          )}
        </section>
      )}

      {stepName === 'location' && (
        <section>
          <h2>{t('report.whereTitle')}</h2>
          <p className="muted">{t('report.whereIntro')}</p>
          <fieldset className={`choice-cards${visibleError('locationMode') ? ' has-error' : ''}`}>
            <legend className="label">{t('report.whereChoose')}</legend>
            <label className={`choice-card${locationMode === 'map' ? ' selected' : ''}`}>
              <input type="radio" name="location-mode" value="map" checked={locationMode === 'map'} onChange={() => setLocationMode('map')} />
              <span><strong><Icon name="gps" size={16} /> {t('report.modeMap')}</strong><span className="muted small">{t('report.modeMapText')}</span></span>
            </label>
            <label className={`choice-card${locationMode === 'address' ? ' selected' : ''}`}>
              <input type="radio" name="location-mode" value="address" checked={locationMode === 'address'} onChange={() => setLocationMode('address')} />
              <span><strong><Icon name="edit" size={16} /> {t('report.modeAddress')}</strong><span className="muted small">{t('report.modeAddressText')}</span></span>
            </label>
            {visibleError('locationMode') && <div className="field-error" role="alert"><Icon name="alert" size={14} />{visibleError('locationMode')}</div>}
          </fieldset>

          {locationMode === 'map' && (
            <div className="location-mode">
              <LocationPicker value={location} onChange={onLocation} error={visibleError('latitude')} autoLocate outside={Boolean(location && !pinZoneCode)} />
              {pinZone && (
                <p className="zone-found" role="status"><Icon name="check" size={16} strokeWidth={2.6} /><strong>{t('report.zoneFound', { zone: pinZone.name })}</strong> <span className="muted small">{t('report.zoneFoundHint')}</span></p>
              )}
              <Field label={t('report.reference')} hint={t('report.referenceHint')} htmlFor="reference">
                <input id="reference" type="text" value={reference} maxLength={LIMITS.maxAddress} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
          )}

          {locationMode === 'address' && (
            <div className="location-mode">
              <div className="grid-2">
                <Field label={t('report.area')} htmlFor="area" error={visibleError('neighbourhoodId')} required>
                  <select id="area" value={neighbourhoodId} aria-required="true" onChange={(e) => { setNeighbourhoodId(e.target.value); setLocalityId(''); }}>
                    <option value="">{t('report.areaChoose')}</option>
                    {catalog.neighbourhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </select>
                </Field>
                {(!zone || zone.localities.length > 0) && (
                  <Field label={t('report.locality')} hint={zone ? undefined : t('report.localityFirst')} htmlFor="locality" error={visibleError('localityId')} required>
                    <select id="locality" value={localityId} aria-required="true" disabled={!zone} onChange={(e) => setLocalityId(e.target.value)}>
                      <option value="">{t('report.localityChoose')}</option>
                      {zone?.localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <Field label={t('report.street')} hint={t('report.streetHint')} htmlFor="street" error={visibleError('address')} required>
                <input id="street" type="text" value={street} maxLength={LIMITS.maxAddress - 40} aria-required="true" onChange={(e) => setStreet(e.target.value)} />
              </Field>
            </div>
          )}
          {duplicates.length > 0 && (
            <div className="duplicate-box">
              <h3 style={{ marginBottom: 6 }}>{t('report.duplicatesTitle')}</h3>
              <p className="small">{t('report.duplicatesText')}</p>
              {duplicates.map((d) => (
                <div key={d.caseNumber} className="row-between" style={{ padding: '8px 0', borderTop: '1px solid #E8D9A8' }}>
                  <span><span className="case-number">{d.caseNumber}</span> · {typeName(d.type, lang)} · {distanceLabel(d.distanceMeters)}</span>
                  <button type="button" className="btn btn-sm" onClick={() => follow(d.caseNumber)}>{t('report.sameProblem')}</button>
                </div>
              ))}
            </div>
          )}
          {error && <ErrorAlert error={error} />}
        </section>
      )}

      {stepName === 'photo' && (
        <section>
          <h2>{t('report.photoTitle')}</h2>
          <PhotoInput
            value={photo}
            onChange={(p) => { setPhoto(p); setServerErrors((e) => ({ ...e, photo: undefined })); }}
            required error={visibleError('photo')} maxBytes={rules.maxUploadBytes}
          />
        </section>
      )}

      {stepName === 'details' && (
        <section>
          <h2>{t('report.detailsTitle')}</h2>
          <Field label={t('report.description')} hint={t('report.descriptionHint')} htmlFor="desc" error={visibleError('description')} required>
            <textarea id="desc" value={description} maxLength={LIMITS.maxDescription} aria-required="true" aria-describedby="desc-count" onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <p id="desc-count" className={`hint${description.trim().length < LIMITS.minDescription ? '' : ' ok'}`}>
            {t('report.descriptionCount', { n: description.trim().length, min: LIMITS.minDescription })}
          </p>
        </section>
      )}

      {stepName === 'contact' && (
        <section>
          <h2>{t('report.contactTitle')}</h2>
          <fieldset className={`choice-cards${visibleError('anonymous') ? ' has-error' : ''}`}>
            <legend className="label">{t('report.contactChoose')}</legend>
            <label className={`choice-card${contactMode === 'contact' ? ' selected' : ''}`}>
              <input type="radio" name="contact-mode" value="contact" checked={contactMode === 'contact'} onChange={() => setContactMode('contact')} />
              <span><strong>{t('report.withContact')}</strong><span className="muted small">{t('report.withContactText')}</span></span>
            </label>
            <label className={`choice-card${contactMode === 'anonymous' ? ' selected' : ''}`}>
              <input type="radio" name="contact-mode" value="anonymous" checked={contactMode === 'anonymous'} onChange={() => setContactMode('anonymous')} />
              <span><strong>{t('report.anonymous')}</strong><span className="muted small">{t('report.anonymousText')}</span></span>
            </label>
            {visibleError('anonymous') && <div className="field-error" role="alert"><Icon name="alert" size={14} />{visibleError('anonymous')}</div>}
          </fieldset>
          {contactMode === 'contact' && (
            <>
              <p className="hint">{t('report.contactRule')}</p>
              <div className="grid-2">
                <Field label={t('report.name')} htmlFor="name" error={visibleError('contactName')} required>
                  <input id="name" type="text" autoComplete="name" value={contact.name} maxLength={160} aria-required="true" onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                </Field>
                <Field label={t('report.email')} hint={t('report.emailHint')} htmlFor="email" error={visibleError('contactEmail')}>
                  <input id="email" type="email" autoComplete="email" value={contact.email} maxLength={200} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                </Field>
                <Field label={t('report.phone')} htmlFor="phone" error={visibleError('contactPhone')}>
                  <input id="phone" type="tel" autoComplete="tel" value={contact.phone} maxLength={40} onChange={(e) => setContact({ ...contact, phone: e.target.value.replace(/[^0-9 +()-]/g, '') })} />
                </Field>
              </div>
            </>
          )}
        </section>
      )}

      {stepName === 'review' && (
        <section>
          <h2>{t('report.reviewTitle')}</h2>
          <dl className="review-list card">
            {([
              ['type', typeName(type, lang)],
              ['location', placeSummary],
              ['photo', photo ? t('report.photoAdded') : '–'],
              ['details', description.trim()],
              ['contact', contactMode === 'anonymous'
                ? t('report.anonymousShort')
                : [contact.name.trim(), contact.email.trim(), contact.phone.trim()].filter(Boolean).join(' · ')],
            ] as Array<[StepName, string]>).map(([s, value]) => (
              <div className="review-row" key={s}>
                <dt>{t(`report.steps.${s}`)}</dt>
                <dd>{value || '–'}</dd>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => goTo(STEPS.indexOf(s))}><Icon name="edit" size={14} />{t('common.change')}</button>
              </div>
            ))}
          </dl>
          <p className="small muted" style={{ marginTop: 12 }}>{t('report.consent')} <Link href="/privatesia" target="_blank">{t('nav.privacy')}</Link>.</p>
          <ErrorAlert error={error} />
        </section>
      )}

      <div className="wizard-nav">
        <button type="button" className="btn btn-outline" onClick={() => goTo(step - 1)} disabled={step === 0 || submitting}>
          <Icon name="arrowLeft" size={18} />{t('common.back')}
        </button>
        {stepName === 'review' ? (
          <button type="button" className="btn btn-lg" onClick={submit} disabled={submitting}>{submitting ? t('report.sending') : t('report.send')}</button>
        ) : (
          (stepName !== 'type' || type) && (
            <button type="button" className="btn" onClick={next}>
              {t('common.next')}<Icon name="arrowRight" size={18} />
            </button>
          )
        )}
      </div>
      {showErrors && Object.keys(currentErrors).length > 0 && (
        <p className="field-error" role="status" style={{ justifyContent: 'flex-end' }}>{t('report.completeStep')}</p>
      )}
    </div>
  );
}
