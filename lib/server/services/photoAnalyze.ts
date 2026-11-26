/**
 * "Raporto me foto": the resident starts from the photo, and the AI proposes
 * what to fill in, before anything is sent:
 *  - the report type (and so the category and the department), only when the
 *    model is reasonably sure; otherwise the resident chooses it as before;
 *  - a short description in Albanian of what can be SEEN (no names, no
 *    plates, no guesses about who did it), which the resident can change.
 * The same rules as the photo check apply (lib/server/services/photoCheck.ts):
 * an inappropriate photo, a document or a screenshot is refused; the AI never
 * sends anything by itself, the resident confirms every field.
 * Without the AI, or when it does not answer: "unchecked" and no proposal; the
 * form goes on as the normal one.
 * One analysis per uploaded photo (ai_results). The photo check for the
 * proposed type is written at the same time, so sending the report with that
 * type costs no second AI call.
 */
import 'server-only';
import { AiRefusedError, AiUnavailableError, aiEnabled, chatJson, hideKeys, type AiJson } from '../ai';
import { db } from '../db';
import { config } from '../env';
import { sha256 } from '../tokens';
import { LIMITS, isOtherChoice } from '@/lib/shared/domain';
import { looksLikeGibberish } from '@/lib/shared/text';
import { photoCheckCacheKey, smallPhoto, type PhotoVerdict } from './photoCheck';

export interface PhotoAnalysis {
  verdict: PhotoVerdict;
  /** The proposed type, or null when the model is not sure enough (the resident chooses). */
  requestTypeId: number | null;
  /** 0–100, as the model gave it. */
  confidence: number;
  /** The proposed description (Albanian), or '' when there is none worth showing. */
  description: string;
  /** Small and safe enough for residents to fix themselves ("Ndihmo qytetin" invites them). */
  citizenCanFix: boolean;
  /** With citizenCanFix: what to bring (Albanian, short), how many people, about how long. */
  fix?: { bring: string; bringEn: string; people: number; minutes: number } | null;
}

/** Below this the type is not proposed: a wrong type sends the report to the wrong department. */
export const MIN_TYPE_CONFIDENCE = 60;
const MAX_PROPOSED_DESCRIPTION = 400;

const NONE: PhotoAnalysis = { verdict: 'unchecked', requestTypeId: null, confidence: 0, description: '', citizenCanFix: false, fix: null };

const SYSTEM = `You help a resident report a problem in a public place to the Municipality of Elbasan (Albania), starting from a photo.
Answer ONLY with a JSON object with exactly these keys:
{
  "safe": boolean,        // false ONLY for: nudity or sexual content; graphic violence or gore involving people; obscene or hateful images.
                          // Waste, sewage, damage, accidents to property, and dead or injured animals in a public place are normal: safe.
  "kind": "scene" | "screenshot" | "document" | "people" | "other",
  "problemVisible": boolean, // true when a problem the Municipality handles can be seen (even if the photo is dark, blurry or distant).
  "typeCode": string | null, // the code of the ONE type from the list that best fits what is visible, or null when none fits or you are unsure.
  "confidence": number,      // 0-100: how sure you are about typeCode.
  "descriptionSq": string    // 1-2 short sentences IN ALBANIAN describing only what is visible (the problem, its size, where it is in the picture).
                          // Never names of people, licence plates, faces or guesses about who caused it. Empty string when no problem is visible.
  "citizenCanFix": boolean   // true when a GROUP of ordinary neighbours (up to 20 people) could do it safely with simple tools (gloves, bags, brushes,
                          // rakes, paint) in under 4 hours: litter, even a lot of scattered litter or many bags; leaves blocking a drain; cleaning a small
                          // park or a bench; graffiti. False ONLY for what is dangerous or beyond them: electricity or lamps, cutting or climbing big
                          // trees, work on a road with traffic, holes in the road, water or sewage leaks, heights or roofs, deep water, asbestos,
                          // chemicals, syringes, dead or aggressive animals, building or demolition, a dump so big it needs a truck or machinery.
  "fixBringSq": string,      // only when citizenCanFix: what to bring, IN ALBANIAN, a few words (e.g. "dorashka, qese plehrash"); else "".
  "fixBringEn": string,      // the same IN ENGLISH (e.g. "gloves, rubbish bags"); else "".
  "fixPeople": number,       // only when citizenCanFix: how many people are enough (1-20); else 0.
  "fixMinutes": number       // only when citizenCanFix: about how many minutes it takes for them (15-240); else 0.
}
Prefer a specific type over a ".other" type. Use a ".other" type only when the problem clearly belongs to that category but no specific type fits.`;

/** The answer of the model, read defensively (an odd value never refuses a photo). */
export function analysisOf(answer: AiJson, types: Array<{ id: number; code: string }>): PhotoAnalysis {
  if (answer.safe === false) return { ...NONE, verdict: 'inappropriate' };
  const visible = answer.problemVisible !== false;
  if (!visible && (answer.kind === 'document' || answer.kind === 'screenshot')) return { ...NONE, verdict: 'not_photo' };
  const confidence = typeof answer.confidence === 'number' && Number.isFinite(answer.confidence) ? Math.max(0, Math.min(100, Math.round(answer.confidence))) : 0;
  const code = typeof answer.typeCode === 'string' ? answer.typeCode.trim() : '';
  const type = code ? types.find((t) => t.code === code) : undefined;
  const requestTypeId = visible && type && confidence >= MIN_TYPE_CONFIDENCE ? type.id : null;
  let description = visible && typeof answer.descriptionSq === 'string' ? answer.descriptionSq.replace(/\s+/g, ' ').trim() : '';
  if (description.length > MAX_PROPOSED_DESCRIPTION) description = `${description.slice(0, MAX_PROPOSED_DESCRIPTION - 1).replace(/\s+\S*$/, '')}…`;
  if (description.length < LIMITS.minDescription || looksLikeGibberish(description)) description = '';
  const citizenCanFix = visible && answer.citizenCanFix === true;
  return { verdict: visible ? 'ok' : 'unrelated', requestTypeId, confidence: requestTypeId ? confidence : 0, description, citizenCanFix, fix: citizenCanFix ? fixOf(answer) : null };
}

/** What residents need to fix it themselves; sensible values when the model gave none. */
function fixOf(answer: AiJson): { bring: string; bringEn: string; people: number; minutes: number } {
  const whole = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.max(min, Math.min(max, Math.round(v))) : fallback);
  const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 120) : '');
  const bring = text(answer.fixBringSq);
  const bringEn = text(answer.fixBringEn);
  return {
    bring: bring && !looksLikeGibberish(bring) ? bring : 'dorashka, qese plehrash',
    // The page in English shows this one (the description of the report stays in Albanian, for the staff).
    bringEn: bringEn && !looksLikeGibberish(bringEn) ? bringEn : 'gloves, rubbish bags',
    people: whole(answer.fixPeople, 1, 20, 2),
    // Rounded to 15 minutes: "rreth 30 minuta" reads better than "27 minuta".
    minutes: Math.round(whole(answer.fixMinutes, 15, 240, 30) / 15) * 15,
  };
}

/** Analyses the temporary upload `photoKey` (actions/upload.ts). Throws only when the photo itself is missing. */
export async function analyzePhoto(photoKey: string): Promise<PhotoAnalysis> {
  if (!aiEnabled()) return NONE;
  const types = await db.requestType.findMany({
    where: { active: true, category: { active: true } },
    include: { category: true },
    orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
  });
  if (!types.length) return NONE;

  // The list of types is part of the question: a change in the catalogue asks again.
  const catalogue = types.map((t) => `${t.code}: ${t.nameEn} (category: ${t.category.nameEn})${isOtherChoice(t.code) ? ' — anything else in this category' : ''}`).join('\n');
  const cacheKey = sha256(`photo-analyze:v5:${config().ai.model}:${photoKey}:${sha256(catalogue)}`);
  const cached = await db.aiResult.findUnique({ where: { cacheKey } });
  if (cached) return analysisOf(cached.output as AiJson, types);

  const small = await smallPhoto(photoKey);
  if (!small) return NONE;
  let answer: AiJson;
  try {
    answer = await chatJson({
      kind: 'photo-analyze',
      system: SYSTEM,
      userText: `Types of reports (code: name):\n${catalogue}`,
      imageDataUrls: [`data:image/jpeg;base64,${small.toString('base64')}`],
      cacheKey,
    });
  } catch (err) {
    if (err instanceof AiRefusedError) return { ...NONE, verdict: 'inappropriate' };
    if (err instanceof AiUnavailableError) {
      console.error('[photo-analyze] AI unavailable:', hideKeys(err.message));
      return NONE;
    }
    throw err;
  }
  const result = analysisOf(answer, types);
  // The photo check of the proposed type: already answered by this analysis.
  const proposed = result.requestTypeId ? types.find((t) => t.id === result.requestTypeId) : undefined;
  if (proposed) {
    const key = photoCheckCacheKey(photoKey, proposed.code);
    await db.aiResult.upsert({
      where: { cacheKey: key },
      create: { cacheKey: key, kind: 'photo-check', model: config().ai.model, output: { safe: true, matches: true, kind: 'scene', from: 'photo-analyze' } },
      update: {},
    });
  }
  return result;
}
