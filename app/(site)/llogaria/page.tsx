import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Account from '@/components/account/Account';
import { getT } from '@/i18n/server';
import { getPrincipal, getResident } from '@/lib/server/session';
import { listMyReports } from '@/lib/server/services/residents';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('resident.title'), robots: { index: false } };
}

export default async function AccountPage() {
  const resident = await getResident();
  if (!resident) redirect((await getPrincipal()) ? '/admin' : '/llogaria/hyr');
  const reports = await listMyReports(resident);
  return (
    <Account
      me={{ name: resident.name, email: resident.email, phone: resident.phone, hasPassword: resident.hasPassword, hasGoogle: resident.hasGoogle }}
      reports={reports}
    />
  );
}
