import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Login from '@/components/auth/Login';
import { getT } from '@/i18n/server';
import { flatParams } from '@/lib/server/pageData';
import { setupStatus } from '@/lib/server/services/auth';
import { safeNext } from '@/lib/shared/safeNext';
import { getPrincipal } from '@/lib/server/session';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('auth.login.title'), robots: { index: false } };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = flatParams(await searchParams);
  const next = safeNext(params.next);
  const principal = await getPrincipal();
  if (principal) redirect(principal.mustChangePassword ? '/hyrje/fjalekalimi' : next ?? '/admin');
  const status = await setupStatus().catch(() => ({ setupComplete: true, adminEmailConfigured: true }));
  return <Login setupComplete={status.setupComplete} next={next} forbidden={params.error === 'forbidden'} />;
}
