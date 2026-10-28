import type { Metadata } from 'next';
import NewReport from '@/components/panel/NewReport';
import { getT } from '@/i18n/server';
import { pageAdmin } from '@/lib/server/pageData';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.newReport') };
}

/** Admin only (a department head is sent back to the dashboard; the action checks the role again). */
export default async function NewReportPage() {
  await pageAdmin('/admin/reports/new');
  return <NewReport />;
}
