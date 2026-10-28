import Home from '@/components/public/Home';
import { getGuide } from '@/lib/server/services/guide';
import { listRecent } from '@/lib/server/services/publicReport';
import type { GuideItem } from '@/lib/shared/guide';
import type { PublicCard } from '@/lib/shared/types';
import { recentSchema } from '@/lib/validation/report';

export default async function HomePage() {
  const [recent, guide] = await Promise.all([
    listRecent(recentSchema.parse({ limit: 8 })).catch((err: unknown): PublicCard[] | null => {
      console.error('[home] recent reports unavailable', err);
      return null;
    }),
    // Without the guide the search box still finds report numbers, problems and streets.
    getGuide().catch((err: unknown): GuideItem[] => {
      console.error('[home] guide unavailable', err);
      return [];
    }),
  ]);
  return <Home recent={recent} guide={guide} />;
}
