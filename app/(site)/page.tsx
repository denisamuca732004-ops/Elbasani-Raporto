import Home from '@/components/public/Home';
import { listRecent } from '@/lib/server/services/publicReport';
import type { PublicCard } from '@/lib/shared/types';
import { recentSchema } from '@/lib/validation/report';

export default async function HomePage() {
  let recent: PublicCard[] | null;
  try {
    recent = await listRecent(recentSchema.parse({ limit: 8 }));
  } catch (err) {
    console.error('[home] recent reports unavailable', err);
    recent = null;
  }
  return <Home recent={recent} />;
}
