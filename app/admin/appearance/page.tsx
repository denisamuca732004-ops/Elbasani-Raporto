import type { Metadata } from 'next';
import Appearance from '@/components/admin/Appearance';
import { getT } from '@/i18n/server';
import { pageAdmin } from '@/lib/server/pageData';
import { readSettings } from '@/lib/server/services/admin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.appearance') };
}

export default async function AppearancePage() {
  const admin = await pageAdmin('/admin/appearance');
  return <Appearance settings={await readSettings(admin)} />;
}
