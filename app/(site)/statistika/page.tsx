import type { Metadata } from 'next';
import StatsPage from '@/components/public/StatsPage';
import { getT } from '@/i18n/server';
import { publicStats, type PublicStats } from '@/lib/server/services/stats';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('stats.title') };
}

export default async function StatsRoute() {
  let data: PublicStats | null;
  try {
    data = await publicStats();
  } catch (err) {
    console.error('[stats] unavailable', err);
    data = null;
  }
  return <StatsPage data={data} />;
}
