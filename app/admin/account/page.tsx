import type { Metadata } from 'next';
import Account from '@/components/panel/Account';
import { getT } from '@/i18n/server';
import { pageStaff } from '@/lib/server/pageData';
import { lastLoginOf } from '@/lib/server/services/auth';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.account') };
}

export default async function AccountPage() {
  const principal = await pageStaff('/admin/account');
  return <Account principal={principal} lastLoginAt={await lastLoginOf(principal).catch(() => null)} />;
}
