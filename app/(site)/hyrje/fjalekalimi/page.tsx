import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ChangePassword from '@/components/auth/ChangePassword';
import { getT } from '@/i18n/server';
import { getPrincipal } from '@/lib/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('auth.change.title'), robots: { index: false } };
}

export default async function ChangePasswordPage() {
  const principal = await getPrincipal();
  if (!principal) redirect('/hyrje');
  return <ChangePassword name={principal.name} email={principal.email} mustChange={principal.mustChangePassword} />;
}
