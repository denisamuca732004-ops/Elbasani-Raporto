import type { Metadata } from 'next';
import HelpPage from '@/components/public/Guide';
import { getT } from '@/i18n/server';
import { getGuide } from '@/lib/server/services/guide';
import type { GuideItem } from '@/lib/shared/guide';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('guide.title') };
}

export default async function Help() {
  let items: GuideItem[] | null;
  try {
    items = await getGuide();
  } catch (err) {
    console.error('[help] guide unavailable', err);
    items = null;
  }
  return <HelpPage items={items} />;
}
