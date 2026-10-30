/**
 * The municipal panel. proxy.ts already let only MUNICIPALITY_STAFF and ADMIN
 * sessions through; here the account is checked again against the database
 * (active, same session version, password not temporary).
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import PanelShell from '@/components/panel/PanelShell';
import { CatalogProvider } from '@/components/providers';
import { getT } from '@/i18n/server';
import { PANEL_INCLUDES_DEMO, pageCatalog, pageStaff } from '@/lib/server/pageData';
import { sidebarCounts, type SidebarCounts } from '@/lib/server/services/dashboard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: { default: t('auth.panel'), template: `%s · ${t('auth.panel')}` }, robots: { index: false, follow: false } };
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const principal = await pageStaff();
  const [catalog, counts] = await Promise.all([
    pageCatalog(),
    sidebarCounts(principal, PANEL_INCLUDES_DEMO).catch((err: unknown): SidebarCounts | null => {
      console.error('[panel] sidebar counts unavailable', err);
      return null;
    }),
  ]);
  return (
    <CatalogProvider catalog={catalog}>
      <PanelShell principal={principal} counts={counts}>{children}</PanelShell>
    </CatalogProvider>
  );
}
