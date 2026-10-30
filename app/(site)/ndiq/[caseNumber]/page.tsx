import type { Metadata } from 'next';
import Track from '@/components/public/Track';
import { lookupCase } from '@/lib/server/publicCase';
import { getResident } from '@/lib/server/session';
import { isMyReport } from '@/lib/server/services/residents';

type Props = { params: Promise<{ caseNumber: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { caseNumber } = await params;
  return { title: decodeURIComponent(caseNumber).slice(0, 40).toUpperCase(), robots: { index: false } };
}

export default async function TrackCasePage({ params }: Props) {
  const { caseNumber } = await params;
  const lookup = await lookupCase(caseNumber);
  // The resident's own report (signed in): no "I have this problem too" for them.
  const mine = lookup.found ? await isMyReport(await getResident(), lookup.data.caseNumber).catch(() => false) : false;
  return <Track lookup={lookup} mine={mine} />;
}
