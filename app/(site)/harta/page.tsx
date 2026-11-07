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

/**
 * Every public report of the last 180 days is loaded once; the status, area and category of the
 * address (?status=in_progress&zone=3&category=streets) only choose what the page shows first, and
 * the filters then work in the browser.
 */
export default async function MapRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = flatParams(await searchParams);
  const query = mapSchema.parse({ status: 'all' });
  const wanted = (params.status ?? '').toUpperCase();
  const status = (MAP_STATUSES as readonly string[]).includes(wanted) ? (wanted as MapStatus) : null;
  const category = params.category && /^[a-z0-9_.-]{1,60}$/.test(params.category) ? params.category : '';
  const zone = /^\d{1,6}$/.test(params.zone ?? '') ? Number(params.zone) : null;
  let points: MapPoint[] | null;
  let unplaced: PublicCard[] = [];
  try {
    [points, unplaced] = await Promise.all([mapPoints(query), unplacedReports(query)]);
  } catch (err) {
    console.error('[map] points unavailable', err);
    points = null;
  }
  return <MapPage points={points} unplaced={unplaced} initial={{ status, category, zone }} />;
}
