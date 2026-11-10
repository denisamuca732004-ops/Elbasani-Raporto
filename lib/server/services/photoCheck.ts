/**
 * The photo check while a resident creates a report, before it is sent:
 *  - an inappropriate photo (nudity or sexual content, graphic violence
 *    against people, obscene images) is refused, on the server too, so the
 *    report cannot be sent with it even by skipping the form;
 *  - a document or a screenshot (not a photo of a place) is refused the same way;
 *  - a photo that does not show the chosen problem (a selfie, a picture taken
 *    by mistake from the gallery) gets a warning, and the resident confirms or
 *    chooses another one. It is not refused: the AI can be wrong about a dark
 *    or distant photo, and a person in the department checks every report
 *    that the AI does not confirm.
 * Needs the AI (AI_ENABLED + AI_API_KEY). Without it, or when the AI does not
 * answer, the answer is "unchecked" and the report goes on as before: photos
 * are never public until the department has verified the report.
 * One check per uploaded photo and report type, kept in ai_results: the form's
 * check and the one when the report is sent cost a single AI call.
 */
import 'server-only';
import sharp from 'sharp';
import { AiRefusedError, AiUnavailableError, aiEnabled, chatJson, hideKeys, type AiJson } from '../ai';
import { db } from '../db';
import { config } from '../env';
import { takeTemporaryUpload } from '../storage';
import { sha256 } from '../tokens';

export type PhotoVerdict = 'ok' | 'unrelated' | 'not_photo' | 'inappropriate' | 'unchecked';

/** Verdicts that refuse the photo, in the form and when the report is sent. */
export const REFUSED_VERDICTS: readonly PhotoVerdict[] = ['inappropriate', 'not_photo'];

const PHOTO_CHECK_SYSTEM = `You check a photo that a resident attaches to a report for the Municipality of Elbasan (Albania), before the report is sent.
Answer ONLY with a JSON object with exactly these keys:
{
  "safe": boolean,     // false ONLY for: nudity or sexual content; graphic violence or gore involving people; obscene or hateful images.
                       // Waste, sewage, damage, accidents to property, and dead or injured animals in a public place are normal for these reports: safe.
  "matches": boolean,  // true when the photo plausibly shows the chosen problem. Be generous: a dark, blurry or distant photo still matches if the problem can be seen.
                       // false for selfies, people posing, screenshots, documents, memes, food, rooms at home, or any picture where the problem cannot be seen.
  "kind": "scene" | "screenshot" | "document" | "people" | "other"
}`;

/**
 * The answer of the model, read defensively: only an explicit "false" counts.
 * A document or a screenshot is never a photo of the problem: refused. A real
 * photo that does not seem to show the chosen problem only gets a warning.
 */
export function verdictOf(answer: AiJson): PhotoVerdict {
  if (answer.safe === false) return 'inappropriate';
  if (answer.matches === false && (answer.kind === 'document' || answer.kind === 'screenshot')) return 'not_photo';
  if (answer.matches === false) return 'unrelated';
  return 'ok';
}

/** The cache key of the check of `photoKey` for the type `typeCode` (also written by the photo analysis). */
export const photoCheckCacheKey = (photoKey: string, typeCode: string): string => sha256(`photo-check:v1:${config().ai.model}:${photoKey}:${typeCode}`);

/** The temporary upload, small (768 px, JPEG) for the AI. Null when it is not a readable image. */
export async function smallPhoto(photoKey: string): Promise<Buffer | null> {
  const original = await takeTemporaryUpload(photoKey);
  try {
    return await sharp(original, { limitInputPixels: 80_000_000 }).rotate()
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  } catch {
    return null;
  }
}

/**
 * Checks the temporary upload `photoKey` (actions/upload.ts) against the chosen
 * report type. Throws only when the photo itself is missing or unreadable
 * (PHOTO_INVALID, shown at the photo step).
 */
export async function checkPhoto(photoKey: string, requestTypeId: number): Promise<{ verdict: PhotoVerdict }> {
  if (!aiEnabled()) return { verdict: 'unchecked' };
  const type = await db.requestType.findUnique({ where: { id: requestTypeId }, include: { category: true } });
  if (!type || !type.active) return { verdict: 'unchecked' };

  const cacheKey = photoCheckCacheKey(photoKey, type.code);
  const cached = await db.aiResult.findUnique({ where: { cacheKey } });
  if (cached) return { verdict: verdictOf(cached.output as AiJson) };

  const small = await smallPhoto(photoKey);
  if (!small) return { verdict: 'unchecked' }; // not a readable image: storing it refuses it with its own message
  try {
    const answer = await chatJson({
      kind: 'photo-check',
      system: PHOTO_CHECK_SYSTEM,
      userText: `Chosen problem: ${type.nameEn} (category: ${type.category.nameEn}). The resident has not written the description yet.`,
      imageDataUrls: [`data:image/jpeg;base64,${small.toString('base64')}`],
      cacheKey,
    });
    return { verdict: verdictOf(answer) };
  } catch (err) {
    // A model that refuses to look at a photo for this check: the photo is not acceptable.
    if (err instanceof AiRefusedError) {
      await db.aiResult.upsert({
        where: { cacheKey },
        create: { cacheKey, kind: 'photo-check', model: config().ai.model, output: { safe: false, refused: true } },
        update: {},
      });
      return { verdict: 'inappropriate' };
    }
    if (err instanceof AiUnavailableError) {
      // In the Vercel logs, so a wrong key or an account without credit is found (also: Integrimi → "Provo lidhjen me AI").
      console.error('[photo-check] AI unavailable:', hideKeys(err.message));
      return { verdict: 'unchecked' };
    }
    throw err;
  }
}
