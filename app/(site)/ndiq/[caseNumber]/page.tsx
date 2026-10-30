import type { Metadata } from 'next';
import Track from '@/components/public/Track';
import { lookupCase } from '@/lib/server/publicCase';

type Props = { params: Promise<{ caseNumber: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { caseNumber } = await params;
  return { title: decodeURIComponent(caseNumber).slice(0, 40).toUpperCase(), robots: { index: false } };
}

export default async function TrackCasePage({ params }: Props) {
  const { caseNumber } = await params;
  return <Track lookup={await lookupCase(caseNumber)} />;
}
