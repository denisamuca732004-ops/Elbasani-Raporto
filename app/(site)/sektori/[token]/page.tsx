import type { Metadata } from 'next';
import SectorReport from '@/components/public/SectorReport';
import { getT } from '@/i18n/server';
import { sectorView, type SectorLookup } from '@/lib/server/services/sectorLink';

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  // The link is the permission: never indexed, never sent on as a referrer.
  return { title: t('sector.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** A sector that works by e-mail opens its report here from the link in the e-mail (no account). */
export default async function SectorReportPage({ params }: Props) {
  const { token } = await params;
  let lookup: SectorLookup;
  try {
    lookup = token.length <= 160 ? await sectorView(token) : { ok: false, problem: 'invalid', message: '' };
  } catch (err) {
    console.error('[sector] lookup failed', err);
    lookup = { ok: false, problem: 'invalid', message: '' };
  }
  return <SectorReport lookup={lookup} />;
}
