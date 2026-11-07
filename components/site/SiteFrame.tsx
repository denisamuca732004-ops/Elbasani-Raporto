'use client';
/**
 * Public site frame (design v2 by the mentors): the elbasani.gov.al strip, a white header with
 * the four pages and the language, a dark footer with contact, emergency numbers and the staff
 * login, the offline bar, and the help chat (the button at the bottom right, every page).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import Icon from '@/components/Icon';
import { useSettings, useViewer } from '@/components/providers';
import { useI18n } from '@/i18n';
import { flushQueue, pendingCount } from '@/lib/client/offlineQueue';
import { brandNames } from '@/lib/shared/branding';
import type { GuideItem } from '@/lib/shared/guide';
import ChatHelp from './ChatHelp';

/** The platform's and the municipality's names in the language chosen (EN / SQ). */
export function useBrandNames() {
  const { branding } = useSettings();
  const { lang } = useI18n();
  return brandNames(branding, lang);
}

export function Logo({ small }: { small?: boolean }) {
  const { branding } = useSettings();
  const names = useBrandNames();
  return (
    <span className={`logo-badge${small ? ' small' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the logo can be any URL the admin sets */}
      <img src={branding.logoUrl} alt={names.municipality} />
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

function NavLink({ href, icon, children }: { href: string; icon: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} size={20} />{children}
    </Link>
  );
}

/** The other language, by its own name ("English" / "Shqip"), with a globe. */
function LanguageButton() {
  const { lang, setLang, t } = useI18n();
  return (
    <button type="button" className="lang-button" onClick={() => setLang(lang === 'sq' ? 'en' : 'sq')} aria-label={t('nav.language')}>
      <Icon name="globe" size={20} /><span lang={lang === 'sq' ? 'en' : 'sq'}>{t('nav.otherLanguage')}</span>
    </button>
  );
}

/** A signed-in staff member gets a way back to the panel; the staff login itself is in the footer. */
function PanelLink() {
  const { t } = useI18n();
  const viewer = useViewer();
  if (viewer?.kind !== 'staff') return null;
  return <Link href="/admin" className="panel-link"><Icon name="dashboard" size={18} /><span>{t('nav.panel')}</span></Link>;
}

/** The pin in a green square: the platform's mark in the header (the coat of arms stays in the panel). */
function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><Icon name="pin" size={26} /></span>;
}

/**
 * The strip of elbasani.gov.al on top (the platform is one of the municipality's services), then
 * the white header: name, the four pages, the language.
 */
export function SiteHeader() {
  const { t } = useI18n();
  const names = useBrandNames();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  const links: Array<[string, string, string]> = [
    ['/raporto', 'pin', t('nav.report')],
    ['/harta', 'map', t('nav.map')],
    ['/ndiq', 'route', t('nav.trackShort')],
    ['/statistika', 'chart', t('nav.stats')],
  ];
  return (
    <header className="site-header">
      <div className="gov-strip">
        <div className="container">
          <a href="https://elbasani.gov.al" rel="noreferrer"><Icon name="chevronRight" size={14} className="flip" />elbasani.gov.al</a>
          <span aria-hidden="true">/</span>
          <span>{t('nav.services')}</span>
        </div>
      </div>
      <div className="container header-top">
        <Link href="/" className="brand" aria-label={names.app}>
          <BrandMark />
          <span className="brand-name">{names.app}<span className="brand-sub">{names.municipality}</span></span>
        </Link>
        <nav id="main-nav" className={`main-nav${open ? ' open' : ''}`} aria-label={t('nav.menu')}>
          <ul className="nav-links">
            {links.map(([to, icon, label]) => <li key={to}><NavLink href={to} icon={icon}>{label}</NavLink></li>)}
          </ul>
        </nav>
        <div className="header-actions">
          <PanelLink />
          <LanguageButton />
          <button type="button" className="menu-btn" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen(!open)}>
            <Icon name={open ? 'close' : 'menu'} size={26} /><span className="sr-only">{t('nav.menu')}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

const EMERGENCY: Array<['emergency' | 'police' | 'fire' | 'ambulance', string]> = [['emergency', '112'], ['police', '129'], ['fire', '128'], ['ambulance', '127']];
const CONTACT_EMAIL = 'bashkiaelbasan@elbasani.gov.al';

export function SiteFooter() {
  const { t } = useI18n();
  const names = useBrandNames();
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <section>
            <h2 className="footer-title"><Icon name="home" size={20} />{t('footer.aboutTitle')}</h2>
            <p>{t('footer.about')}</p>
          </section>
          <section>
            <h2 className="footer-title"><Icon name="mail" size={20} />{t('footer.contact')}</h2>
            <p><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
          </section>
          <section>
            <h2 className="footer-title"><Icon name="phone" size={20} />{t('footer.emergencyTitle')}</h2>
            <dl className="footer-numbers">
              {EMERGENCY.map(([k, n]) => (
                <div key={k}><dt>{t(`footer.numbers.${k}`)}</dt><dd><a href={`tel:${n}`}>{n}</a></dd></div>
              ))}
            </dl>
          </section>
          <section>
            <h2 className="footer-title"><Icon name="info" size={20} />{t('footer.info')}</h2>
            <ul>
              <li><Link href="/privatesia">{t('footer.privacyNotice')}</Link></li>
              <li><a href="https://elbasani.gov.al" rel="noreferrer">elbasani.gov.al</a></li>
              <li><Link href="/hyrje">{t('nav.staff')}</Link></li>
            </ul>
          </section>
        </div>
      </div>
      <div className="footer-bottom">
        <div className="container"><span>© {new Date().getFullYear()} {names.municipality}</span><span>{t('footer.emergency')}</span></div>
      </div>
    </footer>
  );
}

/** guide: the questions the help chat answers (empty on the "page not found" page: it still finds report numbers, problems and streets). */
export default function SiteFrame({ children, guide }: { children: ReactNode; guide?: GuideItem[] }) {
  const { t } = useI18n();
  // The help chat is for residents: not on a sector's report page (/sektori/…).
  const forResidents = !usePathname().startsWith('/sektori');
  return (
    <div className="site">
      <a href="#main" className="sr-only">{t('common.skip')}</a>
      <SiteHeader />
      <OfflineBar />
      <main id="main">{children}</main>
      <SiteFooter />
      {forResidents && <ChatHelp guide={guide ?? []} />}
    </div>
  );
}
