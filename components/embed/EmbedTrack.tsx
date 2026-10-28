'use client';
import { CaseView, TrackForm, type CaseLookup } from '@/components/public/Track';

export default function EmbedTrack({ lookup }: { lookup?: CaseLookup }) {
  const caseNumber = lookup ? (lookup.found ? lookup.data.caseNumber : lookup.caseNumber) : '';
  return (
    <>
      {(!lookup || !lookup.found) && <TrackForm initial={caseNumber} basePath="/embed/ndiq" key={caseNumber} />}
      {lookup && !lookup.found && <hr className="divider" />}
      {lookup && <CaseView lookup={lookup} />}
    </>
  );
}
