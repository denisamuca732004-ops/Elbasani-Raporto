'use client';
/**
 * Admin: accounts of the municipal panel. The admin creates an account for the
 * head of each department; the person signs in with a temporary password shown
 * here once, and must choose their own password at the first sign-in.
 */
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { createUserAction, resetPasswordAction, updateUserAction } from '@/actions/admin';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { ErrorAlert, Field, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import { departmentName, EMAIL_RE, formatDate, key } from '@/lib/client/format';
import type { UserDto } from '@/lib/server/services/users';
import type { PanelRole } from '@/lib/shared/domain';
import { useAdminAction } from './useAdminAction';

function CredentialsCard({ email, password, name, onClose }: { email: string; password: string; name: string; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const loginUrl = `${window.location.origin}/hyrje`;
  const text = t('admin.users.credentialsText', { name, email, password, url: loginUrl });
  return (
    <section className="card credentials" role="status">
      <h2 className="card-title"><Icon name="key" size={16} /> {t('admin.users.credentialsTitle')}</h2>
      <dl className="kv">
        <dt>{t('auth.email')}</dt><dd>{email}</dd>
        <dt>{t('admin.users.tempPassword')}</dt><dd><code className="temp-password">{password}</code></dd>
        <dt>{t('admin.users.loginAt')}</dt><dd>{loginUrl}</dd>
      </dl>
      <p className="small">{t('admin.users.credentialsHint')}</p>
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {})}>
          {copied ? t('admin.copied') : t('admin.users.copyCredentials')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>{t('admin.users.done')}</button>
      </div>
    </section>
  );
}

type UserFormValue = { id?: string; name: string; email: string; phone: string; role: PanelRole; departmentId: string };

function UserForm({ initial, onSubmit, onCancel, busy, isNew, selfId }: {
  initial: UserFormValue; onSubmit: (body: Record<string, unknown>) => void; onCancel?: () => void; busy: boolean; isNew?: boolean; selfId: string;
}) {
  const { t, lang } = useI18n();
  const { departments } = useCatalog();
  const [form, setForm] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const isSelf = Boolean(initial.id) && initial.id === selfId;
  const errors = {
    name: form.name.trim().length < 2 ? t('admin.required') : null,
    email: !EMAIL_RE.test(form.email.trim()) ? t('report.errors.email') : null,
    departmentId: form.role === 'MUNICIPALITY_STAFF' && !form.departmentId ? t('admin.users.sectorRequired') : null,
  };
  const set = (field: keyof UserFormValue) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [field]: e.target.value });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.values(errors).some(Boolean)) {
      setShowErrors(true);
      return;
    }
    onSubmit({
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || (isNew ? undefined : null),
      ...(isSelf ? {} : { role: form.role }),
      departmentId: form.role === 'MUNICIPALITY_STAFF' ? Number(form.departmentId) : null,
    });
  }
  const idp = initial.id ?? 'new';
  const options = departments.some((d) => String(d.id) === form.departmentId) || !form.departmentId
    ? departments
    : [...departments, { id: Number(form.departmentId), code: '', nameSq: `#${form.departmentId}`, nameEn: `#${form.departmentId}`, description: null }];
  return (
    <form onSubmit={submit} noValidate>
      <div className="grid-2">
        <Field label={t('admin.users.name')} htmlFor={`uf-name-${idp}`} error={showErrors ? errors.name : null} required>
          <input id={`uf-name-${idp}`} type="text" value={form.name} maxLength={160} onChange={set('name')} />
        </Field>
        <Field label={t('auth.email')} htmlFor={`uf-email-${idp}`} error={showErrors ? errors.email : null} required>
          <input id={`uf-email-${idp}`} type="email" value={form.email} maxLength={200} onChange={set('email')} />
        </Field>
        <Field label={t('admin.users.phone')} htmlFor={`uf-phone-${idp}`}>
          <input id={`uf-phone-${idp}`} type="tel" value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/[^0-9 +()-]/g, '') })} />
        </Field>
        <Field label={t('admin.users.role')} htmlFor={`uf-role-${idp}`} required>
          <select id={`uf-role-${idp}`} value={form.role} disabled={isSelf} onChange={set('role')}>
            <option value="MUNICIPALITY_STAFF">{t('roles.municipality_staff')}</option>
            <option value="ADMIN">{t('roles.admin')}</option>
          </select>
        </Field>
        {form.role === 'MUNICIPALITY_STAFF' && (
          <Field label={t('admin.users.sector')} htmlFor={`uf-sector-${idp}`} error={showErrors ? errors.departmentId : null} required>
            <select id={`uf-sector-${idp}`} value={form.departmentId} onChange={set('departmentId')}>
              <option value="">{t('admin.users.chooseSector')}</option>
              {options.map((s) => <option key={s.id} value={s.id}>{departmentName(s, lang)}</option>)}
            </select>
          </Field>
        )}
      </div>
      {isNew && <p className="hint">{t('admin.users.tempHint')}</p>}
      <div className="row">
        <button type="submit" className="btn" disabled={busy}>{busy ? t('common.wait') : isNew ? t('admin.users.create') : t('common.save')}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>}
      </div>
    </form>
  );
}

export default function Users({ selfId, items, presetDepartmentId }: { selfId: string; items: UserDto[]; presetDepartmentId: number | null }) {
  const { t, lang } = useI18n();
  const { departmentById } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const { busy, error, notice, run } = useAdminAction();
  const [adding, setAdding] = useState(Boolean(presetDepartmentId));
  const [editing, setEditing] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ email: string; password: string; name: string } | null>(null);
  const presetName = presetDepartmentId ? departmentName(departmentById(presetDepartmentId), lang) : null;
  const clearPreset = () => { if (presetDepartmentId) router.replace(pathname, { scroll: false }); };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t('panel.nav.users')}</h1>
          <p className="muted" style={{ margin: 0 }}>{t('admin.users.intro')}</p>
        </div>
        {!adding && <button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('admin.users.add')}</button>}
      </div>
      {credentials && <CredentialsCard {...credentials} onClose={() => setCredentials(null)} />}
      <SuccessAlert>{notice}</SuccessAlert>
      <ErrorAlert error={error} />
      {adding && (
        <section className="card">
          <h2 className="card-title">{presetName ? t('admin.users.addFor', { sector: presetName }) : t('admin.users.add')}</h2>
          <UserForm
            isNew busy={busy} selfId={selfId}
            initial={{ name: '', email: '', phone: '', role: 'MUNICIPALITY_STAFF', departmentId: presetDepartmentId ? String(presetDepartmentId) : '' }}
            onCancel={() => { setAdding(false); clearPreset(); }}
            onSubmit={async (body) => {
              const res = await run(() => call(createUserAction(body)), '');
              if (res) {
                setAdding(false);
                clearPreset();
                setCredentials({ email: res.user.email, password: res.temporaryPassword, name: res.user.name });
              }
            }}
          />
        </section>
      )}
      <div className="table-wrap">
        <table className="table report-table">
          <thead>
            <tr>
              <th scope="col">{t('admin.users.name')}</th>
              <th scope="col">{t('admin.users.role')}</th>
              <th scope="col">{t('admin.users.status')}</th>
              <th scope="col">{t('admin.users.lastLogin')}</th>
              <th scope="col"><span className="sr-only">{t('admin.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (editing === u.id ? (
              <tr key={u.id}>
                <td colSpan={5}>
                  <UserForm
                    busy={busy} selfId={selfId}
                    initial={{ id: u.id, name: u.name, email: u.email, phone: u.phone ?? '', role: u.role === 'ADMIN' ? 'ADMIN' : 'MUNICIPALITY_STAFF', departmentId: u.departmentId ? String(u.departmentId) : '' }}
                    onCancel={() => setEditing(null)}
                    onSubmit={async (body) => {
                      const res = await run(() => call(updateUserAction(u.id, body)), t('detail.saved'));
                      if (res) setEditing(null);
                    }}
                  />
                </td>
              </tr>
            ) : (
              <tr key={u.id} className={u.active ? '' : 'inactive-row'}>
                <td data-label={t('admin.users.name')}>
                  <div className="strong">{u.name}{u.id === selfId && <span className="muted small"> ({t('admin.users.you')})</span>}</div>
                  <div className="small muted">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                </td>
                <td data-label={t('admin.users.role')}>
                  {t(`roles.${key(u.role)}`)}
                  {u.departmentName && <div className="small muted">{u.departmentName}{u.departmentActive === false ? ` (${t('admin.inactive')})` : ''}</div>}
                </td>
                <td data-label={t('admin.users.status')}>
                  {u.active ? <span className="badge status-closed">{t('admin.active')}</span> : <span className="badge status-rejected">{t('admin.inactive')}</span>}
                  {u.active && u.mustChangePassword && <div className="small muted" style={{ marginTop: 4 }}>{t('admin.users.mustChange')}</div>}
                </td>
                <td data-label={t('admin.users.lastLogin')}>{u.lastLoginAt ? formatDate(u.lastLoginAt, lang, true) : <span className="muted">{t('admin.users.never')}</span>}</td>
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => setEditing(u.id)}><Icon name="edit" size={14} />{t('common.edit')}</button>
                    {u.id !== selfId && (
                      <>
                        <button
                          type="button" className="btn btn-sm btn-ghost" disabled={busy}
                          onClick={async () => {
                            if (!window.confirm(t('admin.users.confirmReset', { name: u.name }))) return;
                            const res = await run(() => call(resetPasswordAction(u.id)), '');
                            if (res) setCredentials({ email: res.user.email, password: res.temporaryPassword, name: res.user.name });
                          }}
                        >
                          <Icon name="key" size={14} />{t('admin.users.reset')}
                        </button>
                        <button
                          type="button" className="btn btn-sm btn-ghost" disabled={busy}
                          onClick={() => {
                            if (u.active && !window.confirm(t('admin.users.confirmDeactivate', { name: u.name }))) return;
                            void run(() => call(updateUserAction(u.id, { active: !u.active })), u.active ? t('admin.users.deactivated') : t('admin.users.activated'));
                          }}
                        >
                          {u.active ? t('admin.deactivate') : t('admin.activate')}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
