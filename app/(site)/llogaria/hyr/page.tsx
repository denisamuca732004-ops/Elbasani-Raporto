import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { googleEnabled } from '@/auth';
import { ResidentSignIn } from '@/components/account/ResidentAuth';
import { getT } from '@/i18n/server';
import { flatParams } from '@/lib/server/pageData';
import { getResident } from '@/lib/server/session';
import { safePublicNext } from '@/lib/shared/safeNext';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('resident.signInTitle'), robots: { index: false } };
}

export default async function SignInPage({ searchParams }: Props) {
  const params = flatParams(await searchParams);
  const next = safePublicNext(params.next);
  if (await getResident()) redirect(next ?? '/llogaria');
  // ?gabim=… comes from our Google check; ?error=… from Auth.js itself (e.g. the resident cancelled on Google's page).
  const error = params.gabim ?? (params.error ? 'generic' : null);
  return <ResidentSignIn googleEnabled={googleEnabled()} next={next} error={error} />;
}
