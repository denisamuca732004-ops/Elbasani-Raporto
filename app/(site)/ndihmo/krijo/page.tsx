import type { Metadata } from 'next';
import ActionCreate from '@/components/public/ActionCreate';
import { getT } from '@/i18n/server';
import { getCommunitySettings } from '@/lib/server/services/community';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('community.form.title') };
}

export default async function CreateActionRoute() {
  return <ActionCreate settings={await getCommunitySettings()} />;
}
