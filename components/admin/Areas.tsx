'use client';
/** Admin: the areas (administrative units / neighbourhoods) residents choose from. */
import { useState } from 'react';
import { createNeighbourhoodAction, updateNeighbourhoodAction } from '@/actions/admin';
import Icon from '@/components/Icon';
import { ErrorAlert, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import { useAdminAction } from './useAdminAction';

export interface AreaRow { id: number; name: string; sortOrder: number; active: boolean }

export default function Areas({ items }: { items: AreaRow[] }) {
  const { t } = useI18n();
  const { busy, error, notice, run } = useAdminAction();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <h1>{t('panel.nav.areas')}</h1>
      <p className="muted">{t('admin.areas.intro')}</p>
      <form
        className="row" style={{ alignItems: 'flex-end' }} noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim().length < 2) return;
          const sortOrder = Math.max(0, ...items.map((a) => a.sortOrder)) + 1;
          if (await run(() => call(createNeighbourhoodAction({ name: name.trim(), sortOrder })), t('admin.areas.created'))) setName('');
        }}
      >
        <div className="field" style={{ flex: '1 1 260px', margin: 0 }}>
          <label htmlFor="area-new">{t('admin.areas.newName')}</label>
          <input id="area-new" type="text" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn" disabled={busy || name.trim().length < 2}><Icon name="plus" size={16} />{t('common.add')}</button>
      </form>
      <SuccessAlert>{notice}</SuccessAlert>
      <ErrorAlert error={error} />
      <ul className="area-list">
        {items.map((a) => (
          <li key={a.id} className={a.active ? '' : 'inactive'}>
            {editing === a.id ? (
              <form className="row" style={{ flex: 1 }} onSubmit={async (e) => {
                e.preventDefault();
                if (editName.trim().length < 2) return;
                if (await run(() => call(updateNeighbourhoodAction(a.id, { name: editName.trim() })), t('detail.saved'))) setEditing(null);
              }}>
                <input type="text" value={editName} maxLength={160} aria-label={t('admin.areas.newName')} onChange={(e) => setEditName(e.target.value)} style={{ flex: 1 }} />
                <button type="submit" className="btn btn-sm" disabled={busy}>{t('common.save')}</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
              </form>
            ) : (
              <>
                <span style={{ flex: 1 }}>{a.name}{!a.active && <span className="badge status-rejected" style={{ marginLeft: 8 }}>{t('admin.inactive')}</span>}</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditing(a.id); setEditName(a.name); }}><Icon name="edit" size={14} />{t('common.edit')}</button>
                <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => call(updateNeighbourhoodAction(a.id, { active: !a.active })), t('detail.saved'))}>
                  {a.active ? t('admin.deactivate') : t('admin.activate')}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
