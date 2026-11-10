'use client';
/**
 * "Propozo me AI" under a note for the resident (lib/server/services/noteDraft.ts):
 * empty field → a proposed text; a few words in it → the same, written clearly and politely.
 * The text only lands in the field: the person reads it, changes it and sends it.
 */
import { useState } from 'react';
import { draftNoteAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';

export default function DraftButton({ reportId, kind, value, onDraft }: {
  reportId: string; kind: 'resolve' | 'reject' | 'message'; value: string; onDraft: (text: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const { text } = await call(draftNoteAction(reportId, { kind, notes: value }));
      onDraft(text);
    } catch (err) {
      setError(err instanceof ActionFailure ? err.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="draft-row">
      <button type="button" className="btn btn-sm btn-ghost draft-btn" onClick={draft} disabled={busy}>
        <Icon name="sparkle" size={15} />{busy ? t('detail.draft.busy') : value.trim() ? t('detail.draft.improve') : t('detail.draft.propose')}
      </button>
      {error ? <span className="small" role="alert" style={{ color: '#A61D12' }}>{error}</span> : <span className="small muted">{t('detail.draft.hint')}</span>}
    </div>
  );
}
