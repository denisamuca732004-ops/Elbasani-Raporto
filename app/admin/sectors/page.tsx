/**
 * /admin/sectors — "Departamentet" in the admin's menu: a card for every
 * sector (its reports, open, high priority, overdue). A card opens that
 * sector's reports. Admin only; department heads go to their own reports.
 */
import type { Metadata } from 'next';
import SectorsPage from '@/components/panel/SectorCards';
import { getT } from '@/i18n/server';
import { PANEL_INCLUDES_DEMO, pageAdmin } from '@/lib/server/pageData';
import { sectorRows, type SectorRow } from '@/lib/server/services/dashboard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.departments') };
}

export default async function Sectors() {
  const admin = await pageAdmin('/admin/sectors');
  let rows: SectorRow[] | null = null;
  try {
    rows = await sectorRows(admin, 'month', PANEL_INCLUDES_DEMO);
  } catch (err) {
    console.error('[sectors] failed', err);
  }
  return <SectorsPage rows={rows} />;
}
