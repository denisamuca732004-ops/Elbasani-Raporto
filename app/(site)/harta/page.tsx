import type { Metadata } from 'next';
import MapPage from '@/components/public/MapPage';
import { getT } from '@/i18n/server';
import { flatParams } from '@/lib/server/pageData';
import { mapPoints, unplacedReports } from '@/lib/server/services/publicReport';
import type { MapPoint, PublicCard } from '@/lib/shared/types';
import { mapSchema } from '@/lib/validation/report';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('map.title') };
}

export default async function MapRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = flatParams(await searchParams);
  const parsed = mapSchema.safeParse({ status: params.status ?? 'open', category: params.category });
  const query = parsed.success ? parsed.data : mapSchema.parse({ status: 'open' });
  let points: MapPoint[] | null;
  let unplaced: PublicCard[] = [];
  try {
    [points, unplaced] = await Promise.all([mapPoints(query), unplacedReports(query)]);
  } catch (err) {
    console.error('[map] points unavailable', err);
    points = null;
  }
  return <MapPage points={points} unplaced={unplaced} status={query.status} category={query.category ?? ''} />;
}
