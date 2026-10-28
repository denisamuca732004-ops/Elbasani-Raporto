'use client';
/**
 * Choosing a personal password. Required after the admin creates an account
 * (or resets a password); also used by anyone who wants to change theirs.
 */
import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { changePasswordAction, logoutAction } from '@/actions/auth';
import { Logo } from '@/components/site/SiteFrame';
import { ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { PasswordRules, passwordProblems } from './PasswordRules';

export function ChangePasswordForm({ email, forced = false, onDone }: { email: string; forced?: boolean; onDone?: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const problems = passwordProblems(form.newPassword, email);
  const errors = {
    currentPassword: !form.currentPassword ? t('auth.change.currentRequired') : null,
    newPassword: problems.length ? t('auth.passwordWeak') : form.newPassword === form.currentPassword ? t('auth.change.samePassword') : null,
    confirm: form.confirm !== form.newPassword ? t('auth.setup.mismatch') : null,
  };
  const serverField = (field: string) =>
    (Array.isArray(error?.details) && error.details.some((d) => d.field === field) ? error.message : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.values(errors).some(Boolean)) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call(changePasswordAction({ currentPassword: form.currentPassword, newPassword: form.newPassword }));
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setShowErrors(false);
      onDone?.();
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(false);
    }
  }

  const set = (field: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });
  return (
    <form onSubmit={submit} noValidate>
      <Field label={forced ? t('auth.change.temporary') : t('auth.change.current')} htmlFor="cp-current" error={(showErrors ? errors.currentPassword : null) || serverField('currentPassword')} required>
        <input id="cp-current" type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} />
      </Field>
      <Field label={t('auth.change.new')} htmlFor="cp-new" error={(showErrors ? errors.newPassword : null) || serverField('newPassword')} required>
        <input id="cp-new" type="password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} aria-describedby="cp-rules" />
      </Field>
      <PasswordRules id="cp-rules" password={form.newPassword} email={email} />
      <Field label={t('auth.setup.confirm')} htmlFor="cp-confirm" error={showErrors ? errors.confirm : null} required>
        <input id="cp-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
      </Field>
      <ErrorAlert error={error && !serverField('currentPassword') && !serverField('newPassword') ? error : null} />
      <button type="submit" className="btn btn-block" disabled={busy}>{busy ? t('common.wait') : t('auth.change.submit')}</button>
    </form>
  );
}

export default function ChangePassword({ name, email, mustChange }: { name: string; email: string; mustChange: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  async function logout() {
    await logoutAction();
    router.replace('/hyrje');
    router.refresh();
  }
  return (
    <div className="page">
      <div className="container">
        <div className="auth-box card">
          <div className="row" style={{ marginBottom: 12 }}><Logo small /><span className="head" style={{ margin: 0 }}>{t('auth.panel')}</span></div>
          <h1 style={{ fontSize: '1.5rem' }}>{t('auth.change.title')}</h1>
          <p className="muted">{mustChange ? t('auth.change.forcedIntro', { name }) : t('auth.change.intro')}</p>
          <ChangePasswordForm email={email} forced={mustChange} onDone={() => { router.replace('/admin'); router.refresh(); }} />
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={logout}>{t('panel.logout')}</button>
        </div>
      </div>
    </div>
  );
}
