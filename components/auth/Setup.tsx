'use client';
/** The very first account: the main admin. Allowed once, and only for the ADMIN_EMAIL set on the server. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { setupAction } from '@/actions/auth';
import { Logo } from '@/components/site/SiteFrame';
import { ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { PasswordRules, passwordProblems } from './PasswordRules';

export default function Setup({ status }: { status: { setupComplete: boolean; adminEmailConfigured: boolean } }) {
  const { t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);

  const problems = passwordProblems(form.password, form.email);
  const errors = {
    name: form.name.trim().length < 2 ? t('auth.setup.nameRequired') : null,
    email: !form.email.trim() ? t('auth.setup.emailRequired') : null,
    password: problems.length ? t('auth.passwordWeak') : null,
    confirm: form.confirm !== form.password ? t('auth.setup.mismatch') : null,
  };
  const valid = !Object.values(errors).some(Boolean);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await call(setupAction({ name: form.name.trim(), email: form.email.trim(), password: form.password }));
      router.replace(res.next);
      router.refresh();
    } catch (err) {
      setError(err as ActionFailure);
      setBusy(false);
    }
  }

  const set = (field: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [field]: e.target.value });
  return (
    <div className="page">
      <div className="container">
        <div className="auth-box card">
          <div className="row" style={{ marginBottom: 12 }}><Logo small /><span className="head" style={{ margin: 0 }}>{t('auth.panel')}</span></div>
          <h1 style={{ fontSize: '1.5rem' }}>{t('auth.setup.title')}</h1>
          {status.setupComplete && (
            <div className="alert alert-info">{t('auth.setup.complete')} <Link href="/hyrje">{t('auth.login.submit')} →</Link></div>
          )}
          {!status.setupComplete && !status.adminEmailConfigured && <div className="alert alert-warn">{t('auth.setup.noAdminEmail')}</div>}
          {!status.setupComplete && status.adminEmailConfigured && (
            <form onSubmit={submit} noValidate>
              <p className="muted">{t('auth.setup.intro')}</p>
              <Field label={t('auth.setup.name')} htmlFor="s-name" error={showErrors ? errors.name : null} required>
                <input id="s-name" type="text" autoComplete="name" value={form.name} onChange={set('name')} />
              </Field>
              <Field label={t('auth.email')} htmlFor="s-email" hint={t('auth.setup.emailHint')} error={showErrors ? errors.email : null} required>
                <input id="s-email" type="email" autoComplete="username" value={form.email} onChange={set('email')} />
              </Field>
              <Field label={t('auth.password')} htmlFor="s-pass" error={showErrors ? errors.password : null} required>
                <input id="s-pass" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} aria-describedby="s-rules" />
              </Field>
              <PasswordRules id="s-rules" password={form.password} email={form.email} />
              <Field label={t('auth.setup.confirm')} htmlFor="s-confirm" error={showErrors ? errors.confirm : null} required>
                <input id="s-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
              </Field>
              <ErrorAlert error={error} />
              <button type="submit" className="btn btn-block" disabled={busy}>{busy ? t('common.wait') : t('auth.setup.submit')}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
