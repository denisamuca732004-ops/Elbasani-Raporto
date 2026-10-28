'use client';
/**
 * Admin: a report that arrived by phone, Facebook, email or at the office.
 * Paste the message and let the AI (or keyword rules) fill the form; check it, then save.
 * Description and a location (pin or address) are required; photo and contact are optional.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { createStaffReportAction, extractReportAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { LocationPicker } from '@/components/maps';
import PhotoInput from '@/components/PhotoInput';
import { useCatalog, useSettings } from '@/components/providers';
import { ErrorAlert, Field, Segmented } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call, fieldErrorsOf } from '@/lib/client/action';
import { departmentName, EMAIL_RE, insideArea, key, phoneDigits, type LatLng } from '@/lib/client/format';
import { uploadPhoto } from '@/lib/client/upload';
import { LIMITS, STAFF_CHANNELS, type Priority, type StaffChannel } from '@/lib/shared/domain';

type Form = {
  requestTypeId: string; channel: StaffChannel; priority: Priority | ''; description: string; address: string; neighbourhoodId: string;
  contactName: string; contactEmail: string; contactPhone: string;
};
const CHANNELS: StaffChannel[] = ['PHONE', 'FACEBOOK', 'EMAIL', 'IN_PERSON'];
const EMPTY: Form = { requestTypeId: '', channel: 'PHONE', priority: '', description: '', address: '', neighbourhoodId: '', contactName: '', contactEmail: '', contactPhone: '' };

export default function NewReport() {
  const { t, lang } = useI18n();
  const { catalog, typeById, departmentById } = useCatalog();
  const { rules } = useSettings();
  const router = useRouter();
  const [text, setText] = useState('');
  const [form, setForm] = useState<Form>(EMPTY);
  const [location, setLocation] = useState<LatLng | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [filled, setFilled] = useState<'ai' | 'rules' | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState<'fill' | 'save' | null>(null);
  const [created, setCreated] = useState<{ id: string; caseNumber: string } | null>(null);

  const type = form.requestTypeId ? typeById(form.requestTypeId) : undefined;
  const errors: Record<string, string | null> = {
    requestTypeId: !type ? t('newReport.errors.type') : null,
    description: form.description.trim().length < LIMITS.minDescription ? t('report.errors.descriptionShort', { n: LIMITS.minDescription }) : null,
    address: !location && form.address.trim().length < LIMITS.minAddress ? t('newReport.errors.location') : null,
    latitude: location && !insideArea(location, rules.serviceArea) ? t('report.outsideArea') : null,
    contactPhone: form.contactPhone.trim() && phoneDigits(form.contactPhone) < 6 ? t('report.errors.phone') : null,
    contactEmail: form.contactEmail.trim() && !EMAIL_RE.test(form.contactEmail.trim()) ? t('report.errors.email') : null,
  };
  const valid = !Object.values(errors).some(Boolean);
  const serverErrors = fieldErrorsOf(error);
  const set = (field: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [field]: e.target.value });

  async function fill() {
    setBusy('fill');
    setError(null);
    try {
      const r = await call(extractReportAction({ text }));
      setForm((f) => ({
        ...f,
        requestTypeId: r.requestTypeId ? String(r.requestTypeId) : f.requestTypeId,
        description: r.description || f.description,
        address: r.address || f.address,
        priority: r.priority || f.priority,
        contactName: r.contactName || f.contactName,
        contactPhone: r.contactPhone || f.contactPhone,
      }));
      setFilled(r.source);
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setBusy('save');
    setError(null);
    try {
      const photoKey = photo ? await uploadPhoto(photo) : undefined;
      const res = await call(createStaffReportAction({
        requestTypeId: Number(form.requestTypeId),
        channel: form.channel,
        description: form.description.trim(),
        address: form.address.trim(),
        ...(location ? { latitude: location.latitude, longitude: location.longitude } : {}),
        neighbourhoodId: form.neighbourhoodId ? Number(form.neighbourhoodId) : null,
        ...(form.priority ? { priority: form.priority } : {}),
        contactName: form.contactName.trim(),
        contactEmail: form.contactEmail.trim(),
        contactPhone: form.contactPhone.trim(),
        ...(photoKey ? { photoKey } : {}),
      }));
      setCreated({ id: res.id, caseNumber: res.caseNumber });
      router.refresh();
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(null);
    }
  }

  if (created) {
    return (
      <div className="done-box" role="status">
        <Icon name="check" size={44} />
        <h2>{t('newReport.created', { n: created.caseNumber })}</h2>
        <p>{t('newReport.tellCitizen')}</p>
        <span className="case-number">{created.caseNumber}</span>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link href={`/admin/reports/${created.id}`} className="btn">{t('newReport.open')}</Link>
          <button type="button" className="btn btn-outline" onClick={() => { setCreated(null); setForm(EMPTY); setText(''); setLocation(null); setPhoto(null); setFilled(null); setShowErrors(false); }}>{t('newReport.another')}</button>
        </div>
      </div>
    );
  }

  const err = (k: string) => (showErrors ? errors[k] : null) || serverErrors[k] || null;
  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1>{t('panel.nav.newReport')}</h1>
          <p className="muted" style={{ margin: 0 }}>{t('newReport.intro')}</p>
        </div>
      </div>

      <section className="card">
        <h2 className="card-title"><Icon name="sparkle" size={16} /> {t('newReport.pasteTitle')}</h2>
        <textarea value={text} maxLength={5000} placeholder={t('newReport.pastePlaceholder')} onChange={(e) => setText(e.target.value)} aria-label={t('newReport.pasteTitle')} />
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-outline" disabled={text.trim().length < 3 || Boolean(busy)} onClick={fill}>
            {busy === 'fill' ? t('common.wait') : t('newReport.fill')}
          </button>
          {filled && <span className="small muted">{filled === 'ai' ? t('newReport.filledAi') : t('newReport.filledRules')}</span>}
        </div>
      </section>

      <form className="card" onSubmit={submit} noValidate>
        <div className="grid-2">
          <Field label={t('newReport.type')} htmlFor="nr-type" error={err('requestTypeId')} required
            hint={type ? t('newReport.routesTo', { sector: departmentName(departmentById(type.departmentId), lang) ?? t('panel.nav.unrouted') }) : null}>
            <select id="nr-type" value={form.requestTypeId} onChange={set('requestTypeId')}>
              <option value="">{t('newReport.chooseType')}</option>
              {catalog.categories.map((c) => (
                <optgroup key={c.code} label={lang === 'en' ? c.nameEn : c.nameSq}>
                  {c.types.map((ty) => <option key={ty.id} value={ty.id}>{lang === 'en' ? ty.nameEn : ty.nameSq}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label={t('newReport.channel')} htmlFor="nr-channel" required>
            <select id="nr-channel" value={form.channel} onChange={set('channel')}>
              {CHANNELS.filter((c) => STAFF_CHANNELS.includes(c)).map((c) => <option key={c} value={c}>{t(`channels.${key(c)}`)}</option>)}
            </select>
          </Field>
        </div>
        <div className="field">
          <span className="label">{t('newReport.priority')}</span>
          <Segmented<Priority | ''>
            label={t('newReport.priority')}
            value={form.priority}
            onChange={(v) => setForm({ ...form, priority: v })}
            options={[
              { value: '', label: t('newReport.priorityDefault') },
              { value: 'LOW', label: t('priority.low'), icon: 'arrowDown' },
              { value: 'MEDIUM', label: t('priority.medium'), icon: 'minus' },
              { value: 'HIGH', label: t('priority.high'), icon: 'arrowUp' },
            ]}
          />
        </div>
        <Field label={t('report.description')} htmlFor="nr-desc" error={err('description')} required>
          <textarea id="nr-desc" value={form.description} maxLength={LIMITS.maxDescription} onChange={set('description')} />
        </Field>
        <div className="grid-2">
          <Field label={t('report.address')} htmlFor="nr-address" error={err('address')} hint={t('newReport.locationHint')}>
            <input id="nr-address" type="text" value={form.address} maxLength={LIMITS.maxAddress} onChange={set('address')} />
          </Field>
          <Field label={t('report.area')} htmlFor="nr-area">
            <select id="nr-area" value={form.neighbourhoodId} onChange={set('neighbourhoodId')}>
              <option value="">{t('report.areaUnknown')}</option>
              {catalog.neighbourhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </Field>
        </div>
        {!showMap ? (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowMap(true)}><Icon name="pin" size={16} />{t('newReport.addMap')}</button>
        ) : (
          <div className="field">
            <LocationPicker value={location} onChange={setLocation} error={err('latitude')} />
            {location && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLocation(null)}>{t('newReport.removePin')}</button>}
          </div>
        )}
        <hr className="divider" />
        <h3>{t('newReport.contactTitle')}</h3>
        <p className="hint" style={{ marginTop: -8 }}>{t('newReport.contactHint')}</p>
        <div className="grid-3">
          <Field label={t('report.name')} htmlFor="nr-name"><input id="nr-name" type="text" value={form.contactName} maxLength={160} onChange={set('contactName')} /></Field>
          <Field label={t('report.phone')} htmlFor="nr-phone" error={err('contactPhone')}>
            <input id="nr-phone" type="tel" value={form.contactPhone} maxLength={40} onChange={(e) => setForm({ ...form, contactPhone: e.target.value.replace(/[^0-9 +()-]/g, '') })} />
          </Field>
          <Field label={t('report.email')} htmlFor="nr-email" error={err('contactEmail')}><input id="nr-email" type="email" value={form.contactEmail} maxLength={200} onChange={set('contactEmail')} /></Field>
        </div>
        <div className="label">{t('newReport.photo')}</div>
        <PhotoInput value={photo} onChange={setPhoto} maxBytes={rules.maxUploadBytes} idPrefix="nr-photo" />
        <ErrorAlert error={error} />
        <div className="wizard-nav">
          <span />
          <button type="submit" className="btn btn-lg" disabled={Boolean(busy)}>{busy === 'save' ? t('common.wait') : t('newReport.submit')}</button>
        </div>
      </form>
    </div>
  );
}
