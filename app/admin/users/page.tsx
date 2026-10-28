import type { Metadata } from 'next';
import Users from '@/components/admin/Users';
import { getT } from '@/i18n/server';
import { flatParams, pageAdmin } from '@/lib/server/pageData';
import { listUsers } from '@/lib/server/services/users';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.users') };
}

/** Only panel accounts are listed (USER accounts have no access to the panel). */
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await pageAdmin('/admin/users');
  const params = flatParams(await searchParams);
  const preset = /^\d{1,9}$/.test(params.departmentId ?? '') ? Number(params.departmentId) : null;
  const users = (await listUsers(admin)).filter((u) => u.role !== 'USER');
  return <Users key={preset ?? 'all'} selfId={admin.id} items={users} presetDepartmentId={preset} />;
}
