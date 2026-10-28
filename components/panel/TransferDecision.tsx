'use client';
/** Admin: decide on a "not our department" review request — move the report, or keep it with an explanation. */
import { useState } from 'react';
import { decideTransferAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { useCatalog } from '@/components/providers';
import { ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { departmentName } from '@/lib/client/format';
import type { TransferListItem, TransferSummary } from '@/lib/shared/types';

export default function TransferDecision({ transfer, currentDepartmentId, onDone }: {
  transfer: TransferSummary;
  currentDepartmentId: number | null | undefined;
  onDone?: (result: TransferListItem, decision: 'approve' | 'decline') => void;
}) {
  const { t, lang } = useI18n();
  const { departments } = useCatalog();
  const [toDepartmentId, setToDepartmentId] = useState(transfer.suggestedDepartment?.id ? String(transfer.suggestedDepartment.id) : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<{ message: string; code?: string; details?: unknown } | null>(null);
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [declining, setDeclining] = useState(false);
  const options = departments.filter((s) => s.id !== currentDepartmentId);

  async function decide(decision: 'approve' | 'decline') {
    if (decision === 'decline' && note.trim().length < 3) {
      setError({ message: t('transfers.declineNoteRequired') });
      return;
    }
    if (decision === 'approve' && !toDepartmentId) {
      setError({ message: t('transfers.chooseSector') });
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      const result = await call(decideTransferAction(transfer.id, decision === 'approve'
        ? { decision, toDepartmentId: Number(toDepartmentId), ...(note.trim() ? { note: note.trim() } : {}) }
        : { decision, note: note.trim() }));
      onDone?.(result, decision);
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="transfer-decision">
      {!declining ? (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label={t('transfers.moveTo')} htmlFor={`td-sector-${transfer.id}`}>
            <select id={`td-sector-${transfer.id}`} value={toDepartmentId} onChange={(e) => setToDepartmentId(e.target.value)}>
              <option value="">{t('transfers.chooseSector')}</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {departmentName(s, lang)}{transfer.suggestedDepartment?.id === s.id ? ` (${t('transfers.suggested')})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="row" style={{ marginBottom: 16 }}>
            <button type="button" className="btn btn-sm" disabled={Boolean(busy)} onClick={() => decide('approve')}>
              <Icon name="check" size={16} />{busy === 'approve' ? t('common.wait') : t('transfers.approve')}
            </button>
            <button type="button" className="btn btn-sm btn-outline" disabled={Boolean(busy)} onClick={() => { setDeclining(true); setError(null); }}>
              {t('transfers.decline')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <Field label={t('transfers.declineNote')} hint={t('transfers.declineHint')} htmlFor={`td-note-${transfer.id}`} required>
            <textarea id={`td-note-${transfer.id}`} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="row">
            <button type="button" className="btn btn-sm btn-danger" disabled={Boolean(busy)} onClick={() => decide('decline')}>
              {busy === 'decline' ? t('common.wait') : t('transfers.confirmDecline')}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setDeclining(false); setError(null); }}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
      <ErrorAlert error={error} />
    </div>
  );
}
