import type { Metadata } from 'next';
import Integration from '@/components/admin/Integration';
import { getT } from '@/i18n/server';
import { config } from '@/lib/server/env';
import { pageAdmin } from '@/lib/server/pageData';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('admin.integration.title') };
}

export default async function IntegrationPage() {
  await pageAdmin('/admin/integration');
  return <Integration origin={config().appUrl} />;
}
