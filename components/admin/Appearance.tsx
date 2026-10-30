'use client';
/** Admin: names, logo and colours of the platform, and where the iframe may be embedded. */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { saveSettingsAction } from '@/actions/admin';
import { ErrorAlert, Field, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import type { AppSettings, Branding } from '@/lib/shared/types';
import { useAdminAction } from './useAdminAction';

const HEX = /^#[0-9A-Fa-f]{6}$/;
const COLORS = ['headerColor', 'footerColor', 'buttonColor'] as const;

export default function Appearance({ settings }: { settings: AppSettings }) {
  const { t } = useI18n();
  const { busy, error, notice, run } = useAdminAction();
  const [form, setForm] = useState<Branding>(settings.branding);
  const [origins, setOrigins] = useState(settings.embed.allowedOrigins.join('\n'));

  const colorsValid = COLORS.every((k) => HEX.test(form[k]));
  const originList = origins.split('\n').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  const originsValid = originList.every((o) => /^https?:\/\/[^/\s]+$/.test(o));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!colorsValid || !originsValid) return;
    await run(() => call(saveSettingsAction({ branding: form, embed: { allowedOrigins: originList } })), t('detail.saved'));
  }

  const set = (field: keyof Branding) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });
  return (
    <form className="stack" style={{ maxWidth: 820 }} onSubmit={save} noValidate>
      <h1>{t('panel.nav.appearance')}</h1>
      <section className="card">
        <div className="grid-2">
          <Field label={t('admin.appearance.appName')} htmlFor="ap-app"><input id="ap-app" type="text" value={form.appName} maxLength={120} onChange={set('appName')} /></Field>
          <Field label={t('admin.appearance.municipalityName')} htmlFor="ap-mun"><input id="ap-mun" type="text" value={form.municipalityName} maxLength={120} onChange={set('municipalityName')} /></Field>
          <Field label={t('admin.appearance.appNameEn')} htmlFor="ap-app-en"><input id="ap-app-en" type="text" lang="en" value={form.appNameEn} maxLength={120} onChange={set('appNameEn')} /></Field>
          <Field label={t('admin.appearance.municipalityNameEn')} htmlFor="ap-mun-en"><input id="ap-mun-en" type="text" lang="en" value={form.municipalityNameEn} maxLength={120} onChange={set('municipalityNameEn')} /></Field>
        </div>
        <Field label={t('admin.appearance.logoUrl')} htmlFor="ap-logo" hint={t('admin.appearance.logoHint')}><input id="ap-logo" type="text" value={form.logoUrl} maxLength={500} onChange={set('logoUrl')} /></Field>
        <div className="grid-3">
          {COLORS.map((k) => (
            <Field key={k} label={t(`admin.appearance.${k}`)} htmlFor={`ap-${k}`} error={!HEX.test(form[k]) ? t('admin.appearance.colorRule') : null}>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input id={`ap-${k}`} type="color" value={HEX.test(form[k]) ? form[k] : '#000000'} onChange={set(k)} style={{ width: 56, flex: 'none' }} />
                <input type="text" value={form[k]} maxLength={7} aria-label={t(`admin.appearance.${k}`)} onChange={set(k)} />
              </div>
            </Field>
          ))}
        </div>
      </section>
      <section className="card">
        <Field label={t('admin.appearance.embedOrigins')} htmlFor="ap-origins" hint={t('admin.appearance.embedHint')} error={!originsValid ? t('admin.appearance.originRule') : null}>
          <textarea id="ap-origins" value={origins} onChange={(e) => setOrigins(e.target.value)} />
        </Field>
      </section>
      <SuccessAlert>{notice}</SuccessAlert>
      <ErrorAlert error={error} />
      <div><button type="submit" className="btn" disabled={busy || !colorsValid || !originsValid}>{busy ? t('common.wait') : t('common.save')}</button></div>
    </form>
  );
}
