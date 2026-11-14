'use client';
/**
 * "Më njofto për këtë raportim": free notifications on this phone (lib/server/services/push.ts),
 * after the report was sent (its "done" screen, with the form's clientRef) or later on the report's
 * page with its number. On an iPhone, Safari can receive them only from the icon on the home screen:
 * there it explains how, and the same button works once the site is opened from that icon.
 */
import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { useSettings } from '@/components/providers';
import { InstallGuideButton } from '@/components/site/InstallApp';
import { useI18n } from '@/i18n';
import { askPushPermission, pushSupport, subscribeToReport } from '@/lib/client/push';

const KEY = (n: string) => `er-push-${n}`;

export default function NotifyMe({ caseNumber, clientRef }: { caseNumber: string; clientRef?: string }) {
  const { t, lang } = useI18n();
  const { rules } = useSettings();
  const [support, setSupport] = useState<'yes' | 'ios-install' | 'no'>('no');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'denied' | 'error'>('idle');
  useEffect(() => {
    setSupport(pushSupport());
    try { if (localStorage.getItem(KEY(caseNumber)) && Notification.permission === 'granted') setState('done'); } catch { /* not kept */ }
  }, [caseNumber]);
  if (!rules.pushKey || support === 'no') return null;

  async function turnOn() {
    setState('busy');
    if (!(await askPushPermission())) { setState('denied'); return; }
    const ok = await subscribeToReport({ caseNumber, clientRef, key: rules.pushKey!, lang: lang === 'en' ? 'en' : 'sq' });
    if (ok) { try { localStorage.setItem(KEY(caseNumber), '1'); } catch { /* not kept */ } }
    setState(ok ? 'done' : 'error');
  }

  return (
    <div className="notify-card">
      <span className="notify-card-icon" aria-hidden="true"><Icon name="bell" size={22} /></span>
      <div>
        <strong>{t('report.notify.cardTitle')}</strong>
        {support === 'ios-install' ? (
          <>
            <p>{t('report.notify.iosSteps', { n: caseNumber })}</p>
            <InstallGuideButton label={t('report.notify.iosButton')} />
          </>
        ) : state === 'done' ? (
          <p className="notify-ok"><Icon name="check" size={16} /> {t('report.notify.done')}</p>
        ) : (
          <>
            <p>{state === 'denied' ? t('report.notify.denied') : state === 'error' ? t('report.notify.error') : t('report.notify.hint')}</p>
            <button type="button" className="btn btn-sm" disabled={state === 'busy'} onClick={() => void turnOn()}>
              <Icon name="bell" size={16} />{t('report.notify.button')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
