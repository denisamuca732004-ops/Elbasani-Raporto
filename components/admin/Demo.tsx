'use client';
/** Admin: sample data for presentations and training, and the daily job. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteDemoDataAction, loadDemoDataAction, runDailyJobAction } from '@/actions/admin';
import { ErrorAlert, SuccessAlert } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';

export default function Demo() {
  const { t } = useI18n();
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(name: string, fn: () => Promise<string>) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      router.refresh();
    } catch (err) {
      setError(err as ActionFailure);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <h1>{t('panel.nav.demo')}</h1>
      <SuccessAlert>{notice}</SuccessAlert>
      <ErrorAlert error={error} />
      <section className="card stack">
        <h2 className="card-title">{t('admin.demo.sampleTitle')}</h2>
        <p className="muted">{t('admin.demo.sampleText')}</p>
        <div className="row">
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => run('load', async () => {
            const r = await call(loadDemoDataAction());
            return t('admin.demo.loaded', { n: r.created, t: r.pendingTransfers });
          })}>{busy === 'load' ? t('common.wait') : t('admin.demo.load')}</button>
          <button type="button" className="btn btn-outline" disabled={Boolean(busy)} onClick={() => {
            if (!window.confirm(t('admin.demo.confirmDelete'))) return;
            void run('delete', async () => {
              const r = await call(deleteDemoDataAction());
              return t('admin.demo.deleted', { n: r.deleted });
            });
          }}>{busy === 'delete' ? t('common.wait') : t('admin.demo.delete')}</button>
        </div>
      </section>
      <section className="card stack">
        <h2 className="card-title">{t('admin.demo.dailyTitle')}</h2>
        <p className="muted">{t('admin.demo.dailyText')}</p>
        <div>
          <button type="button" className="btn btn-outline" disabled={Boolean(busy)} onClick={() => run('daily', async () => {
            const r = await call(runDailyJobAction());
            return t('admin.demo.dailyDone', { closed: r.closed, sent: r.sent });
          })}>{busy === 'daily' ? t('common.wait') : t('admin.demo.runDaily')}</button>
        </div>
      </section>
    </div>
  );
}
