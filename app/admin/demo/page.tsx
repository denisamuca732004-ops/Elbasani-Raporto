import type { Metadata } from 'next';
import Demo from '@/components/admin/Demo';
import { getT } from '@/i18n/server';
import { pageAdmin } from '@/lib/server/pageData';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.demo') };
}

export default async function DemoPage() {
  await pageAdmin('/admin/demo');
  return <Demo />;
}
