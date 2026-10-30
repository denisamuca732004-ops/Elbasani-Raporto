'use client';
/**
 * Frame of the municipal panel with the menu on the left. One panel for both
 * roles: the admin sees every department and the administration pages; a
 * department head sees only their own department's reports and requests.
 * (The menu only hides links; every page and action checks the role on the server.)
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { logoutAction } from '@/actions/auth';
import { setIncludeTestAction } from '@/actions/panel';
import Icon from '@/components/Icon';
import { useSettings } from '@/components/providers';
import { LanguageToggle, Logo } from '@/components/site/SiteFrame';
import { useI18n } from '@/i18n';
import type { SidebarCounts } from '@/lib/server/services/dashboard';
import type { Principal } from '@/lib/shared/types';

interface NavItemProps {
  href: string; icon: string; label: string; exact?: boolean; badge?: number; badgeTone?: string; badgeLabel?: string; high?: number;
}

function Badge({ value, tone, label }: { value?: number; tone?: string; label?: string }) {
  if (!value) return null;
  return <span className={`nav-badge${tone ? ` ${tone}` : ''}`}>{value}{label && <span className="sr-only"> {label}</span>}</span>;
}

/** Active when the path matches and every query value of the link is in the address (e.g. ?departmentId=3). */
function useIsActive(href: string, exact?: boolean): boolean {
  const pathname = usePathname();
  const params = useSearchParams();
  const url = new URL(href, 'http://x');
  const pathMatches = exact || url.search ? pathname === url.pathname : pathname === url.pathname || pathname.startsWith(`${url.pathname}/`);
  if (!pathMatches) return false;
  const wanted = [...url.searchParams.entries()];
  if (wanted.length) return wanted.every(([k, v]) => params.get(k) === v);
  // The plain "all reports" link is not active while a department is filtered from the menu.
  if (url.pathname === '/admin/reports' && (params.get('departmentId') || params.get('unrouted'))) return false;
  return true;
}

function NavItem({ href, icon, label, exact, badge, badgeTone, badgeLabel, high }: NavItemProps) {
  const { t } = useI18n();
  const active = useIsActive(href, exact);
  return (
    <li>
      <Link href={href} title={label} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
        {icon && <Icon name={icon} size={18} />}
        <span className="nav-label">{label}</span>
        {(high ?? 0) > 0 && (
          <span className="nav-badge high" title={t('panel.highOpen', { n: high })}>
            <Icon name="arrowUp" size={11} strokeWidth={3} />{high}<span className="sr-only"> {t('panel.highShort')}</span>
          </span>
        )}
        <Badge value={badge} tone={badgeTone} label={badgeLabel ?? t('panel.openShort')} />
      </Link>
    </li>
  );
}

function navGroups(principal: Principal, counts: SidebarCounts | null, t: (k: string) => string, lang: string) {
  if (principal.role === 'ADMIN') {
    return [
      { items: [{ href: '/admin', icon: 'dashboard', label: t('panel.nav.dashboard'), exact: true }] },
      {
        title: t('panel.nav.reports'),
        items: [
          { href: '/admin/reports', icon: 'inbox', label: t('panel.nav.allReports'), badge: counts?.openTotal, high: counts?.highTotal },
          ...(counts?.departments ?? []).map((d) => ({
            href: `/admin/reports?departmentId=${d.id}`, icon: 'layers', label: lang === 'en' ? d.nameEn : d.nameSq, badge: d.open, high: d.high,
          })),
          ...(counts?.unrouted ? [{ href: '/admin/reports?unrouted=1', icon: 'alert', label: t('panel.nav.unrouted'), badge: counts.unrouted, badgeTone: 'alert' }] : []),
        ],
      },
      {
        items: [
          { href: '/admin/transfers', icon: 'transfer', label: t('panel.nav.reviews'), badge: counts?.pendingTransfers, badgeTone: 'alert', badgeLabel: t('panel.pendingShort') },
        ],
      },
      {
        title: t('panel.nav.administration'),
        items: [
          // Sectors, accounts, report types, the search guide and the appearance are not in the
          // menu (kept simple for daily work). Their pages still work: the "first steps" card of
          // the dashboard links to them, and they open at their address (/admin/users…).
          { href: '/admin/areas', icon: 'map', label: t('panel.nav.areas') },
          { href: '/admin/emails', icon: 'mail', label: t('panel.nav.emails') },
          { href: '/admin/integration', icon: 'code', label: t('panel.nav.integration') },
          { href: '/admin/demo', icon: 'sparkle', label: t('panel.nav.demo') },
        ],
      },
      { items: [{ href: '/admin/account', icon: 'user', label: t('panel.nav.account') }] },
    ];
  }
  return [
    { items: [{ href: '/admin', icon: 'dashboard', label: t('panel.nav.dashboard'), exact: true }] },
    {
      title: t('panel.nav.reports'),
      items: [
        { href: '/admin/reports', icon: 'inbox', label: t('panel.nav.sectorReports'), badge: counts?.openTotal, high: counts?.highTotal },
        { href: '/admin/transfers', icon: 'transfer', label: t('panel.nav.sectorReviews'), badge: counts?.pendingTransfers, badgeLabel: t('panel.pendingShort') },
      ],
    },
    { items: [{ href: '/admin/account', icon: 'user', label: t('panel.nav.account') }] },
  ];
}

export default function PanelShell({ principal, counts, includeTest, children }: {
  principal: Principal; counts: SidebarCounts | null; includeTest: boolean; children: ReactNode;
}) {
  const { t, lang } = useI18n();
  const { branding } = useSettings();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [switching, startSwitch] = useTransition();
  // The switch answers at once; the server data follows with the refresh.
  const [showDemo, setShowDemo] = useState(includeTest);
  useEffect(() => setShowDemo(includeTest), [includeTest]);
  const admin = principal.role === 'ADMIN';
  const groups = navGroups(principal, counts, t, lang);
  const departmentName = lang === 'en' ? principal.departmentNameEn : principal.departmentNameSq;

  useEffect(() => setOpen(false), [pathname, params]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  // Menu counters stay fresh while the panel is open.
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 120_000);
    return () => clearInterval(timer);
  }, [router]);

  async function logout() {
    await logoutAction();
    router.replace('/hyrje');
    router.refresh();
  }

  function toggleDemo(value: boolean) {
    setShowDemo(value);
    startSwitch(async () => {
      await setIncludeTestAction(value);
      router.refresh();
    });
  }

  return (
    <div className="panel-shell">
      <a href="#panel-main" className="sr-only">{t('common.skip')}</a>
      <header className="panel-header">
        <button type="button" className="menu-btn panel-menu-btn" aria-expanded={open} aria-controls="panel-sidebar" onClick={() => setOpen(!open)}>
          <Icon name={open ? 'close' : 'menu'} size={26} /><span className="sr-only">{t('nav.menu')}</span>
        </button>
        <Link href="/admin" className="brand">
          <Logo small />
          <span className="brand-name">
            {admin ? t('panel.adminTitle') : t('panel.sectorTitle')}
            <span className="brand-sub">{admin ? branding.municipalityName : departmentName}</span>
          </span>
        </Link>
        <div className="header-actions">
          <Link href="/admin/account" className="user-chip" title={principal.email}>
            <Icon name="user" size={16} /><span>{principal.name}</span>
          </Link>
          <LanguageToggle />
          <button type="button" className="lang-toggle" onClick={logout} title={t('panel.logout')} aria-label={t('panel.logout')}><Icon name="logout" size={16} /></button>
        </div>
      </header>
      <div className="panel-body">
        <aside id="panel-sidebar" className={`panel-sidebar${open ? ' open' : ''}`} aria-label={t('panel.menu')}>
          <nav>
            {groups.map((g, i) => (
              <div className="nav-group" key={g.title ?? i}>
                {g.title && <div className="nav-group-title">{g.title}</div>}
                <ul>{g.items.map((item) => <NavItem key={item.href} {...item} />)}</ul>
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <label className="check small">
              <input type="checkbox" checked={showDemo} disabled={switching} onChange={(e) => toggleDemo(e.target.checked)} />
              <span>{t('panel.includeTest')}</span>
            </label>
            <a href="/" target="_blank" rel="noreferrer" className="small"><Icon name="external" size={14} /> {t('panel.publicSite')}</a>
          </div>
        </aside>
        {open && <button type="button" className="sidebar-backdrop" aria-label={t('common.close')} onClick={() => setOpen(false)} />}
        <main className="panel-main" id="panel-main">
          {includeTest && <div className="demo-banner" role="status"><Icon name="sparkle" size={16} />{t('panel.demoShown')}</div>}
          {children}
        </main>
      </div>
    </div>
  );
}
