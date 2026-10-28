'use client';
import { CaseView, TrackForm, type CaseLookup } from '@/components/public/Track';

export default function EmbedTrack({ lookup }: { lookup?: CaseLookup }) {
  const caseNumber = lookup ? (lookup.found ? lookup.data.caseNumber : lookup.caseNumber) : '';
  return (
    <>
      <TrackForm initial={caseNumber} basePath="/embed/ndiq" key={caseNumber} />
      {lookup && <><hr className="divider" /><CaseView lookup={lookup} /></>}
    </>
  );
}
