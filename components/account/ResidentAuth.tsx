'use client';
/**
 * Residents' sign-in and sign-up (optional accounts): "Continue with Google",
 * or email + password. Staff have their own page (/hyrje).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { googleSignInAction, registerAction, residentLoginAction } from '@/actions/account';
import { PasswordRules, passwordProblems } from '@/components/auth/PasswordRules';
import Icon from '@/components/Icon';
import { ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';

const ERROR_CODES = new Set(['unverified', 'staff', 'disabled', 'google_off', 'too_many']);

/** A plain form, so the browser follows the redirect to Google's own sign-in page. */
function GoogleButton({ next }: { next: string | null }) {
  const { t } = useI18n();
  return (
    <form action={googleSignInAction}>
      {next && <input type="hidden" name="next" value={next} />}
      <button type="submit" className="btn btn-block btn-google"><Icon name="user" size={18} />{t('resident.google')}</button>
    </form>
  );
}

function Or() {
  const { t } = useI18n();
  return <div className="or-line" role="separator"><span>{t('resident.or')}</span></div>;
}

/** ?gabim=… from the Google sign-in (a refused account, Google not configured…). */
function GoogleError({ code }: { code: string | null }) {
  const { t } = useI18n();
  if (!code) return null;
  return <div className="alert alert-warn" role="alert">{t(`resident.errors.${ERROR_CODES.has(code) ? code : 'generic'}`)}</div>;
}

function PasswordInput({ id, value, onChange, autoComplete, describedBy }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; describedBy?: string;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="input-with-button">
      <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} maxLength={128} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} required />
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShow(!show)} aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}>
        <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
      </button>
    </div>
  );
}

const withNext = (path: string, next: string | null) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

export function ResidentSignIn({ googleEnabled, next, error: googleError }: { googleEnabled: boolean; next: string | null; error: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await call(residentLoginAction({ email: email.trim(), password }, next));
      router.replace(res.next);
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
          <h1 style={{ fontSize: '1.6rem' }}>{t('resident.signInTitle')}</h1>
          <p className="muted">{t('resident.signInIntro')}</p>
          <GoogleError code={googleError} />
          {googleEnabled && <><GoogleButton next={next} /><Or /></>}
          <form onSubmit={submit} noValidate>
            <Field label={t('auth.email')} htmlFor="r-email">
              <input id="r-email" type="email" autoComplete="username" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label={t('auth.password')} htmlFor="r-password" hint={googleEnabled ? t('resident.googleHint') : undefined}>
              <PasswordInput id="r-password" value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
            <ErrorAlert error={error} showDetails={false} />
            <button type="submit" className="btn btn-block" disabled={busy || !email || !password}>{busy ? t('common.wait') : t('resident.signInButton')}</button>
          </form>
          <p className="small" style={{ marginTop: 16 }}>{t('resident.noAccount')} <Link href={withNext('/llogaria/regjistrohu', next)}>{t('resident.createOne')}</Link></p>
          <p className="small muted" style={{ marginTop: 4 }}><Link href="/hyrje">{t('resident.staffLink')}</Link></p>
        </div>
      </div>
    </div>
  );
}

export function ResidentRegister({ googleEnabled, next }: { googleEnabled: boolean; next: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const weak = passwordProblems(form.password, form.email).length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await call(registerAction({ name: form.name.trim(), email: form.email.trim(), password: form.password }, next));
      router.replace(res.next);
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
          <h1 style={{ fontSize: '1.6rem' }}>{t('resident.registerTitle')}</h1>
          <p className="muted">{t('resident.registerIntro')}</p>
          {googleEnabled && <><GoogleButton next={next} /><Or /></>}
          <form onSubmit={submit} noValidate>
            <Field label={t('resident.name')} htmlFor="g-name" required>
              <input id="g-name" type="text" autoComplete="name" value={form.name} maxLength={160} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label={t('auth.email')} htmlFor="g-email" required>
              <input id="g-email" type="email" autoComplete="email" value={form.email} maxLength={200} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label={t('auth.password')} htmlFor="g-password" required>
              <PasswordInput id="g-password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} autoComplete="new-password" describedBy="g-rules" />
            </Field>
            <PasswordRules password={form.password} email={form.email} id="g-rules" />
            <ErrorAlert error={error} />
            <button type="submit" className="btn btn-block" disabled={busy || form.name.trim().length < 2 || !form.email.trim() || weak}>
              {busy ? t('common.wait') : t('resident.registerButton')}
            </button>
          </form>
          <p className="small" style={{ marginTop: 16 }}>{t('resident.haveAccount')} <Link href={withNext('/llogaria/hyr', next)}>{t('resident.signInLink')}</Link></p>
        </div>
      </div>
    </div>
  );
}
