import Home from '@/components/public/Home';
import { frequentTypes, listRecent } from '@/lib/server/services/publicReport';
import type { PublicCard } from '@/lib/shared/types';
import { recentSchema } from '@/lib/validation/report';

export default async function HomePage() {
  const [recent, frequent] = await Promise.all([
    listRecent(recentSchema.parse({ limit: 8 })).catch((err: unknown): PublicCard[] | null => {
      console.error('[home] recent reports unavailable', err);
      return null;
    }),
    // Without it the home page simply has no "Raportohen më shpesh".
    frequentTypes().catch((err: unknown): Array<{ id: number; count: number }> => {
      console.error('[home] frequent types unavailable', err);
      return [];
    }),
  ]);
  return <Home recent={recent} frequent={frequent} />;
}
