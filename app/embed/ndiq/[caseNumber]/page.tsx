import EmbedTrack from '@/components/embed/EmbedTrack';
import { lookupCase } from '@/lib/server/publicCase';

export default async function EmbedCasePage({ params }: { params: Promise<{ caseNumber: string }> }) {
  const { caseNumber } = await params;
  return <EmbedTrack lookup={await lookupCase(caseNumber)} />;
}
