'use client';
/** Link from the "resolved" email: the resident confirms the fix or reopens it, and rates the service. */
import Link from 'next/link';
import { useState } from 'react';
import { submitFeedbackAction } from '@/actions/reports';
import Icon from '@/components/Icon';
import { ErrorAlert, Field } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { typeName } from '@/lib/client/format';
import type { PublicCase } from '@/lib/shared/types';

export default function Feedback({ token, info }: { token: string; info: PublicCase | null }) {
  const { t, lang } = useI18n();
  const [error, setError] = useState<ActionFailure | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState<{ action: 'confirm' | 'reopen'; caseNumber: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(action: 'confirm' | 'reopen') {
    setBusy(true);
    setError(null);
    try {
      const res = await call(submitFeedbackAction({ token, action, ...(rating ? { rating } : {}), ...(comment.trim() ? { comment } : {}) }));
      setDone({ action, caseNumber: res.caseNumber });
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 720 }}>
        <h1>{t('feedback.title')}</h1>
        {!info || error?.status === 404 ? <div className="alert alert-warn">{t('feedback.invalid')}</div> : <ErrorAlert error={error} />}
        {done && (
          <div className="done-box">
            <Icon name="check" size={44} />
            <h2>{done.action === 'confirm' ? t('feedback.thanksClosed') : t('feedback.thanksReopened')}</h2>
            <Link className="btn" href={`/ndiq/${done.caseNumber}`}>{t('report.trackIt')}</Link>
          </div>
        )}
        {info && !done && error?.status !== 404 && (
          <div className="stack">
            <p><span className="case-number">{info.caseNumber}</span> · {typeName(info.type, lang)}</p>
            {info.closingNote && <div className="alert alert-ok">{info.closingNote}</div>}
            {/* eslint-disable-next-line @next/next/no-img-element -- protected photo route */}
            {info.afterPhotoUrl && <img src={info.afterPhotoUrl} alt={t('track.after')} style={{ maxWidth: 420, borderRadius: 4 }} />}
            <h2>{t('feedback.question')}</h2>
            <div className="field">
              <span className="label">{t('feedback.rating')}</span>
              <div className="row" role="radiogroup" aria-label={t('feedback.rating')}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={rating === n} className={`btn btn-sm ${rating >= n ? '' : 'btn-outline'}`} onClick={() => setRating(n)}>{n}</button>
                ))}
              </div>
            </div>
            <Field label={t('feedback.comment')} htmlFor="fb-comment">
              <textarea id="fb-comment" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <div className="row">
              <button type="button" className="btn btn-lg" disabled={busy} onClick={() => send('confirm')}><Icon name="check" size={20} />{t('feedback.confirm')}</button>
              <button type="button" className="btn btn-lg btn-outline" disabled={busy} onClick={() => send('reopen')}>{t('feedback.reopen')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
