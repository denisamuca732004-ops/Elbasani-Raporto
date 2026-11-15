import type { Metadata } from 'next';
import CommunityAdmin from '@/components/admin/CommunityAdmin';
import { getT } from '@/i18n/server';
import { pageAdmin } from '@/lib/server/pageData';
import { getCommunitySettings, listAdminActions } from '@/lib/server/services/community';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.community') };
}

export default async function CommunityAdminPage() {
  const admin = await pageAdmin('/admin/community');
  const [lists, settings] = await Promise.all([listAdminActions(admin), getCommunitySettings()]);
  return <CommunityAdmin waiting={lists.waiting} others={lists.others} settings={settings} />;
}
