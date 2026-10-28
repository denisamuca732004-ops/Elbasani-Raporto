import type { Metadata } from 'next';
import ReportTypes, { type AdminCategory } from '@/components/admin/ReportTypes';
import { getT } from '@/i18n/server';
import { flatParams, pageAdmin } from '@/lib/server/pageData';
import { listCategories } from '@/lib/server/services/admin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.catalogue') };
}

export default async function ReportTypesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await pageAdmin('/admin/report-types');
  const params = flatParams(await searchParams);
  const filter = params.departmentId === 'none' || /^\d{1,9}$/.test(params.departmentId ?? '') ? params.departmentId! : '';
  const categories: AdminCategory[] = (await listCategories(admin)).map((c) => ({
    id: c.id, code: c.code, nameSq: c.nameSq, nameEn: c.nameEn, icon: c.icon, active: c.active,
    types: c.requestTypes.map((ty) => ({
      id: ty.id, code: ty.code, nameSq: ty.nameSq, nameEn: ty.nameEn, kind: ty.kind, departmentId: ty.departmentId,
      departmentActive: ty.department ? ty.department.active : null, slaDays: ty.slaDays, defaultPriority: ty.defaultPriority, active: ty.active,
    })),
  }));
  return <ReportTypes categories={categories} departmentFilter={filter} />;
}
