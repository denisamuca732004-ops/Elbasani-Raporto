'use client';
/**
 * "Instalo aplikacionin": Elbasani Raporton on the phone's home screen, opening like an app
 * (the site is already an installable web app: app/manifest.ts + public/sw.js).
 *  - Android, Chrome, Edge, Samsung Internet: the browser's own install window (beforeinstallprompt).
 *  - iPhone / iPad: Apple has no install window, so a short guide: Share → Add to Home Screen.
 *  - Already opened as the app: nothing is shown.
 * Two places: a slim, dismissible bar on the home page, and an item in the menu (always there).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import Icon from '@/components/Icon';
import { useI18n } from '@/i18n';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// The browser may offer the install before React has started: the event is kept here.
let deferred: InstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

type Mode = 'prompt' | 'ios' | 'none';
function currentMode(): Mode {
  if (typeof window === 'undefined') return 'none';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone || installedNow) return 'none';
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  return ios ? 'ios' : 'none';
}

function useInstallMode(): Mode {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    currentMode,
    () => 'none',
  );
}

/** Opens the browser's install window, or the iPhone guide. */
function useInstall() {
  const mode = useInstallMode();
  const [guide, setGuide] = useState(false);
  async function install() {
    if (mode === 'ios') { setGuide(true); return; }
    if (!deferred) return;
    const e = deferred;
    await e.prompt();
    const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    deferred = null;
    if (outcome === 'accepted') installedNow = true;
    notify();
  }
  return { mode, install, guide, closeGuide: () => setGuide(false) };
}

function IosGuide({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="install-guide-backdrop" onClick={onClose}>
      <div className="install-guide" role="dialog" aria-modal="true" aria-labelledby="install-guide-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="install-guide-title">{t('install.iosTitle')}</h2>
        <ol>
          <li>{t('install.ios1')} <span className="install-share" aria-hidden="true"><Icon name="arrowUp" size={16} /></span></li>
          <li>{t('install.ios2')}</li>
          <li>{t('install.ios3')}</li>
        </ol>
        <p className="small muted">{t('install.iosNote')}</p>
        <button type="button" className="btn" onClick={onClose}>{t('install.ok')}</button>
      </div>
    </div>
  );
}

const DISMISS_KEY = 'er-install-dismissed';
const DISMISS_DAYS = 30;

/** The slim bar on the home page. Hidden for 30 days after "✕". */
export function InstallBar() {
  const { t } = useI18n();
  const { mode, install, guide, closeGuide } = useInstall();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      setDismissed(Date.now() - at < DISMISS_DAYS * 86_400_000);
    } catch {
      setDismissed(false);
    }
  }, []);
  if (mode === 'none' || dismissed) return guide ? <IosGuide onClose={closeGuide} /> : null;
  return (
    <>
      <div className="install-bar" role="region" aria-label={t('install.button')}>
        <div className="container install-bar-inner">
          <span className="install-bar-icon" aria-hidden="true"><Icon name="download" size={20} /></span>
          <span className="install-bar-text"><strong>{t('install.title')}</strong><span>{t('install.text')}</span></span>
          <button type="button" className="btn btn-sm" onClick={() => void install()}>
            <span className="install-long">{t('install.button')}</span><span className="install-short">{t('install.short')}</span>
          </button>
          <button
            type="button" className="install-bar-close" aria-label={t('common.close')}
            onClick={() => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* not kept */ } }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
      {guide && <IosGuide onClose={closeGuide} />}
    </>
  );
}

/** "Instalo aplikacionin" in the menu (shown wherever the phone can install it). */
export function InstallMenuItem() {
  const { t } = useI18n();
  const { mode, install, guide, closeGuide } = useInstall();
  if (mode === 'none') return null;
  return (
    <>
      <li className="nav-install">
        <button type="button" className="nav-install-btn" onClick={() => void install()}>
          <Icon name="download" size={20} />{t('install.button')}
        </button>
        {guide && <IosGuide onClose={closeGuide} />}
      </li>
    </>
  );
}
