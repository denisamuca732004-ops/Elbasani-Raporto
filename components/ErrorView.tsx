'use client';
/** Shown by the error boundaries when a page fails unexpectedly (the details stay in the server log). */
import { useEffect } from 'react';
import Icon from '@/components/Icon';
import { useI18n } from '@/i18n';

export default function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="page">
      <div className="container">
        <div className="done-box" role="alert">
          <Icon name="alert" size={44} />
          <h1 style={{ fontSize: '1.4rem' }}>{t('errors.generic')}</h1>
          {error.digest && <p className="small muted">ref: {error.digest}</p>}
          <button type="button" className="btn" onClick={reset}>{t('common.retry')}</button>
        </div>
      </div>
    </div>
  );
}
