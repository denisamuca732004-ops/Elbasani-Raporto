import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Setup from '@/components/auth/Setup';
import { getT } from '@/i18n/server';
import { setupStatus } from '@/lib/server/services/auth';
import { getPrincipal } from '@/lib/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('auth.setup.title'), robots: { index: false } };
}

export default async function SetupPage() {
  if (await getPrincipal()) redirect('/admin');
  return <Setup status={await setupStatus()} />;
}
