import Home, { type HomeNumbers } from '@/components/public/Home';
import { frequentTypes, mapPoints, recentlyFixed } from '@/lib/server/services/publicReport';
import { publicStats } from '@/lib/server/services/stats';
import type { FixedReport, MapPoint } from '@/lib/shared/types';
import { mapSchema } from '@/lib/validation/report';

/** Each part of the home page fails on its own: the page still opens without it. */
function orElse<T>(what: string, fallback: T) {
  return (err: unknown): T => {
    console.error(`[home] ${what} unavailable`, err);
    return fallback;
  };
}

export default async function HomePage() {
  const [stats, fixed, points, frequent] = await Promise.all([
    publicStats().catch(orElse('statistics', null)),
    recentlyFixed(3).catch(orElse('recently fixed', [] as FixedReport[])),
    // The dots on the city map of the first screen: the last 3 months, exact points only.
    mapPoints(mapSchema.parse({ status: 'all', days: 90 }))
      .then((all) => all.filter((p) => !p.approximate))
      .catch(orElse('map points', [] as MapPoint[])),
    frequentTypes().catch(orElse('frequent types', [] as Array<{ id: number; count: number }>)),
  ]);
  const thisMonth = stats?.months.at(-1);
  const numbers: HomeNumbers | null = stats && {
    month: thisMonth?.month ?? null,
    fixedThisMonth: thisMonth?.resolved ?? 0,
    avgDays: stats.totals.avgDaysToResolve,
    openNow: stats.totals.openNow,
  };
  return <Home numbers={numbers} fixed={fixed} points={points} frequent={frequent} />;
}
