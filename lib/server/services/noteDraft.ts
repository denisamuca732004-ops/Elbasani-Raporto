/**
 * Notes for residents, proposed by the AI in the panel: the note when a report
 * is fixed, the reason when it is refused, a message to the resident. The AI
 * only proposes: the text goes into the field, where the person reads it,
 * changes it if needed, and decides to send it. Nothing is sent by the AI.
 * When the field already has a few words ("the hole was filled"), the AI turns
 * them into a clear, polite note without adding facts of its own.
 * The resident's contacts never go to the AI (masked in the description).
 */
import 'server-only';
import { AiUnavailableError, aiEnabled, chatJson, hideKeys } from '../ai';
import { db } from '../db';
import { AppError, notFound } from '../errors';
import type { Principal } from '@/lib/shared/types';
import { LIMITS } from '@/lib/shared/domain';
import { assertCanAccessReport } from './access';
import { maskContacts } from './mapper';

export type NoteKind = 'resolve' | 'reject' | 'message';

const PURPOSE: Record<NoteKind, string> = {
  resolve: 'the public note shown to the resident when the problem has been FIXED (what was done). 1-2 sentences.',
  reject: 'the public reason shown to the resident when the Municipality CANNOT handle the report (why, and where to turn if the staff notes say so). 1-3 sentences.',
  message: 'a short message e-mailed to the resident about the report (e.g. asking for a detail, or telling them what happens next). 1-3 sentences.',
};

const SYSTEM = `You help staff of the Municipality of Elbasan (Albania) write to residents about their reports.
Answer ONLY with a JSON object: {"textSq": string}.
textSq is IN ALBANIAN, polite and plain, addressing the resident formally ("ju"), as the Municipality ("Bashkia").
Rules: never invent facts, dates, deadlines, names or promises that are not in the staff notes or the report; if the staff notes are empty, stay general.
No greeting line, no signature, no case number, no personal data. Keep it short.`;

export async function draftNote(user: Principal, reportId: string, kind: NoteKind, notes: string): Promise<{ text: string }> {
  if (!aiEnabled()) throw new AppError(503, 'AI_OFF', 'AI nuk është aktive.');
  const report = await db.report.findUnique({
    where: { id: reportId },
    select: {
      departmentId: true, description: true, address: true, status: true,
      requestType: { select: { nameSq: true } }, neighbourhood: { select: { name: true } }, department: { select: { nameSq: true } },
    },
  });
  if (!report) throw notFound('Raportimi nuk u gjet.');
  assertCanAccessReport(user, report);
  const userText = JSON.stringify({
    write: PURPOSE[kind],
    report: {
      problem: report.requestType.nameSq,
      place: [report.address, report.neighbourhood?.name].filter(Boolean).join(', ') || null,
      residentDescription: maskContacts(report.description)?.slice(0, 1500) ?? '',
      sector: report.department?.nameSq ?? null,
    },
    staffNotes: notes.trim().slice(0, 1000),
  });
  try {
    const out = await chatJson({ kind: `draft-${kind}`, system: SYSTEM, userText });
    let text = typeof out.textSq === 'string' ? out.textSq.replace(/[ \t]+/g, ' ').trim() : '';
    text = text.slice(0, kind === 'reject' ? 1000 : 2000);
    if (text.length < LIMITS.minRejectReason) throw new AiUnavailableError('empty draft');
    return { text };
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      console.error('[note-draft] AI unavailable:', hideKeys(err.message));
      throw new AppError(503, 'AI_UNAVAILABLE', 'AI nuk u përgjigj. Shkruajeni vetë tekstin ose provoni përsëri pas pak.');
    }
    throw err;
  }
}
