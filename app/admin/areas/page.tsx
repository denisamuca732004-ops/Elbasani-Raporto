import type { Metadata } from 'next';
import Areas from '@/components/admin/Areas';
import { getT } from '@/i18n/server';
import { pageAdmin } from '@/lib/server/pageData';
import { listNeighbourhoods } from '@/lib/server/services/admin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.areas') };
}

export default async function AreasPage() {
  const admin = await pageAdmin('/admin/areas');
  const rows = await listNeighbourhoods(admin);
  return <Areas items={rows.map((a) => ({ id: a.id, name: a.name, sortOrder: a.sortOrder, active: a.active }))} />;
}
