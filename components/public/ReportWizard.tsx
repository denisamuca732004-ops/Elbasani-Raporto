'use client';
/**
 * Reporting flow like the BOS:311 app, one step per screen:
 * type → location → photo → description → contact (anonymous, or name + phone) → review → case number.
 * The location, as on BOS:311: one "Vendndodhja" field to search a street, a
 * lagje or a village, and a map whose pin can be tapped, dragged or set by
 * GPS; moving the pin fills the field with the street there. The zone always
 * comes from the point. A lagje / village chosen in the search and not moved
 * is saved as that place (an approximate point), never as an exact one.
 * EVERY step is mandatory: the next step opens only when the current one is
 * complete, and the server (createReportAction) refuses incomplete reports
 * anyway, telling the wizard which step to go back to.
 * The photo goes straight to Vercel Blob with a one-file upload token.
 * With the AI on, the photo is checked as soon as it is chosen: an
 * inappropriate photo, a document or a screenshot is refused (the server
 * refuses it again when the report is sent), and one that does not seem to
 * show the chosen problem needs the resident's confirmation
 * (lib/server/services/photoCheck.ts). The description is checked the same
 * way when "Vazhdo" is pressed: random letters (also without the AI) and
 * abusive text are refused, a text about another problem needs a confirmation
 * (lib/server/services/descriptionCheck.ts).
 * "Raporto me foto" (mode "photo", with the AI on): the photo comes first, the
 * AI proposes the type and a description (lib/server/services/photoAnalyze.ts),
 * and the resident checks both on one screen: photo → problem → location →
 * contact → review. Without the AI the normal steps are used.
 * Used on /raporto and inside the /embed widget.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  analyzePhotoAction, checkDescriptionAction, checkPhotoAction, createReportAction, findNearbyAction, followReportAction, placeAtAction, searchPlacesAction,
} from '@/actions/reports';
import Icon from '@/components/Icon';
import { LocationPicker, MiniMap } from '@/components/maps';
import PhotoInput from '@/components/PhotoInput';
import { useCatalog, useSettings } from '@/components/providers';
import { CategoryIcon, ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { distanceLabel, insideArea, key, phoneDigits, typeName, type LatLng } from '@/lib/client/format';
import { isMine, rememberMine, rememberSupported } from '@/lib/client/myReports';
import { newClientRef, queueReport } from '@/lib/client/offlineQueue';
import { uploadPhoto } from '@/lib/client/upload';
import { LIMITS, isOtherChoice } from '@/lib/shared/domain';
import { looksLikeGibberish } from '@/lib/shared/text';
import { plainWords, searchLocalities, type PlaceSuggestion } from '@/lib/shared/places';
import type { PublicCard } from '@/lib/shared/types';
import { zoneCodeAt } from '@/lib/shared/zones';

const FORM_STEPS = ['type', 'location', 'photo', 'details', 'contact', 'review'] as const;
/** "Raporto me foto": the type and the description are checked together, on "check". */
const PHOTO_STEPS = ['photo', 'check', 'location', 'contact', 'review'] as const;
export type ReportMode = 'form' | 'photo';
/** What the AI proposed from the photo ("unchecked": no answer, the resident fills in everything). */
type Analysis = {
  photo: Blob; status: 'analysing' | 'done';
  verdict?: 'ok' | 'unrelated' | 'not_photo' | 'inappropriate' | 'unchecked'; requestTypeId?: number | null; description?: string;
};
/** The check of the description for the chosen type, made when "Vazhdo" is pressed. */
type DescriptionCheck = { text: string; typeId: number; status: 'ok' | 'unrelated' | 'unchecked'; confirmed: boolean };
/** The check of the chosen photo for the chosen type ("unchecked": AI off, offline or no answer). */
type PhotoCheck = { photo: Blob; typeId: number; status: 'checking' | 'ok' | 'unrelated' | 'unchecked'; confirmed: boolean };
type StepName = (typeof FORM_STEPS)[number] | (typeof PHOTO_STEPS)[number];
/** Field (as named by the server) → wizard step. */
const STEP_OF_FIELD: Record<string, StepName> = {
  requestTypeId: 'type', locationMode: 'location', latitude: 'location', longitude: 'location', address: 'location', neighbourhoodId: 'location', localityId: 'location',
  photo: 'photo', photoKey: 'photo', description: 'details', anonymous: 'contact', contactName: 'contact', contactPhone: 'contact',
};
type Errors = Partial<Record<string, string>>;

export default function ReportWizard({ embedded = false, initialCategory, initialType, initialMode = 'form' }: {
  embedded?: boolean; initialCategory?: string; initialType?: number; initialMode?: ReportMode;
}) {
  const { t, lang } = useI18n();
  const { catalog, typeById, categoryByCode } = useCatalog();
  const { rules } = useSettings();
  const trackBase = embedded ? '/embed/ndiq' : '/ndiq';
  const initialTypeValid = initialType && typeById(initialType) ? initialType : null;
  const [mode, setMode] = useState<ReportMode>(initialTypeValid || initialCategory ? 'form' : initialMode);
  // Only with the AI on: without it there is nothing to propose.
  const photoMode = mode === 'photo' && rules.aiChecks;
  const STEPS: readonly StepName[] = photoMode ? PHOTO_STEPS : FORM_STEPS;
  /** The index of a step; in photo mode "type" and "description" are both on "check". */
  const stepIndex = (name: StepName): number => {
    const i = STEPS.indexOf(name);
    return i >= 0 || !photoMode ? i : name === 'type' || name === 'details' ? STEPS.indexOf('check') : -1;
  };
  const [step, setStep] = useState(initialTypeValid ? 1 : 0);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  // What the AI last filled in: replaced by a new proposal only while the resident has not changed it.
  const aiFilled = useRef<{ typeId: number | null; description: string }>({ typeId: null, description: '' });
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [categoryCode, setCategoryCode] = useState<string | null>(initialCategory ?? null);
  const [typeId, setTypeId] = useState<number | null>(initialTypeValid);
  // "Vendndodhja" (as on BOS:311): one field to search a street, lagje or village, and the pin on the map.
  const [location, setLocation] = useState<LatLng | null>(null);
  const [placeText, setPlaceText] = useState(''); // the field: the chosen place, the street at the pin, or what was typed
  const [placeQuery, setPlaceQuery] = useState(''); // what was typed and is being searched; empty after a choice
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [resolvingPlace, setResolvingPlace] = useState(false);
  // A lagje / village chosen in the search and not moved since: saved as "that place" (approximate point).
  const [pickedLocality, setPickedLocality] = useState<{ zoneId: number; localityId: number; label: string } | null>(null);
  const [mapFocus, setMapFocus] = useState<{ point: LatLng; zoom: number } | null>(null);
  const placeSeq = useRef(0);
  // The chosen photo, shown small on the last step.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoCheck, setPhotoCheck] = useState<PhotoCheck | null>(null);
  // The last photo was refused (inappropriate, or a document / screenshot): the message stays until another photo is chosen.
  const [photoRefused, setPhotoRefused] = useState<'inappropriate' | 'not_photo' | null>(null);
  const [descriptionCheck, setDescriptionCheck] = useState<DescriptionCheck | null>(null);
  const [checkingDescription, setCheckingDescription] = useState(false);
  const [description, setDescription] = useState('');
  // "Përfshi kontaktin" (as on BOS:311): off = anonymous, on = name and phone (both required).
  const [contactMode, setContactMode] = useState<'contact' | 'anonymous'>('anonymous');
  // No e-mail and no account: a name and a phone number, so the Municipality can call if it needs more details.
  const [contact, setContact] = useState({ name: '', phone: '' });
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [duplicates, setDuplicates] = useState<PublicCard[]>([]);
  const [followed, setFollowed] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<{ caseNumber?: string; queued?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [clientRef] = useState(newClientRef);
  const uploaded = useRef<{ photo: Blob; key: string } | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // A change made by the resident clears the server's message for that step.
  useEffect(() => {
    setServerErrors({});
  }, [typeId, location, placeText, description, contact, contactMode]);

  const type = typeId ? typeById(typeId) ?? null : null;

  // The photo is checked as soon as it is chosen (and again if the type changes), only with the AI on and online.
  useEffect(() => {
    // In photo mode the analysis has already looked at the photo (and the server checks it again when it is sent).
    if (!photo || !typeId || !rules.aiChecks || photoMode || !navigator.onLine) {
      setPhotoCheck(null);
      return undefined;
    }
    let cancelled = false;
    setPhotoCheck({ photo, typeId, status: 'checking', confirmed: false });
    void (async () => {
      let verdict: 'ok' | 'unrelated' | 'not_photo' | 'inappropriate' | 'unchecked' = 'unchecked';
      try {
        const photoKey = await photoKeyFor(photo);
        verdict = (await call(checkPhotoAction({ photoKey, requestTypeId: typeId }))).verdict;
      } catch {
        uploaded.current = null; // no answer: the report goes on, and the photo is uploaded again when it is sent
      }
      if (cancelled) return;
      if (verdict === 'inappropriate' || verdict === 'not_photo') {
        uploaded.current = null;
        setPhotoRefused(verdict);
        setPhoto(null);
        return;
      }
      setPhotoCheck({ photo, typeId, status: verdict, confirmed: false });
    })();
    return () => { cancelled = true; };
    // photoKeyFor only reads a ref; re-running it on every render would upload again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, typeId, rules.aiChecks, photoMode]);
  const currentCheck = photo && photoCheck?.photo === photo && photoCheck.typeId === typeId ? photoCheck : null;

  // "Raporto me foto": the photo is read as soon as it is chosen; the proposal fills the type and the description.
  useEffect(() => {
    if (!photoMode || !photo || analysis?.photo === photo) return undefined;
    if (!navigator.onLine) {
      setAnalysis({ photo, status: 'done', verdict: 'unchecked' });
      return undefined;
    }
    let cancelled = false;
    setAnalysis({ photo, status: 'analysing' });
    void (async () => {
      let found: Omit<Analysis, 'photo' | 'status'> = { verdict: 'unchecked' };
      try {
        const photoKey = await photoKeyFor(photo);
        found = await call(analyzePhotoAction({ photoKey }));
      } catch {
        uploaded.current = null; // no answer: the resident fills in the type and the description
      }
      if (cancelled) return;
      if (found.verdict === 'inappropriate' || found.verdict === 'not_photo') {
        uploaded.current = null;
        setAnalysis(null);
        setPhotoRefused(found.verdict);
        setPhoto(null);
        return;
      }
      const proposedType = found.requestTypeId && typeById(found.requestTypeId) ? found.requestTypeId : null;
      setAnalysis({ photo, status: 'done', ...found, requestTypeId: proposedType });
      if (typeId === null || typeId === aiFilled.current.typeId) {
        setTypeId(proposedType);
        setCategoryCode(proposedType ? typeById(proposedType)?.category.code ?? null : null);
        setShowTypePicker(!proposedType);
      }
      if (!description.trim() || description === aiFilled.current.description) setDescription(found.description ?? '');
      aiFilled.current = { typeId: proposedType, description: found.description ?? '' };
      // The photo is read: straight on to the proposal.
      setStep((s) => (s === 0 ? 1 : s));
    })();
    return () => { cancelled = true; };
    // Runs once per photo; the type and the text are read as they are when the answer comes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo, photoMode]);
  const analysing = photoMode && Boolean(photo) && analysis?.photo === photo && analysis.status === 'analysing';
  const currentAnalysis = photo && analysis?.photo === photo && analysis.status === 'done' ? analysis : null;
  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  // The zone of the pin, from the zone borders (works offline too).
  const pin = location;
  const pinZoneCode = pin && insideArea(pin, rules.serviceArea) ? zoneCodeAt(pin.latitude, pin.longitude) : null;
  const pinZone = pinZoneCode ? catalog.neighbourhoods.find((n) => n.code === pinZoneCode) : undefined;
  // A lagje / village chosen in the search, with the pin not moved and the text not changed since.
  const approximatePlace = pickedLocality && pickedLocality.label === placeText.trim() ? pickedLocality : null;
  const category = type?.category ?? (categoryCode ? categoryByCode(categoryCode) ?? null : null);
  const stepName = STEPS[step]!;

  // Duplicate check: open reports of the same kind close by.
  useEffect(() => {
    // An approximate point (a whole village) is no proof that a report is "nearby".
    if (!type || !pin || !pinZoneCode || approximatePlace) {
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
  }, [type, pin, pinZoneCode, approximatePlace]);

  /** What is still missing in a step (field → message). Empty object = the step is complete. */
  const errorsFor = useCallback((name: StepName): Errors => {
    const e: Errors = {};
    if ((name === 'type' || name === 'check') && !type) e.requestTypeId = t('report.errors.type');
    if (name === 'location') {
      if (!location) e.latitude = t('report.errors.pin');
      else if (!pinZoneCode) e.latitude = t('report.outsideArea');
    }
    if (name === 'photo' && !photo) e.photo = t('report.errors.photo');
    if (name === 'photo' && analysing) e.photo = t('report.analyze.wait');
    if (name === 'photo' && currentCheck?.status === 'checking') e.photo = t('report.photoCheck.wait');
    if (name === 'photo' && currentCheck?.status === 'unrelated' && !currentCheck.confirmed) e.photo = t('report.photoCheck.confirmFirst');
    if (name === 'details' || name === 'check') {
      if (!description.trim()) e.description = t('report.errors.description');
      else if (description.trim().length < LIMITS.minDescription) e.description = t('report.errors.descriptionShort', { n: LIMITS.minDescription });
      else if (looksLikeGibberish(description)) e.description = t('report.errors.descriptionGibberish');
    }
    if (name === 'contact') {
      if (contactMode === 'contact') {
        const phone = contact.phone.trim();
        if (contact.name.trim().length < 2) e.contactName = t('report.errors.name');
        if (!phone) e.contactPhone = t('report.errors.phoneRequired');
        else if (phoneDigits(phone) < 6) e.contactPhone = t('report.errors.phone');
      }
    }
    return e;
  }, [type, location, pinZoneCode, photo, currentCheck, analysing, description, contactMode, contact, t]);

  const currentErrors = useMemo(() => errorsFor(stepName), [errorsFor, stepName]);
  const firstIncompleteStep = useMemo(() => STEPS.findIndex((s) => s !== 'review' && Object.keys(errorsFor(s)).length > 0), [errorsFor, STEPS]);
  const visibleError = (field: string) => (showErrors ? currentErrors[field] : null) || serverErrors[field] || null;

  function goTo(index: number) {
    setStep(index);
    setShowErrors(false);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showStepErrors() {
    setShowErrors(true);
    requestAnimationFrame(() => topRef.current?.querySelector<HTMLElement>('.has-error input, .has-error select, .has-error textarea, .has-error button')?.focus());
  }

  // The description as last checked, if the text and the type are still the same.
  const currentDescriptionCheck = descriptionCheck && descriptionCheck.text === description.trim() && descriptionCheck.typeId === typeId ? descriptionCheck : null;

  async function next() {
    if (Object.keys(currentErrors).length) {
      showStepErrors();
      return;
    }
    const describing = stepName === 'details' || stepName === 'check';
    // The text and the type proposed together from the photo, unchanged: already consistent.
    const asProposed = stepName === 'check' && Boolean(currentAnalysis?.description) && description === currentAnalysis?.description && typeId === currentAnalysis?.requestTypeId;
    // The description is checked once per text and type (only with the AI on and online).
    if (describing && !asProposed && rules.aiChecks && typeId && navigator.onLine && !currentDescriptionCheck) {
      const text = description.trim();
      setCheckingDescription(true);
      let verdict: 'ok' | 'unrelated' | 'gibberish' | 'abusive' | 'unchecked' = 'unchecked';
      try {
        verdict = (await call(checkDescriptionAction({ description: text, requestTypeId: typeId }))).verdict;
      } catch {
        /* no answer: the report goes on, the department reads it */
      } finally {
        setCheckingDescription(false);
      }
      if (verdict === 'gibberish' || verdict === 'abusive') {
        setServerErrors((e) => ({ ...e, description: t(verdict === 'abusive' ? 'report.descriptionCheck.abusive' : 'report.errors.descriptionGibberish') }));
        showStepErrors();
        return;
      }
      setDescriptionCheck({ text, typeId, status: verdict, confirmed: false });
      if (verdict === 'unrelated') return; // the question under the text decides
    } else if (describing && !asProposed && currentDescriptionCheck?.status === 'unrelated' && !currentDescriptionCheck.confirmed) {
      return;
    }
    goTo(step + 1);
  }

  /** The pin was put, dragged or set by GPS: the field gets the street there (OpenStreetMap), when one is known. */
  const onPin = useCallback((p: LatLng) => {
    setLocation(p);
    setPickedLocality(null);
    setPlaceQuery('');
    setServerErrors((e) => ({ ...e, latitude: undefined }));
    const seq = ++placeSeq.current;
    if (!navigator.onLine) return;
    setResolvingPlace(true);
    call(placeAtAction({ latitude: p.latitude, longitude: p.longitude }))
      .then((r) => { if (seq === placeSeq.current) setPlaceText(r.label ?? ''); })
      .catch(() => { /* no street name: the zone under the map is enough */ })
      .finally(() => { if (seq === placeSeq.current) setResolvingPlace(false); });
  }, []);

  // Typing in "Vendndodhja": lagje and villages at once (no internet needed), streets and places after a short pause.
  useEffect(() => {
    const q = placeQuery.trim();
    const local = searchLocalities(q, catalog.neighbourhoods);
    setSuggestions(local);
    setActiveSuggestion(-1);
    if (plainWords(q).length < 3 || !navigator.onLine) {
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      call(searchPlacesAction({ q }))
        .then((found) => {
          if (cancelled) return;
          const fresh = found.filter((f) => !local.some((l) => plainWords(l.label) === plainWords(f.label)));
          setSuggestions([...local, ...fresh].slice(0, 8));
        })
        .catch(() => { /* the lagje and villages are still there */ })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [placeQuery, catalog.neighbourhoods]);

  /** A place chosen in the list: the pin goes there, the map follows. */
  function pickPlace(s: PlaceSuggestion) {
    placeSeq.current += 1; // a street lookup still on its way must not overwrite the choice
    setResolvingPlace(false);
    const point = { latitude: s.latitude, longitude: s.longitude };
    setLocation(point);
    setPlaceText(s.label);
    setPlaceQuery('');
    setPickedLocality(s.kind === 'locality' && s.zoneId && s.localityId ? { zoneId: s.zoneId, localityId: s.localityId, label: s.label } : null);
    setMapFocus({ point, zoom: s.kind === 'locality' ? 15 : 18 });
    setServerErrors((e) => ({ ...e, latitude: undefined, address: undefined }));
  }

  async function follow(caseNumber: string) {
    try {
      await call(followReportAction({ caseNumber }));
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
    if (!type || !photo || !location) return;
    setSubmitting(true);
    setError(null);
    setServerErrors({});
    const anonymous = contactMode === 'anonymous';
    const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
    const data = {
      requestTypeId: type.id,
      // A village chosen and not moved: "that village" (the server places it approximately). Otherwise the pin, exactly.
      ...(approximatePlace
        ? { locationMode: 'address' as const, neighbourhoodId: approximatePlace.zoneId, localityId: approximatePlace.localityId, address: '' }
        : { locationMode: 'map' as const, latitude: location.latitude, longitude: location.longitude, address: placeText.trim() }),
      description: description.trim(),
      anonymous,
      ...(anonymous ? {} : {
        contactName: contact.name.trim(),
        contactPhone: contact.phone.trim(),
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
        for (const d of err.details as Array<{ field: string; message: string; step?: string; code?: string }>) {
          const field = d.field === 'longitude' ? 'latitude' : d.field === 'photoKey' ? 'photo' : d.field;
          byField[field] = d.message;
          if (field === 'description' && (d.code === 'gibberish' || d.code === 'abusive')) {
            byField.description = t(d.code === 'abusive' ? 'report.descriptionCheck.abusive' : 'report.errors.descriptionGibberish');
          }
          if (field === 'photo' && (d.code === 'inappropriate' || d.code === 'not_photo')) {
            byField.photo = t(d.code === 'not_photo' ? 'report.photoCheck.notPhoto' : 'report.photoCheck.inappropriate');
            setPhoto(null);
          }
          const index = stepIndex((d.step ?? STEP_OF_FIELD[d.field] ?? 'review') as StepName);
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
            <p>{t('report.doneIdLabel')}</p>
            <span className="case-number">{result.caseNumber}</span>
            <button
              type="button" className="btn btn-sm btn-ghost" style={{ marginBottom: 14 }}
              onClick={() => navigator.clipboard?.writeText(result.caseNumber ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {})}
            >
              {copied && <Icon name="check" size={16} />}{copied ? t('report.copied') : t('report.copyNumber')}
            </button>
            {/* Nothing is e-mailed (residents leave no e-mail): this screen is the only place they get the number. */}
            <div className="done-note keep">
              <Icon name="alert" size={20} />
              <p><strong>{t('report.doneKeepTitle')}</strong> {contactMode === 'anonymous' ? t('report.doneKeepAnonymous') : t('report.doneKeepContact')}</p>
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link className="btn" href={`${trackBase}/${result.caseNumber}`}>{t('report.trackIt')}</Link>
              <button type="button" className="btn btn-outline" onClick={() => window.location.assign(embedded ? '/embed' : '/raporto')}>{t('report.another')}</button>
            </div>
          </>
        )}
      </div>
    );
  }

  const chosenType = category ? [lang === 'en' ? category.nameEn : category.nameSq, type ? typeName(type, lang) : ''].filter(Boolean).join(' · ') : '';
  const placeSummary = [placeText.trim() || (location ? t('report.pinOnMap') : ''), pinZone?.name].filter(Boolean).join(' · ');
  const pickType = (id: number) => {
    setTypeId(id);
    if (photoMode) setShowTypePicker(false);
    else goTo(stepIndex('location'));
  };
  const switchMode = (next: ReportMode) => {
    setMode(next);
    setStep(0);
    setShowErrors(false);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const typePicker = (
    <>
      {/* Before a choice: every category. After it: only the chosen one, large, with its problems under it. */}
      {!category && (
        <div className="category-grid" style={{ marginBottom: 20 }}>
          {catalog.categories.map((c) => (
            <button key={c.code} type="button" className="category-tile" onClick={() => { setCategoryCode(c.code); setTypeId(null); }}>
              <CategoryIcon icon={c.icon} size={30} />{lang === 'en' ? c.nameEn : c.nameSq}
            </button>
          ))}
        </div>
      )}
      {category && (
        <>
          <div className="category-chosen">
            <span className="category-chosen-icon"><CategoryIcon icon={category.icon} size={44} /></span>
            <div className="category-chosen-name">
              <span className="label">{t('report.categoryLabel')}</span>
              <h3>{lang === 'en' ? category.nameEn : category.nameSq}</h3>
            </div>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => { setCategoryCode(null); setTypeId(null); }}>
              <Icon name="arrowLeft" size={16} />{t('report.changeCategory')}
            </button>
          </div>
          <p className="muted" style={{ margin: '0 0 8px' }}>{t('report.chooseProblem')}</p>
          <ul className="type-list">
            {category.types.map((ty) => (
              <li key={ty.id}>
                {/* The last choice, "Tjetër": a problem of this category that is not in the list. */}
                {isOtherChoice(ty.code) ? (
                  <button type="button" className={`type-other${ty.id === typeId ? ' selected' : ''}`} aria-pressed={ty.id === typeId} onClick={() => pickType(ty.id)}>
                    <span>{t('report.otherOption')}<span className="type-hint">{t('report.otherOptionHint')}</span></span>
                    <Icon name="arrowRight" size={18} />
                  </button>
                ) : (
                  <button type="button" className={ty.id === typeId ? 'selected' : ''} aria-pressed={ty.id === typeId} onClick={() => pickType(ty.id)}>
                    <span>{lang === 'en' ? ty.nameEn : ty.nameSq}</span>
                    <span className="badge status-received">{t(`kind.${key(ty.kind)}`)}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
  const descriptionField = (
    <>
      <Field label={t('report.description')} hint={type && isOtherChoice(type.code) ? t('report.descriptionHintOther') : t('report.descriptionHint')} htmlFor="desc" error={visibleError('description')} required>
        <textarea id="desc" value={description} maxLength={LIMITS.maxDescription} aria-required="true" aria-describedby="desc-count" onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <p id="desc-count" className={`hint${description.trim().length < LIMITS.minDescription ? '' : ' ok'}`}>
        {t('report.descriptionCount', { n: description.trim().length, min: LIMITS.minDescription })}
      </p>
      {currentDescriptionCheck?.status === 'unrelated' && !currentDescriptionCheck.confirmed && (
        <div className="alert alert-warn" role="alert">
          <p style={{ margin: 0 }}>
            <strong>{t('report.descriptionCheck.unrelatedTitle')}</strong>{' '}
            {t('report.descriptionCheck.unrelatedText', { type: type ? (lang === 'en' ? type.nameEn : type.nameSq) : '' })}
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-sm" onClick={() => (photoMode ? setShowTypePicker(true) : goTo(stepIndex('type')))}>{t('report.descriptionCheck.changeType')}</button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => { setDescriptionCheck({ ...currentDescriptionCheck, confirmed: true }); goTo(step + 1); }}>
              {t('report.descriptionCheck.keep')}
            </button>
          </div>
        </div>
      )}
    </>
  );
  const proposedType = currentAnalysis?.requestTypeId && typeId === currentAnalysis.requestTypeId;

  return (
    <div className="wizard" ref={topRef}>
      <ol className="stepper" aria-label={t('report.progress')}>
        {STEPS.map((s, i) => {
          const done = i < step;
          return (
            <li key={s} className={i === step ? 'current' : done ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <button type="button" disabled={!done} onClick={() => goTo(i)} aria-label={`${i + 1}. ${t(`report.steps.${s}`)}`}>
                <span className="num">{done ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}</span>
                <span className="name">
                  <span className="name-step">{t(`report.steps.${s}`)}</span>
                  {/* "Lloji": the chosen category under it, as soon as it is chosen. */}
                  {(s === 'type' || s === 'check') && category && <span className="name-sub" title={chosenType}>{lang === 'en' ? category.nameEn : category.nameSq}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="step-label">{t('report.stepOf', { n: step + 1, total: STEPS.length })} · {t(`report.steps.${stepName}`)}</div>
      {/* On phones the step names are hidden: the chosen category and problem are shown here instead. */}
      {category && stepName !== 'type' && stepName !== 'check' && (
        <div className="chosen-type"><CategoryIcon icon={category.icon} size={18} /><span>{chosenType}</span></div>
      )}

      {stepName === 'type' && (
        <section>
          <h2>{t('report.chooseType')}</h2>
          {rules.aiChecks && !category && (
            <button type="button" className="mode-switch" onClick={() => switchMode('photo')}>
              <Icon name="camera" size={20} />
              <span><strong>{t('report.analyze.switchToPhoto')}</strong><span className="mode-switch-hint">{t('report.analyze.switchToPhotoHint')}</span></span>
              <Icon name="arrowRight" size={18} />
            </button>
          )}
          {typePicker}
          {(showErrors ? currentErrors.requestTypeId : serverErrors.requestTypeId) && (
            <div className="field-error" role="alert"><Icon name="alert" size={14} />{showErrors ? currentErrors.requestTypeId : serverErrors.requestTypeId}</div>
          )}
        </section>
      )}

      {stepName === 'location' && (
        <section>
          <h2>{t('report.whereTitle')}</h2>
          <Field label={t('report.place')} htmlFor="place" error={visibleError('address') || visibleError('neighbourhoodId') || visibleError('localityId')} required>
            <div className="place-search">
              <Icon name="search" size={18} />
              <input
                id="place" type="text" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="place-options"
                aria-activedescendant={activeSuggestion >= 0 ? `place-option-${activeSuggestion}` : undefined} aria-describedby="place-hint"
                autoComplete="off" enterKeyHint="search" placeholder={t('report.placePlaceholder')} value={placeText} maxLength={LIMITS.maxAddress}
                onChange={(e) => { setPlaceText(e.target.value); setPlaceQuery(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setPlaceQuery(''); return; }
                  if (!suggestions.length) return;
                  if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestion((i) => (i + 1) % suggestions.length); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
                  else if (e.key === 'Enter') { e.preventDefault(); pickPlace(suggestions[Math.max(activeSuggestion, 0)]!); }
                }}
                // Closes the list when leaving the field; the delay lets a tap on a suggestion count first.
                onBlur={() => setTimeout(() => setPlaceQuery(''), 200)}
              />
              {suggestions.length > 0 && (
                <ul id="place-options" role="listbox" className="place-options" aria-label={t('report.place')}>
                  {suggestions.map((s, i) => (
                    <li
                      key={`${s.kind}:${s.label}`} id={`place-option-${i}`} role="option" aria-selected={i === activeSuggestion}
                      className={i === activeSuggestion ? 'active' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => pickPlace(s)}
                    >
                      <Icon name={s.kind === 'locality' ? 'map' : 'pin'} size={16} />
                      <span>{s.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
          <p id="place-hint" className="hint" style={{ marginTop: -6 }}>
            {resolvingPlace ? t('report.placeResolving')
              : searching ? t('report.placeSearching')
              : placeQuery.trim().length >= 3 && suggestions.length === 0 ? t('report.placeNone')
              : t('report.placeHint')}
          </p>
          <LocationPicker
            value={location} onChange={onPin} error={visibleError('latitude')} autoLocate focus={mapFocus} hideCoordinates hideHint
            outside={Boolean(location && !pinZoneCode)}
          />
          {approximatePlace && <p className="hint">{t('report.placeApprox')}</p>}
          {pinZone && (
            <p className="zone-found" role="status"><Icon name="check" size={16} strokeWidth={2.6} /><strong>{t('report.zoneFound', { zone: pinZone.name })}</strong> <span className="muted small">{t('report.zoneFoundHint')}</span></p>
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
          <h2>{photoMode ? t('report.analyze.photoTitle') : t('report.photoTitle')}</h2>
          {photoMode && <p className="muted" style={{ marginTop: -4 }}>{t('report.analyze.photoIntro')}</p>}
          <PhotoInput
            value={photo}
            onChange={(p) => { setPhoto(p); setServerErrors((e) => ({ ...e, photo: undefined })); if (p) setPhotoRefused(null); }}
            required maxBytes={rules.maxUploadBytes}
            error={photoRefused === 'not_photo' ? t('report.photoCheck.notPhoto') : photoRefused ? t('report.photoCheck.inappropriate') : visibleError('photo')}
          />
          {analysing && <p className="hint analysing" role="status"><span className="spinner" aria-hidden="true" />{t('report.analyze.analysing')}</p>}
          {currentCheck?.status === 'checking' && <p className="hint" role="status">{t('report.photoCheck.checking')}</p>}
          {currentCheck?.status === 'ok' && <p className="hint ok" role="status"><Icon name="check" size={14} /> {t('report.photoCheck.ok')}</p>}
          {currentCheck?.status === 'unchecked' && <p className="hint" role="status">{t('report.photoCheck.unchecked')}</p>}
          {currentCheck?.status === 'unrelated' && (currentCheck.confirmed ? (
            <p className="hint" role="status"><Icon name="check" size={14} /> {t('report.photoCheck.confirmed')}</p>
          ) : (
            <div className="alert alert-warn" role="alert">
              <p style={{ margin: 0 }}><strong>{t('report.photoCheck.unrelatedTitle')}</strong> {t('report.photoCheck.unrelatedText', { type: type ? (lang === 'en' ? type.nameEn : type.nameSq) : '' })}</p>
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-sm" onClick={() => setPhoto(null)}>{t('report.photoCheck.another')}</button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setPhotoCheck({ ...currentCheck, confirmed: true })}>{t('report.photoCheck.keep')}</button>
              </div>
            </div>
          ))}
          {photoMode && !analysing && (
            <p className="small" style={{ marginTop: 16 }}>
              <button type="button" className="link-button" onClick={() => switchMode('form')}>{t('report.analyze.switchToForm')}</button>
            </p>
          )}
        </section>
      )}

      {stepName === 'check' && (
        <section>
          <h2>{t('report.analyze.checkTitle')}</h2>
          <div className="check-intro">
            {photoUrl && <img className="check-photo" src={photoUrl} alt={t('report.photoAdded')} />}
            {currentAnalysis?.verdict === 'ok' && (currentAnalysis.requestTypeId || currentAnalysis.description) ? (
              <p>{t('report.analyze.found')}</p>
            ) : (
              <p>{t('report.analyze.notFound')}</p>
            )}
          </div>
          <h3 className="check-label">{t('report.analyze.typeLabel')}</h3>
          {type && category && !showTypePicker ? (
            <div className="check-type">
              <span className="check-type-icon"><CategoryIcon icon={category.icon} size={28} /></span>
              <span className="check-type-name">
                <strong>{typeName(type, lang)}</strong>
                <span className="muted small">{lang === 'en' ? category.nameEn : category.nameSq}{proposedType ? ` · ${t('report.analyze.proposed')}` : ''}</span>
              </span>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowTypePicker(true)}>{t('common.change')}</button>
            </div>
          ) : typePicker}
          {visibleError('requestTypeId') && (
            <div className="field-error" role="alert"><Icon name="alert" size={14} />{visibleError('requestTypeId')}</div>
          )}
          <div style={{ marginTop: 20 }}>{descriptionField}</div>
          {proposedType && description === currentAnalysis?.description && <p className="hint">{t('report.analyze.editHint')}</p>}
        </section>
      )}

      {stepName === 'details' && (
        <section>
          <h2>{t('report.detailsTitle')}</h2>
          {descriptionField}
        </section>
      )}

      {stepName === 'contact' && (
        <section>
          <h2>{t('report.contactTitle')}</h2>
          <p className="contact-intro">{t('report.contactIntro')}</p>
          <label className="switch">
            <input
              type="checkbox" role="switch" checked={contactMode === 'contact'} aria-checked={contactMode === 'contact'}
              onChange={(e) => setContactMode(e.target.checked ? 'contact' : 'anonymous')}
            />
            <span className="switch-track" aria-hidden="true" />
            <span>{t('report.includeContact')}</span>
          </label>
          {contactMode === 'anonymous' ? (
            <p className="hint">{t('report.anonymousText')}</p>
          ) : (
            <>
              <p className="hint">{t('report.contactRule')}</p>
              <div className="grid-2">
                <Field label={t('report.name')} htmlFor="name" error={visibleError('contactName')} required>
                  <input id="name" type="text" autoComplete="name" value={contact.name} maxLength={160} aria-required="true" onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                </Field>
                <Field label={t('report.phone')} hint={t('report.phoneHint')} htmlFor="phone" error={visibleError('contactPhone')} required>
                  <input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={contact.phone} maxLength={40} aria-required="true" onChange={(e) => setContact({ ...contact, phone: e.target.value.replace(/[^0-9 +()-]/g, '') })} />
                </Field>
              </div>
            </>
          )}
        </section>
      )}

      {stepName === 'review' && (
        <section>
          <h2>{t('report.reviewTitle')}</h2>
          <p className="muted">{t('report.reviewIntro')}</p>
          {/* As on BOS:311 "Submit Report": one card, a part per step, each with its own "Ndrysho". */}
          <div className="review-card">
            {([
              {
                step: 'type', icon: <CategoryIcon icon={category?.icon} size={28} />,
                value: [category ? (lang === 'en' ? category.nameEn : category.nameSq) : '', typeName(type, lang)].filter(Boolean).join(' · '),
              },
              {
                step: 'location', icon: <Icon name="pin" size={28} strokeWidth={1.6} />,
                value: (
                  <>
                    <p>{placeSummary || '–'}</p>
                    {location && <div className="review-map"><MiniMap latitude={location.latitude} longitude={location.longitude} /></div>}
                  </>
                ),
              },
              {
                step: 'photo', icon: <Icon name="camera" size={28} strokeWidth={1.6} />,
                value: photoUrl ? <img className="review-photo" src={photoUrl} alt={t('report.photoAdded')} /> : '–',
              },
              { step: 'details', icon: <Icon name="list" size={28} strokeWidth={1.6} />, value: description.trim() || '–' },
              {
                step: 'contact', icon: <Icon name="user" size={28} strokeWidth={1.6} />,
                value: contactMode === 'anonymous' ? t('report.anonymousShort') : [contact.name.trim(), contact.phone.trim()].filter(Boolean).join(' · ') || '–',
              },
            ] as Array<{ step: StepName; icon: ReactNode; value: ReactNode }>).map((item) => (
              <section className="review-item" key={item.step} aria-labelledby={`review-${item.step}`}>
                <span className="review-icon" aria-hidden="true">{item.icon}</span>
                <h3 id={`review-${item.step}`}>{t(`report.steps.${item.step}`)}</h3>
                <div className="review-value">{item.value}</div>
                <button
                  type="button" className="btn btn-sm btn-outline" onClick={() => goTo(stepIndex(item.step))}
                  aria-label={`${t('common.change')}: ${t(`report.steps.${item.step}`)}`}
                >
                  {t('common.change')}
                </button>
              </section>
            ))}
          </div>
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
            <button type="button" className="btn" onClick={() => void next()} disabled={(stepName === 'photo' && (currentCheck?.status === 'checking' || analysing)) || checkingDescription}>
              {stepName === 'photo' && analysing ? t('report.analyze.analysingShort')
                : stepName === 'photo' && currentCheck?.status === 'checking' ? t('report.photoCheck.checking')
                : checkingDescription ? t('report.descriptionCheck.checking')
                  : <>{t('common.next')}<Icon name="arrowRight" size={18} /></>}
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
