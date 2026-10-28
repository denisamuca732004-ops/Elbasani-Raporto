'use client';
/**
 * Admin: the zones (administrative units) and, for each, its lagje (city) or
 * villages. A resident who types the address chooses the zone and then one of
 * ITS lagje or villages; with GPS the zone is found from the zone borders.
 */
import { useState } from 'react';
import { createLocalityAction, createNeighbourhoodAction, updateLocalityAction, updateNeighbourhoodAction } from '@/actions/admin';
import Icon from '@/components/Icon';
import { ErrorAlert, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { call } from '@/lib/client/action';
import { useAdminAction } from './useAdminAction';

export interface AreaRow {
  id: number; name: string; code: string | null; sortOrder: number; active: boolean;
  localities: Array<{ id: number; name: string; active: boolean }>;
}

type Run = ReturnType<typeof useAdminAction>['run'];

function Places({ area, busy, run }: { area: AreaRow; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  return (
    <div className="places">
      <ul className="place-list">
        {area.localities.map((l) => (
          <li key={l.id} className={l.active ? '' : 'inactive'}>
            {editing === l.id ? (
              <form className="row" onSubmit={async (e) => {
                e.preventDefault();
                if (editName.trim().length < 2) return;
                if (await run(() => call(updateLocalityAction(l.id, { name: editName.trim() })), t('detail.saved'))) setEditing(null);
              }}>
                <input type="text" value={editName} maxLength={160} aria-label={t('admin.areas.placeName')} onChange={(e) => setEditName(e.target.value)} />
                <button type="submit" className="btn btn-sm" disabled={busy}>{t('common.save')}</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
              </form>
            ) : (
              <>
                <span>{l.name}{!l.active && <span className="badge badge-muted" style={{ marginLeft: 6 }}>{t('admin.inactive')}</span>}</span>
                <span className="row" style={{ gap: 2 }}>
                  <button type="button" className="btn btn-sm btn-ghost" aria-label={`${t('common.edit')}: ${l.name}`} onClick={() => { setEditing(l.id); setEditName(l.name); }}><Icon name="edit" size={14} /></button>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => call(updateLocalityAction(l.id, { active: !l.active })), t('detail.saved'))}>
                    {l.active ? t('admin.deactivate') : t('admin.activate')}
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="row" style={{ alignItems: 'flex-end', marginTop: 10 }} noValidate onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) return;
        if (await run(() => call(createLocalityAction({ neighbourhoodId: area.id, name: name.trim() })), t('admin.areas.placeAdded'))) setName('');
      }}>
        <div className="field" style={{ flex: '1 1 220px', margin: 0 }}>
          <label htmlFor={`place-new-${area.id}`}>{t('admin.areas.addPlace')}</label>
          <input id={`place-new-${area.id}`} type="text" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-sm" disabled={busy || name.trim().length < 2}><Icon name="plus" size={14} />{t('common.add')}</button>
      </form>
    </div>
  );
}

export default function Areas({ items }: { items: AreaRow[] }) {
  const { t } = useI18n();
  const { busy, error, notice, run } = useAdminAction();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
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
        {items.map((a) => {
          const activePlaces = a.localities.filter((l) => l.active).length;
          return (
            <li key={a.id} className={`area-item${a.active ? '' : ' inactive'}`}>
              <div className="area-head">
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
                    <span style={{ flex: 1 }}>
                      <strong>{a.name}</strong>
                      {!a.active && <span className="badge status-rejected" style={{ marginLeft: 8 }}>{t('admin.inactive')}</span>}
                      <span className="small muted" style={{ display: 'block' }}>
                        {t('admin.areas.places', { n: activePlaces })} · {a.code ? t('admin.areas.border') : t('admin.areas.noBorder')}
                      </span>
                    </span>
                    <button type="button" className="btn btn-sm btn-outline" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>
                      <Icon name={open === a.id ? 'chevronDown' : 'chevronRight'} size={14} />{t('admin.areas.placesButton')}
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setEditing(a.id); setEditName(a.name); }}><Icon name="edit" size={14} />{t('common.edit')}</button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run(() => call(updateNeighbourhoodAction(a.id, { active: !a.active })), t('detail.saved'))}>
                      {a.active ? t('admin.deactivate') : t('admin.activate')}
                    </button>
                  </>
                )}
              </div>
              {open === a.id && <Places area={a} busy={busy} run={run} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
