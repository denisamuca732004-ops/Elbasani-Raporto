import type { ReactNode } from 'react';
import { CatalogProvider } from '@/components/providers';
import SiteFrame from '@/components/site/SiteFrame';
import { pageCatalog } from '@/lib/server/pageData';

export default async function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <CatalogProvider catalog={await pageCatalog()}>
      <SiteFrame>{children}</SiteFrame>
    </CatalogProvider>
  );
}
