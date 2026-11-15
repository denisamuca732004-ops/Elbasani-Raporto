import type { Metadata } from 'next';
import CommunityHome from '@/components/public/CommunityHome';
import { getT } from '@/i18n/server';
import { getCommunitySettings, listPublicActions } from '@/lib/server/services/community';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('community.title'), description: t('community.lead') };
}

export default async function CommunityRoute() {
  const [settings, lists] = await Promise.all([
    getCommunitySettings(),
    listPublicActions().catch((err) => {
      console.error('[community] list unavailable', err);
      return { upcoming: [], done: [] };
    }),
  ]);
  return <CommunityHome upcoming={lists.upcoming} done={lists.done} settings={settings} />;
}
