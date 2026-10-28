'use client';
/** Compact widget for the municipality website (iframe): report + track, no header/footer. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/site/SiteFrame';
import { useSettings } from '@/components/providers';
import { useI18n } from '@/i18n';

export default function EmbedFrame({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const { branding } = useSettings();
  const pathname = usePathname();
  const tracking = pathname.startsWith('/embed/ndiq');
  return (
    <div className="embed-body">
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="row"><Logo small /><strong className="head" style={{ margin: 0 }}>{branding.appName}</strong></div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLang(lang === 'sq' ? 'en' : 'sq')} aria-label={t('nav.language')}>{lang === 'sq' ? 'EN' : 'SQ'}</button>
      </div>
      <div className="tabs">
        <Link href="/embed" className={`tab${!tracking ? ' active' : ''}`} aria-current={!tracking ? 'page' : undefined}>{t('nav.report')}</Link>
        <Link href="/embed/ndiq" className={`tab${tracking ? ' active' : ''}`} aria-current={tracking ? 'page' : undefined}>{t('nav.track')}</Link>
      </div>
      {children}
    </div>
  );
}
