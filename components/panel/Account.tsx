'use client';
/** "My account": name and phone, and changing the password. */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { updateProfileAction } from '@/actions/auth';
import { ChangePasswordForm } from '@/components/auth/ChangePassword';
import { ErrorAlert, Field, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { formatDate, key } from '@/lib/client/format';
import type { Principal } from '@/lib/shared/types';

export default function Account({ principal, lastLoginAt }: { principal: Principal; lastLoginAt: string | null }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState({ name: principal.name, phone: principal.phone ?? '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const department = lang === 'en' ? principal.departmentNameEn : principal.departmentNameSq;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await call(updateProfileAction({ name: form.name.trim(), phone: form.phone.trim() || null }));
      setNotice(t('account.saved'));
      router.refresh();
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1>{t('panel.nav.account')}</h1>
      <section className="card">
        <h2 className="card-title">{t('account.profile')}</h2>
        <dl className="kv" style={{ marginBottom: 16 }}>
          <dt>{t('auth.email')}</dt><dd>{principal.email}</dd>
          <dt>{t('account.role')}</dt><dd>{t(`roles.${key(principal.role)}`)}</dd>
          {department && (<><dt>{t('account.sector')}</dt><dd>{department}</dd></>)}
          <dt>{t('account.lastLogin')}</dt><dd>{formatDate(lastLoginAt, lang, true)}</dd>
        </dl>
        <form onSubmit={save} noValidate>
          <div className="grid-2">
            <Field label={t('account.name')} htmlFor="acc-name" required>
              <input id="acc-name" type="text" value={form.name} maxLength={160} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t('account.phone')} htmlFor="acc-phone">
              <input id="acc-phone" type="tel" value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^0-9 +()-]/g, '') })} />
            </Field>
          </div>
          <SuccessAlert>{notice}</SuccessAlert>
          <ErrorAlert error={error} />
          <button type="submit" className="btn" disabled={busy || form.name.trim().length < 2}>{busy ? t('common.wait') : t('common.save')}</button>
        </form>
      </section>
      <section className="card">
        <h2 className="card-title">{t('auth.change.title')}</h2>
        <SuccessAlert>{pwNotice}</SuccessAlert>
        <ChangePasswordForm email={principal.email} onDone={() => { setPwNotice(t('account.passwordChanged')); router.refresh(); }} />
      </section>
    </div>
  );
}
