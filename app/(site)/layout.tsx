import type { ReactNode } from 'react';
import { CatalogProvider, ViewerProvider } from '@/components/providers';
import SiteFrame from '@/components/site/SiteFrame';
import { pageCatalog, siteViewer } from '@/lib/server/pageData';
import { getGuide } from '@/lib/server/services/guide';
import type { GuideItem } from '@/lib/shared/guide';

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [catalog, viewer, guide] = await Promise.all([
    pageCatalog(),
    siteViewer(),
    // Without the guide the search box still finds report numbers, problems and streets.
    getGuide().catch((err: unknown): GuideItem[] => {
      console.error('[site] guide unavailable', err);
      return [];
    }),
  ]);
  return (
    <CatalogProvider catalog={catalog}>
      <ViewerProvider value={viewer}>
        <SiteFrame guide={guide}>{children}</SiteFrame>
      </ViewerProvider>
    </CatalogProvider>
  );
}
