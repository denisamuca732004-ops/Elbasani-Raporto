'use client';
/**
 * Admin: the departments (sectors) of the municipality. Every report type is
 * routed to a department, and every department gets one or more heads
 * (përgjegjës) who handle its reports.
 */
import Link from 'next/link';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { createDepartmentAction, updateDepartmentAction } from '@/actions/admin';
import Icon from '@/components/Icon';
import { ErrorAlert, Field, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import type { DepartmentRow } from '@/lib/server/services/admin';
import { useAdminAction } from './useAdminAction';

export const slugify = (s: string) => s.toLowerCase().replace(/ë/g, 'e').replace(/ç/g, 'c').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

type DepartmentForm = { nameSq: string; nameEn: string; code: string; description: string; email: string };
const EMPTY: DepartmentForm = { nameSq: '', nameEn: '', code: '', description: '', email: '' };

function DepartmentFormView({ initial, onSubmit, onCancel, submitLabel, busy, isNew }: {
  initial: DepartmentForm; onSubmit: (body: Record<string, unknown>) => void; onCancel?: () => void; submitLabel: string; busy: boolean; isNew?: boolean;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState(initial);
  const [codeTouched, setCodeTouched] = useState(!isNew);
  const [showErrors, setShowErrors] = useState(false);
  const errors = {
    nameSq: form.nameSq.trim().length < 2 ? t('admin.required') : null,
    nameEn: form.nameEn.trim().length < 2 ? t('admin.required') : null,
    code: isNew && !/^[a-z0-9_.-]{2,60}$/.test(form.code) ? t('admin.sectors.codeRule') : null,
  };
  const set = (field: keyof DepartmentForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [field]: value, ...(field === 'nameSq' && isNew && !codeTouched ? { code: slugify(value) } : {}) }));
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.values(errors).some(Boolean)) {
      setShowErrors(true);
      return;
    }
    onSubmit({
      nameSq: form.nameSq.trim(), nameEn: form.nameEn.trim(), description: form.description.trim(), email: form.email.trim(),
      ...(isNew ? { code: form.code } : {}),
    });
  }
  const suffix = initial.code || 'new';
  return (
    <form onSubmit={submit} noValidate>
      <div className="grid-2">
        <Field label={t('admin.nameSq')} htmlFor={`sf-sq-${suffix}`} error={showErrors ? errors.nameSq : null} required>
          <input id={`sf-sq-${suffix}`} type="text" value={form.nameSq} maxLength={160} onChange={set('nameSq')} />
        </Field>
        <Field label={t('admin.nameEn')} htmlFor={`sf-en-${suffix}`} error={showErrors ? errors.nameEn : null} required>
          <input id={`sf-en-${suffix}`} type="text" value={form.nameEn} maxLength={160} onChange={set('nameEn')} />
        </Field>
        {isNew && (
          <Field label={t('admin.code')} htmlFor="sf-code" hint={t('admin.sectors.codeHint')} error={showErrors ? errors.code : null} required>
            <input id="sf-code" type="text" value={form.code} maxLength={60} onChange={(e) => { setCodeTouched(true); setForm({ ...form, code: e.target.value.toLowerCase() }); }} />
          </Field>
        )}
        <Field label={t('admin.sectors.email')} htmlFor={`sf-email-${suffix}`} hint={t('admin.sectors.emailHint')}>
          <input id={`sf-email-${suffix}`} type="email" value={form.email} maxLength={200} onChange={set('email')} />
        </Field>
      </div>
      <Field label={t('admin.sectors.description')} htmlFor={`sf-desc-${suffix}`} hint={t('admin.sectors.descriptionHint')}>
        <textarea id={`sf-desc-${suffix}`} value={form.description} maxLength={1000} onChange={set('description')} style={{ minHeight: 70 }} />
      </Field>
      <div className="row">
        <button type="submit" className="btn" disabled={busy}>{busy ? t('common.wait') : submitLabel}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>}
      </div>
    </form>
  );
}

export default function Departments({ items }: { items: DepartmentRow[] }) {
  const { t, lang } = useI18n();
  const { busy, error, notice, run } = useAdminAction();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t('panel.nav.sectors')}</h1>
          <p className="muted" style={{ margin: 0 }}>{t('admin.sectors.intro')}</p>
        </div>
        {!adding && <button type="button" className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{t('admin.sectors.add')}</button>}
      </div>
      <SuccessAlert>{notice}</SuccessAlert>
      <ErrorAlert error={error} />
      {adding && (
        <section className="card">
          <h2 className="card-title">{t('admin.sectors.add')}</h2>
          <DepartmentFormView
            isNew initial={EMPTY} busy={busy} submitLabel={t('admin.sectors.create')} onCancel={() => setAdding(false)}
            onSubmit={async (body) => {
              const ok = await run(() => call(createDepartmentAction(body)), t('admin.sectors.created', { name: String(body.nameSq) }));
              if (ok) setAdding(false);
            }}
          />
        </section>
      )}
      {items.map((s) => (
        <article key={s.id} className={`card sector-card${s.active ? '' : ' inactive'}`}>
          {editing === s.id ? (
            <DepartmentFormView
              initial={{ nameSq: s.nameSq, nameEn: s.nameEn, code: s.code, description: s.description ?? '', email: s.email ?? '' }}
              busy={busy} submitLabel={t('common.save')} onCancel={() => setEditing(null)}
              onSubmit={async (body) => {
                const ok = await run(() => call(updateDepartmentAction(s.id, body)), t('detail.saved'));
                if (ok) setEditing(null);
              }}
            />
          ) : (
            <>
              <div className="row-between">
                <div>
                  <h2 className="card-title" style={{ marginBottom: 4 }}>{lang === 'en' ? s.nameEn : s.nameSq}</h2>
                  <div className="small muted">{s.code}{s.email ? ` · ${s.email}` : ''}</div>
                </div>
                <div className="row">
                  {!s.active && <span className="badge status-rejected">{t('admin.inactive')}</span>}
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setEditing(s.id)}><Icon name="edit" size={14} />{t('common.edit')}</button>
                  <button
                    type="button" className="btn btn-sm btn-ghost" disabled={busy}
                    onClick={() => run(() => call(updateDepartmentAction(s.id, { active: !s.active })), s.active ? t('admin.sectors.deactivated') : t('admin.sectors.activated'))}
                  >
                    {s.active ? t('admin.deactivate') : t('admin.activate')}
                  </button>
                </div>
              </div>
              {s.description && <p className="small" style={{ margin: '8px 0 0' }}>{s.description}</p>}
              <div className="sector-stats">
                <Link href={`/admin/reports?departmentId=${s.id}`}><strong>{s.openReports}</strong> {t('admin.sectors.openReports')}</Link>
                <Link href={`/admin/report-types?departmentId=${s.id}`}><strong>{s.activeTypes}</strong> {t('admin.sectors.types')}</Link>
                <span><strong>{s.heads.filter((h) => h.active).length}</strong> {t('admin.sectors.heads')}</span>
              </div>
              <div className="heads">
                {s.heads.length === 0 && <span className="badge badge-overdue">{t('admin.sectors.noHead')}</span>}
                {s.heads.map((h) => (
                  <span key={h.id} className={`head-chip${h.active ? '' : ' inactive'}`}><Icon name="user" size={12} /> {h.name}</span>
                ))}
                {s.active && <Link href={`/admin/users?departmentId=${s.id}`} className="btn btn-sm btn-ghost"><Icon name="plus" size={14} />{t('admin.sectors.addHead')}</Link>}
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  );
}
