'use client';
/**
 * Admin: report categories and types. For every type the admin decides which
 * department receives it (automatic routing), the deadline in days and the default priority.
 */
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { createCategoryAction, createRequestTypeAction, updateCategoryAction, updateRequestTypeAction } from '@/actions/admin';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { CategoryIcon, ErrorAlert, Field, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import { departmentName, key } from '@/lib/client/format';
import { PRIORITIES, type Priority, type RequestKind } from '@/lib/shared/domain';
import { slugify } from './Departments';
import { useAdminAction } from './useAdminAction';

const ICONS = ['paw', 'trash', 'road', 'bulb', 'drop', 'tree', 'building', 'health', 'store', 'other'];

export interface AdminType {
  id: number; code: string; nameSq: string; nameEn: string; kind: RequestKind; departmentId: number | null;
  departmentActive: boolean | null; slaDays: number; defaultPriority: Priority; active: boolean;
}
export interface AdminCategory { id: number; code: string; nameSq: string; nameEn: string; icon: string; active: boolean; types: AdminType[] }

type Departments = ReturnType<typeof useCatalog>['departments'];

function TypeRow({ type, departments, onSave, busy }: { type: AdminType; departments: Departments; onSave: (id: number, body: Record<string, unknown>) => void; busy: boolean }) {
  const { t, lang } = useI18n();
  const initial = useMemo(() => ({
    departmentId: type.departmentId ? String(type.departmentId) : '', slaDays: String(type.slaDays), defaultPriority: type.defaultPriority,
    active: type.active, nameSq: type.nameSq, nameEn: type.nameEn,
  }), [type]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const changed = JSON.stringify(form) !== JSON.stringify(initial);
  const sla = Number(form.slaDays);
  const valid = Number.isInteger(sla) && sla >= 1 && sla <= 365 && form.nameSq.trim().length >= 2 && form.nameEn.trim().length >= 2;
  const inactiveDepartment = type.departmentId !== null && type.departmentActive === false;

  /** Only the fields that really changed are sent. */
  function save() {
    const body: Record<string, unknown> = {};
    if (form.departmentId !== initial.departmentId) body.departmentId = form.departmentId ? Number(form.departmentId) : null;
    if (form.slaDays !== initial.slaDays) body.slaDays = sla;
    if (form.defaultPriority !== initial.defaultPriority) body.defaultPriority = form.defaultPriority;
    if (form.active !== initial.active) body.active = form.active;
    if (form.nameSq !== initial.nameSq) body.nameSq = form.nameSq.trim();
    if (form.nameEn !== initial.nameEn) body.nameEn = form.nameEn.trim();
    onSave(type.id, body);
  }

  return (
    <tr className={form.active ? '' : 'inactive-row'}>
      <td data-label={t('admin.catalogue.type')}>
        <input type="text" value={form.nameSq} aria-label={t('admin.nameSq')} maxLength={160} onChange={(e) => setForm({ ...form, nameSq: e.target.value })} />
        <input type="text" value={form.nameEn} aria-label={t('admin.nameEn')} maxLength={160} className="small" style={{ marginTop: 4 }} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
        <div className="small muted">{type.code} · {t(`kind.${key(type.kind)}`)}</div>
      </td>
      <td data-label={t('admin.catalogue.sector')}>
        <select value={form.departmentId} aria-label={t('admin.catalogue.sector')} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
          <option value="">{t('admin.catalogue.noSector')}</option>
          {departments.map((s) => <option key={s.id} value={s.id}>{departmentName(s, lang)}</option>)}
          {inactiveDepartment && <option value={String(type.departmentId)}>#{type.departmentId} ({t('admin.inactive')})</option>}
        </select>
        {inactiveDepartment && <div className="field-error"><Icon name="alert" size={14} />{t('admin.catalogue.inactiveSector')}</div>}
      </td>
      <td data-label={t('admin.catalogue.sla')}>
        <input type="number" min={1} max={365} value={form.slaDays} aria-label={t('admin.catalogue.sla')} style={{ maxWidth: 90 }} onChange={(e) => setForm({ ...form, slaDays: e.target.value })} />
      </td>
      <td data-label={t('admin.catalogue.priority')}>
        <select value={form.defaultPriority} aria-label={t('admin.catalogue.priority')} onChange={(e) => setForm({ ...form, defaultPriority: e.target.value as Priority })}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${key(p)}`)}</option>)}
        </select>
      </td>
      <td data-label={t('admin.active')}>
        <input type="checkbox" checked={form.active} aria-label={t('admin.active')} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </td>
      <td>
        <button type="button" className="btn btn-sm" disabled={!changed || !valid || busy} onClick={save}>{t('common.save')}</button>
      </td>
    </tr>
  );
}

type NewTypeValue = { categoryId: string; nameSq: string; nameEn: string; kind: RequestKind; departmentId: string; slaDays: string; defaultPriority: Priority; keywords: string };

function NewTypeForm({ categories, departments, onCreate, busy, defaultDepartment }: {
  categories: AdminCategory[]; departments: Departments; onCreate: (body: Record<string, unknown>) => void; busy: boolean; defaultDepartment: string;
}) {
  const { t, lang } = useI18n();
  const [form, setForm] = useState<NewTypeValue>({ categoryId: '', nameSq: '', nameEn: '', kind: 'PROBLEM', departmentId: defaultDepartment, slaDays: '10', defaultPriority: 'MEDIUM', keywords: '' });
  const [showErrors, setShowErrors] = useState(false);
  const category = categories.find((c) => String(c.id) === form.categoryId);
  const errors = {
    categoryId: !form.categoryId ? t('admin.required') : null,
    nameSq: form.nameSq.trim().length < 2 ? t('admin.required') : null,
    nameEn: form.nameEn.trim().length < 2 ? t('admin.required') : null,
    slaDays: !(Number.isInteger(Number(form.slaDays)) && Number(form.slaDays) >= 1 && Number(form.slaDays) <= 365) ? t('admin.catalogue.slaRule') : null,
  };
  const set = (field: keyof NewTypeValue) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [field]: e.target.value });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.values(errors).some(Boolean) || !category) {
          setShowErrors(true);
          return;
        }
        onCreate({
          code: `${category.code}.${slugify(form.nameEn || form.nameSq)}`.slice(0, 80),
          categoryId: Number(form.categoryId), nameSq: form.nameSq.trim(), nameEn: form.nameEn.trim(), kind: form.kind,
          departmentId: form.departmentId ? Number(form.departmentId) : null, slaDays: Number(form.slaDays), defaultPriority: form.defaultPriority,
          keywords: form.keywords.trim(),
        });
      }}
    >
      <div className="grid-3">
        <Field label={t('admin.catalogue.category')} htmlFor="nt-cat" error={showErrors ? errors.categoryId : null} required>
          <select id="nt-cat" value={form.categoryId} onChange={set('categoryId')}>
            <option value="">{t('admin.catalogue.chooseCategory')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{lang === 'en' ? c.nameEn : c.nameSq}</option>)}
          </select>
        </Field>
        <Field label={t('admin.nameSq')} htmlFor="nt-sq" error={showErrors ? errors.nameSq : null} required><input id="nt-sq" type="text" value={form.nameSq} maxLength={160} onChange={set('nameSq')} /></Field>
        <Field label={t('admin.nameEn')} htmlFor="nt-en" error={showErrors ? errors.nameEn : null} required><input id="nt-en" type="text" value={form.nameEn} maxLength={160} onChange={set('nameEn')} /></Field>
        <Field label={t('admin.catalogue.kind')} htmlFor="nt-kind">
          <select id="nt-kind" value={form.kind} onChange={set('kind')}>
            <option value="PROBLEM">{t('kind.problem')}</option>
            <option value="SERVICE">{t('kind.service')}</option>
          </select>
        </Field>
        <Field label={t('admin.catalogue.sector')} htmlFor="nt-sector">
          <select id="nt-sector" value={form.departmentId} onChange={set('departmentId')}>
            <option value="">{t('admin.catalogue.noSector')}</option>
            {departments.map((s) => <option key={s.id} value={s.id}>{departmentName(s, lang)}</option>)}
          </select>
        </Field>
        <Field label={t('admin.catalogue.sla')} htmlFor="nt-sla" error={showErrors ? errors.slaDays : null}><input id="nt-sla" type="number" min={1} max={365} value={form.slaDays} onChange={set('slaDays')} /></Field>
        <Field label={t('admin.catalogue.priority')} htmlFor="nt-prio">
          <select id="nt-prio" value={form.defaultPriority} onChange={set('defaultPriority')}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${key(p)}`)}</option>)}
          </select>
        </Field>
        <Field label={t('admin.catalogue.keywords')} htmlFor="nt-kw" hint={t('admin.catalogue.keywordsHint')}><input id="nt-kw" type="text" value={form.keywords} maxLength={500} onChange={set('keywords')} /></Field>
      </div>
      <button type="submit" className="btn" disabled={busy}>{t('admin.catalogue.createType')}</button>
    </form>
  );
}

export default function ReportTypes({ categories, departmentFilter }: { categories: AdminCategory[]; departmentFilter: string }) {
  const { t, lang } = useI18n();
  const { departments } = useCatalog();
  const router = useRouter();
  const pathname = usePathname();
  const { busy, error, notice, run } = useAdminAction();
  const [adding, setAdding] = useState<'type' | 'category' | null>(null);
  const [newCategory, setNewCategory] = useState({ nameSq: '', nameEn: '', icon: 'other' });

  const visible = categories.map((c) => ({
    ...c,
    types: c.types.filter((ty) => !departmentFilter || String(ty.departmentId ?? '') === departmentFilter || (departmentFilter === 'none' && !ty.departmentId)),
  })).filter((c) => !departmentFilter || c.types.length > 0);
  const unmapped = categories.flatMap((c) => c.types).filter((ty) => ty.active && !ty.departmentId).length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t('panel.nav.catalogue')}</h1>
          <p className="muted" style={{ margin: 0 }}>{t('admin.catalogue.intro')}</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => setAdding(adding === 'type' ? null : 'type')}><Icon name="plus" size={16} />{t('admin.catalogue.addType')}</button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setAdding(adding === 'category' ? null : 'category')}><Icon name="plus" size={16} />{t('admin.catalogue.addCategory')}</button>
        </div>
      </div>
      {unmapped > 0 && <div className="alert alert-warn">{t('admin.catalogue.unmapped', { n: unmapped })}</div>}
      <SuccessAlert>{notice}</SuccessAlert>
      <ErrorAlert error={error} />
      {adding === 'type' && (
        <section className="card">
          <h2 className="card-title">{t('admin.catalogue.addType')}</h2>
          <NewTypeForm
            categories={categories} departments={departments} busy={busy}
            defaultDepartment={departmentFilter && departmentFilter !== 'none' ? departmentFilter : ''}
            onCreate={async (body) => { if (await run(() => call(createRequestTypeAction(body)), t('admin.catalogue.typeCreated'))) setAdding(null); }}
          />
        </section>
      )}
      {adding === 'category' && (
        <section className="card">
          <h2 className="card-title">{t('admin.catalogue.addCategory')}</h2>
          <form
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (newCategory.nameSq.trim().length < 2 || newCategory.nameEn.trim().length < 2) return;
              const ok = await run(() => call(createCategoryAction({
                code: slugify(newCategory.nameEn || newCategory.nameSq), nameSq: newCategory.nameSq.trim(), nameEn: newCategory.nameEn.trim(),
                icon: newCategory.icon, sortOrder: categories.length + 1,
              })), t('admin.catalogue.categoryCreated'));
              if (ok) { setAdding(null); setNewCategory({ nameSq: '', nameEn: '', icon: 'other' }); }
            }}
          >
            <div className="grid-3">
              <Field label={t('admin.nameSq')} htmlFor="nc-sq" required><input id="nc-sq" type="text" value={newCategory.nameSq} maxLength={160} onChange={(e) => setNewCategory({ ...newCategory, nameSq: e.target.value })} /></Field>
              <Field label={t('admin.nameEn')} htmlFor="nc-en" required><input id="nc-en" type="text" value={newCategory.nameEn} maxLength={160} onChange={(e) => setNewCategory({ ...newCategory, nameEn: e.target.value })} /></Field>
              <Field label={t('admin.catalogue.icon')} htmlFor="nc-icon">
                <select id="nc-icon" value={newCategory.icon} onChange={(e) => setNewCategory({ ...newCategory, icon: e.target.value })}>
                  {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
            </div>
            <button type="submit" className="btn" disabled={busy || newCategory.nameSq.trim().length < 2 || newCategory.nameEn.trim().length < 2}>{t('admin.catalogue.createCategory')}</button>
          </form>
        </section>
      )}
      <div className="filter-row">
        <div className="field inline">
          <label htmlFor="cat-sector">{t('admin.catalogue.filterSector')}</label>
          <select id="cat-sector" value={departmentFilter} onChange={(e) => router.replace(e.target.value ? `${pathname}?departmentId=${e.target.value}` : pathname, { scroll: false })}>
            <option value="">{t('dashboard.allSectors')}</option>
            {departments.map((s) => <option key={s.id} value={s.id}>{departmentName(s, lang)}</option>)}
            <option value="none">{t('admin.catalogue.noSector')}</option>
          </select>
        </div>
      </div>
      {visible.map((c) => (
        <section key={c.id} className={`card${c.active ? '' : ' inactive'}`}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2 className="card-title row" style={{ margin: 0 }}><CategoryIcon icon={c.icon} size={22} /> {lang === 'en' ? c.nameEn : c.nameSq}</h2>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => call(updateCategoryAction(c.id, { active: !c.active })), t('detail.saved'))}>
              {c.active ? t('admin.catalogue.hideCategory') : t('admin.catalogue.showCategory')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table report-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.catalogue.type')}</th>
                  <th scope="col">{t('admin.catalogue.sector')}</th>
                  <th scope="col">{t('admin.catalogue.sla')}</th>
                  <th scope="col">{t('admin.catalogue.priority')}</th>
                  <th scope="col">{t('admin.active')}</th>
                  <th scope="col"><span className="sr-only">{t('admin.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {c.types.map((ty) => (
                  <TypeRow
                    key={ty.id} type={ty} departments={departments} busy={busy}
                    onSave={(id, body) => { void run(() => call(updateRequestTypeAction(id, body)), t('admin.catalogue.typeSaved')); }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="hint">{t('admin.catalogue.routingNote')}</p>
    </div>
  );
}
