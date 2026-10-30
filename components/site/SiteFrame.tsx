'use client';
/**
 * Public site frame: green header like elbasani.gov.al (menu on the left, the
 * search box on the right, on every page), dark green footer, offline bar.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import Icon from '@/components/Icon';
import { useSettings, useViewer } from '@/components/providers';
import { useI18n } from '@/i18n';
import { flushQueue, pendingCount } from '@/lib/client/offlineQueue';
import type { GuideItem } from '@/lib/shared/guide';
import SiteSearch from './SiteSearch';

export function Logo({ small }: { small?: boolean }) {
  const { branding } = useSettings();
  return (
    <span className={`logo-badge${small ? ' small' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the logo can be any URL the admin sets */}
      <img src={branding.logoUrl} alt={branding.municipalityName} />
    </span>
  );
}

export function LanguageToggle({ className = 'lang-toggle' }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <button type="button" className={className} onClick={() => setLang(lang === 'sq' ? 'en' : 'sq')} aria-label={t('nav.language')}>
      {lang === 'sq' ? 'EN' : 'SQ'}
    </button>
  );
}

function OfflineBar() {
  const { t } = useI18n();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => pendingCount().then(setPending).catch(() => {});
    const goOnline = async () => {
      setOnline(true);
      const sent = await flushQueue();
      if (sent.length) setSentMsg(t('offline.sent', { list: sent.join(', ') }));
      void refresh();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('er-queue-changed', refresh);
    if (navigator.onLine) void goOnline(); else { setOnline(false); void refresh(); }
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('er-queue-changed', refresh);
    };
  }, [t]);
  if (sentMsg) return <div className="offline-bar" role="status">{sentMsg} <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSentMsg(null)} aria-label={t('common.close')}>×</button></div>;
  if (!online) return <div className="offline-bar" role="status">{t('offline.bar')}{pending ? ` ${t('offline.pending', { n: pending })}` : ''}</div>;
  if (pending) return <div className="offline-bar" role="status">{t('offline.pending', { n: pending })}</div>;
  return null;
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return <Link href={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>{children}</Link>;
}

/** Signed in: the resident's first name (their account) or "Panel" for staff. Otherwise "Sign in". */
function AccountLink() {
  const { t } = useI18n();
  const viewer = useViewer();
  if (viewer?.kind === 'staff') return <Link href="/admin" className="account-link"><Icon name="dashboard" size={16} /><span>{t('nav.panel')}</span></Link>;
  if (viewer?.kind === 'resident') {
    const first = viewer.name.split(' ')[0] || viewer.name;
    return <Link href="/llogaria" className="account-link" title={viewer.email}><Icon name="user" size={16} /><span>{first}</span></Link>;
  }
  return <Link href="/llogaria/hyr" className="account-link"><Icon name="user" size={16} /><span>{t('nav.signIn')}</span></Link>;
}

export function SiteHeader({ guide = [] }: { guide?: GuideItem[] }) {
  const { t } = useI18n();
  const { branding } = useSettings();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  const links: Array<[string, string]> = [
    ['/raporto', t('nav.report')],
    ['/harta', t('nav.map')],
    ['/statistika', t('nav.stats')],
  ];
  return (
    <header className="site-header">
      <div className="container header-top">
        <Link href="/" className="brand" aria-label={branding.appName}>
          <Logo />
          <span className="brand-name">{branding.appName}<span className="brand-sub">{branding.municipalityName}</span></span>
        </Link>
        <div className="header-actions">
          <AccountLink />
          <LanguageToggle />
          <button type="button" className="menu-btn" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}>
            <Icon name={open ? 'close' : 'menu'} size={28} /><span className="sr-only">{t('nav.menu')}</span>
          </button>
        </div>
      </div>
      <nav id="main-nav" className={`main-nav${open ? ' open' : ''}`} aria-label={t('nav.menu')}>
        <div className="container nav-row">
          <ul className="nav-links">
            {links.map(([to, label]) => <li key={to}><NavLink href={to}>{label}</NavLink></li>)}
            {open && <li><NavLink href="/hyrje">{t('nav.staff')}</NavLink></li>}
          </ul>
          <SiteSearch guide={guide} />
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const { t } = useI18n();
  const { branding } = useSettings();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="row"><Logo small /><strong className="head" style={{ color: '#fff', margin: 0 }}>{branding.municipalityName}</strong></div>
            <p className="small" style={{ marginTop: 12 }}>{t('footer.about')}</p>
          </div>
          <div>
            <h4>{t('footer.services')}</h4>
            <ul>
              <li><Link href="/raporto">{t('nav.report')}</Link></li>
              <li><Link href="/harta">{t('nav.map')}</Link></li>
              <li><Link href="/statistika">{t('nav.stats')}</Link></li>
            </ul>
          </div>
          <div>
            <h4>{t('footer.info')}</h4>
            <ul>
              <li><Link href="/privatesia">{t('nav.privacy')}</Link></li>
              <li><Link href="/hyrje">{t('nav.staff')}</Link></li>
              <li><a href="https://elbasani.gov.al" target="_blank" rel="noreferrer">elbasani.gov.al</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {branding.municipalityName}</span>
          <span>{t('footer.emergency')}</span>
        </div>
      </div>
    </footer>
  );
}

/** guide: the questions the search box answers (empty on the "page not found" page: it still finds report numbers, problems and streets). */
export default function SiteFrame({ children, guide }: { children: ReactNode; guide?: GuideItem[] }) {
  const { t } = useI18n();
  return (
    <>
      <a href="#main" className="sr-only">{t('common.skip')}</a>
      <SiteHeader guide={guide} />
      <OfflineBar />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
