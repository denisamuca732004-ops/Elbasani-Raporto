import type { Metadata } from 'next';
import Integration from '@/components/admin/Integration';
import { getT } from '@/i18n/server';
import { aiSettingsSummary, aiUsageThisMonth } from '@/lib/server/ai';
import { config } from '@/lib/server/env';
import { pageAdmin } from '@/lib/server/pageData';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('admin.integration.title') };
}

export default async function IntegrationPage() {
  await pageAdmin('/admin/integration');
  const { calls, costUsd, budgetUsd, reached } = await aiUsageThisMonth();
  return <Integration origin={config().appUrl} ai={aiSettingsSummary()} usage={{ calls, costUsd, budgetUsd, reached }} />;
}
