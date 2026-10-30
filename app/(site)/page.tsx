import Home from '@/components/public/Home';
import { listRecent } from '@/lib/server/services/publicReport';
import type { PublicCard } from '@/lib/shared/types';
import { recentSchema } from '@/lib/validation/report';

export default async function HomePage() {
  const recent = await listRecent(recentSchema.parse({ limit: 8 })).catch((err: unknown): PublicCard[] | null => {
    console.error('[home] recent reports unavailable', err);
    return null;
  });
  return <Home recent={recent} />;
}
