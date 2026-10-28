import type { Metadata } from 'next';
import Departments from '@/components/admin/Departments';
import { getT } from '@/i18n/server';
import { pageAdmin } from '@/lib/server/pageData';
import { listDepartments } from '@/lib/server/services/admin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.sectors') };
}

export default async function DepartmentsPage() {
  const admin = await pageAdmin('/admin/departments');
  return <Departments items={await listDepartments(admin)} />;
}
