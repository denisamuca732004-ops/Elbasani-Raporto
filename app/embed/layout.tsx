import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import EmbedFrame from '@/components/embed/EmbedFrame';
import { CatalogProvider } from '@/components/providers';
import { pageCatalog } from '@/lib/server/pageData';

export const metadata: Metadata = { robots: { index: false } };

/** Shown inside an iframe only on the sites the admin allowed (frame-ancestors, set in proxy.ts). */
export default async function EmbedLayout({ children }: { children: ReactNode }) {
  return (
    <CatalogProvider catalog={await pageCatalog()}>
      <EmbedFrame>{children}</EmbedFrame>
    </CatalogProvider>
  );
}
