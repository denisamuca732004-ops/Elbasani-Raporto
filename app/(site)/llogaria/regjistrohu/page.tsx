import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { googleEnabled } from '@/auth';
import { ResidentRegister } from '@/components/account/ResidentAuth';
import { getT } from '@/i18n/server';
import { flatParams } from '@/lib/server/pageData';
import { getResident } from '@/lib/server/session';
import { safePublicNext } from '@/lib/shared/safeNext';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('resident.registerTitle'), robots: { index: false } };
}

export default async function RegisterPage({ searchParams }: Props) {
  const next = safePublicNext(flatParams(await searchParams).next);
  if (await getResident()) redirect(next ?? '/llogaria');
  return <ResidentRegister googleEnabled={googleEnabled()} next={next} />;
}
