import type { ReactNode } from 'react';
import { CatalogProvider, ViewerProvider } from '@/components/providers';
import SiteFrame from '@/components/site/SiteFrame';
import { pageCatalog, siteViewer } from '@/lib/server/pageData';

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [catalog, viewer] = await Promise.all([pageCatalog(), siteViewer()]);
  return (
    <CatalogProvider catalog={catalog}>
      <ViewerProvider value={viewer}>
        <SiteFrame>{children}</SiteFrame>
      </ViewerProvider>
    </CatalogProvider>
  );
}
