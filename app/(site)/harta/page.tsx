import type { Metadata } from 'next';
import MapPage from '@/components/public/MapPage';
import { getT } from '@/i18n/server';
import { flatParams } from '@/lib/server/pageData';
import { mapPoints, unplacedReports } from '@/lib/server/services/publicReport';
import { MAP_STATUSES, type MapStatus } from '@/lib/shared/domain';
import type { MapPoint, PublicCard } from '@/lib/shared/types';
import { mapSchema } from '@/lib/validation/report';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('map.title') };
}

export default async function MapRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = flatParams(await searchParams);
  // Every public status is loaded; the status of the address (?status=in_progress) only chooses what the map shows first.
  const parsed = mapSchema.safeParse({ status: 'all', category: params.category });
  const query = parsed.success ? parsed.data : mapSchema.parse({ status: 'all' });
  const wanted = (params.status ?? '').toUpperCase();
  const status = (MAP_STATUSES as readonly string[]).includes(wanted) ? (wanted as MapStatus) : null;
  let points: MapPoint[] | null;
  let unplaced: PublicCard[] = [];
  try {
    [points, unplaced] = await Promise.all([mapPoints(query), unplacedReports(query)]);
  } catch (err) {
    console.error('[map] points unavailable', err);
    points = null;
  }
  return <MapPage points={points} unplaced={unplaced} status={status} category={query.category ?? ''} />;
}
