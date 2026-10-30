'use client';
/**
 * Data every page needs, loaded once on the server (from the Redis cache) and
 * handed to client components: branding and reporting rules, and the
 * catalogue of categories, types, areas and departments.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Catalog, CatalogCategory, CatalogType, PublicSettings, Viewer } from '@/lib/shared/types';

const SettingsContext = createContext<PublicSettings | null>(null);

export function SettingsProvider({ value, children }: { value: PublicSettings; children: ReactNode }) {
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): PublicSettings {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}

const ViewerContext = createContext<Viewer>(null);

/** Who is signed in on the public site (read once per page on the server). */
export function ViewerProvider({ value, children }: { value: Viewer; children: ReactNode }) {
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer(): Viewer {
  return useContext(ViewerContext);
}

export type TypeWithCategory = CatalogType & { category: CatalogCategory };
interface CatalogValue {
  catalog: Catalog;
  types: TypeWithCategory[];
  departments: Catalog['departments'];
  typeById: (id: number | string | null | undefined) => TypeWithCategory | undefined;
  categoryByCode: (code: string | null | undefined) => CatalogCategory | undefined;
  departmentById: (id: number | string | null | undefined) => Catalog['departments'][number] | undefined;
}
const CatalogContext = createContext<CatalogValue | null>(null);

export function CatalogProvider({ catalog, children }: { catalog: Catalog; children: ReactNode }) {
  const value = useMemo<CatalogValue>(() => {
    const types = catalog.categories.flatMap((c) => c.types.map((t) => ({ ...t, category: c })));
    return {
      catalog,
      types,
      departments: catalog.departments,
      typeById: (id) => types.find((t) => t.id === Number(id)),
      categoryByCode: (code) => catalog.categories.find((c) => c.code === code),
      departmentById: (id) => catalog.departments.find((d) => d.id === Number(id)),
    };
  }, [catalog]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogValue {
  const value = useContext(CatalogContext);
  if (!value) throw new Error('useCatalog must be used inside <CatalogProvider>');
  return value;
}
