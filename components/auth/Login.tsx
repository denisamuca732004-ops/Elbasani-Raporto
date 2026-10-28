'use client';
/** Sign-in to the municipal panel (admin and department heads). */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { loginAction } from '@/actions/auth';
import Icon from '@/components/Icon';
import { Logo } from '@/components/site/SiteFrame';
import { ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { safeNext } from '@/lib/shared/safeNext';

export default function Login({ setupComplete, next, forbidden }: { setupComplete: boolean; next: string | null; forbidden: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await call(loginAction({ email: email.trim(), password }));
      router.replace(res.next === '/admin' ? safeNext(next) ?? res.next : res.next);
      router.refresh();
    } catch (err) {
      setError(err as ActionFailure);
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="container">
        <div className="auth-box card">
          <div className="row" style={{ marginBottom: 12 }}><Logo small /><span className="head" style={{ margin: 0 }}>{t('auth.panel')}</span></div>
          <h1 style={{ fontSize: '1.6rem' }}>{t('auth.login.title')}</h1>
          <p className="muted">{t('auth.login.intro')}</p>
          {forbidden && <div className="alert alert-warn">{t('auth.login.noAccess')}</div>}
          {!setupComplete && (
            <div className="alert alert-info">
              <p style={{ margin: '0 0 8px' }}>{t('auth.login.setupNeeded')}</p>
              <Link href="/hyrje/konfigurimi" className="btn btn-sm">{t('auth.login.createFirstAdmin')}</Link>
            </div>
          )}
          <form onSubmit={submit} noValidate>
            <Field label={t('auth.email')} htmlFor="login-email">
              <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label={t('auth.password')} htmlFor="login-password">
              <div className="input-with-button">
                <input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}>
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} size={18} />
                </button>
              </div>
            </Field>
            <ErrorAlert error={error} showDetails={false} />
            <button type="submit" className="btn btn-block" disabled={busy || !email || !password}>{busy ? t('common.wait') : t('auth.login.submit')}</button>
          </form>
          <details style={{ marginTop: 16 }}>
            <summary className="small">{t('auth.login.forgot')}</summary>
            <p className="small muted">{t('auth.login.forgotText')}</p>
          </details>
        </div>
      </div>
    </div>
  );
}
