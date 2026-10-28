import type { Metadata } from 'next';
import Guide from '@/components/admin/Guide';
import { getT } from '@/i18n/server';
import { pageAdmin } from '@/lib/server/pageData';
import { listGuideEntries } from '@/lib/server/services/guide';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('admin.guide.title') };
}

export default async function GuidePage() {
  const admin = await pageAdmin('/admin/guide');
  return <Guide items={await listGuideEntries(admin)} />;
}
