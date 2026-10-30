'use client';
/** "Llogaria ime": the resident's reports, details, password, sign-out and account deletion. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { deleteMyAccountAction, residentLogoutAction, setMyPasswordAction, updateMyProfileAction } from '@/actions/account';
import { PasswordRules, passwordProblems } from '@/components/auth/PasswordRules';
import Icon from '@/components/Icon';
import { CaseCard } from '@/components/public/Cases';
import { ErrorAlert, Field, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import type { PublicCard } from '@/lib/shared/types';

export interface AccountView { name: string; email: string; phone: string | null; hasPassword: boolean; hasGoogle: boolean }

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>, message?: string): Promise<T | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await fn();
      if (message) setNotice(message);
      return result;
    } catch (err) {
      setError(err as ActionFailure);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, run };
}

function Profile({ me }: { me: AccountView }) {
  const { t } = useI18n();
  const router = useRouter();
  const { busy, error, notice, run } = useAction();
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone ?? '');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (name.trim() !== me.name) body.name = name.trim();
    if (phone.trim() !== (me.phone ?? '')) body.phone = phone.trim() || null;
    if (!Object.keys(body).length) return;
    if (await run(() => call(updateMyProfileAction(body)), t('resident.saved'))) router.refresh();
  }
  return (
    <section className="card">
      <h2 className="card-title">{t('resident.profile')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>{t('resident.profileHint')}</p>
      <form onSubmit={submit} noValidate>
        <div className="grid-2">
          <Field label={t('resident.name')} htmlFor="a-name">
            <input id="a-name" type="text" autoComplete="name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('resident.phone')} htmlFor="a-phone">
            <input id="a-phone" type="tel" autoComplete="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value.replace(/[^0-9 +()-]/g, ''))} />
          </Field>
        </div>
        <p className="small"><strong>{t('auth.email')}:</strong> {me.email}</p>
        <SuccessAlert>{notice}</SuccessAlert>
        <ErrorAlert error={error} />
        <button type="submit" className="btn btn-sm" disabled={busy || name.trim().length < 2}>{t('common.save')}</button>
      </form>
    </section>
  );
}

function Password({ me }: { me: AccountView }) {
  const { t } = useI18n();
  const router = useRouter();
  const { busy, error, notice, run } = useAction();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const weak = passwordProblems(next, me.email).length > 0;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = me.hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next };
    if (await run(() => call(setMyPasswordAction(body)), t('resident.passwordSaved'))) {
      setCurrent('');
      setNext('');
      router.refresh();
    }
  }
  const ways = [me.hasGoogle && t('resident.viaGoogle'), me.hasPassword && t('resident.viaPassword')].filter(Boolean).join(' + ');
  return (
    <section className="card">
      <h2 className="card-title">{me.hasPassword ? t('resident.changePassword') : t('resident.setPassword')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>{t('resident.signInWith')}: <strong>{ways}</strong>{!me.hasPassword && `. ${t('resident.setPasswordHint')}`}</p>
      <form onSubmit={submit} noValidate>
        <div className="grid-2">
          {me.hasPassword && (
            <Field label={t('resident.currentPassword')} htmlFor="p-current">
              <input id="p-current" type="password" autoComplete="current-password" value={current} maxLength={128} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
          )}
          <Field label={t('resident.newPassword')} htmlFor="p-new">
            <input id="p-new" type="password" autoComplete="new-password" value={next} maxLength={128} aria-describedby="p-rules" onChange={(e) => setNext(e.target.value)} />
          </Field>
        </div>
        <PasswordRules password={next} email={me.email} id="p-rules" />
        <SuccessAlert>{notice}</SuccessAlert>
        <ErrorAlert error={error} />
        <button type="submit" className="btn btn-sm" disabled={busy || weak || (me.hasPassword && !current)}>{t('common.save')}</button>
      </form>
    </section>
  );
}

export default function Account({ me, reports }: { me: AccountView; reports: PublicCard[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const { busy, error, run } = useAction();

  async function logout() {
    const res = await run(() => call(residentLogoutAction()));
    if (res) {
      router.replace(res.next);
      router.refresh();
    }
  }
  async function remove() {
    if (!window.confirm(t('resident.deleteConfirm'))) return;
    const res = await run(() => call(deleteMyAccountAction()));
    if (res) {
      router.replace(res.next);
      router.refresh();
    }
  }

  return (
    <div className="page">
      <div className="container stack" style={{ maxWidth: 960 }}>
        <div className="page-head">
          <div>
            <h1 style={{ marginBottom: 4 }}>{t('resident.title')}</h1>
            <p className="muted" style={{ margin: 0 }}>{t('resident.hello', { name: me.name })}</p>
          </div>
          <button type="button" className="btn btn-outline" onClick={logout} disabled={busy}><Icon name="logout" size={16} />{t('resident.logout')}</button>
        </div>
        <ErrorAlert error={error} />

        <section>
          <div className="section-title">
            <h2>{t('resident.myReports')}</h2>
            <Link href="/raporto" className="btn btn-sm"><Icon name="plus" size={14} />{t('home.reportButton')}</Link>
          </div>
          <p className="small muted">{t('resident.myReportsHint')}</p>
          {reports.length === 0
            ? <p className="muted">{t('resident.myReportsEmpty')}</p>
            : <div className="case-list">{reports.map((r) => <CaseCard key={r.caseNumber} item={r} />)}</div>}
        </section>

        <div className="grid-2">
          <Profile me={me} />
          <Password me={me} />
        </div>

        <section className="card danger-zone">
          <h2 className="card-title">{t('resident.deleteTitle')}</h2>
          <p className="small">{t('resident.deleteText')}</p>
          <button type="button" className="btn btn-sm btn-danger" onClick={remove} disabled={busy}>{t('resident.deleteButton')}</button>
        </section>
      </div>
    </div>
  );
}
