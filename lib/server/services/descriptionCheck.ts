/**
 * The description check while a resident creates a report, before it is sent:
 *  - random letters or text that says nothing ("asdfkz kcp", "test test") is
 *    refused: the first kind without the AI too (lib/shared/text.ts);
 *  - obscene or sexual content, hate speech, threats or insults aimed at
 *    people is refused. Anger at a problem or criticism of the municipality
 *    is allowed;
 *  - a description of something other than the chosen problem gets a
 *    warning: the resident changes the type or confirms. It is not refused:
 *    the AI can be wrong, and the department can move the report.
 * Refused descriptions are refused on the server too, when the report is sent.
 * Without the AI, or when it does not answer, only the random-letters check runs.
 * One AI call per text and report type, kept in ai_results.
 */
import 'server-only';
import { looksLikeGibberish } from '@/lib/shared/text';
import { AiRefusedError, AiUnavailableError, aiEnabled, chatJson, hideKeys, type AiJson } from '../ai';
import { db } from '../db';
import { config } from '../env';
import { sha256 } from '../tokens';
import { maskContacts } from './mapper';

export type DescriptionVerdict = 'ok' | 'unrelated' | 'gibberish' | 'abusive' | 'unchecked';

/** Verdicts that refuse the description, in the form and when the report is sent. */
export const REFUSED_DESCRIPTIONS: readonly DescriptionVerdict[] = ['gibberish', 'abusive'];

const DESCRIPTION_CHECK_SYSTEM = `You check the description a resident writes in a report to the Municipality of Elbasan (Albania), before the report is sent.
The text is usually in Albanian, sometimes in English, often short and with spelling mistakes.
Answer ONLY with a JSON object with exactly these keys:
{
  "meaningful": boolean,  // false for random letters, keyboard mashing, test text ("test", "asdf", "abc abc") or text that says nothing about any problem
  "abusive": boolean,     // true ONLY for obscene or sexual content, hate speech, threats, or insults aimed at people.
                          // Anger, complaints and criticism of the municipality or of a service are NOT abusive.
  "matches": boolean      // true when the text plausibly describes the chosen problem or something close to it. Be generous.
}`;

/** The answer of the model, read defensively: only explicit values count. */
export function descriptionVerdictOf(answer: AiJson): DescriptionVerdict {
  if (answer.abusive === true) return 'abusive';
  if (answer.meaningful === false) return 'gibberish';
  if (answer.matches === false) return 'unrelated';
  return 'ok';
}

export async function checkDescription(text: string, requestTypeId: number): Promise<{ verdict: DescriptionVerdict }> {
  const description = text.trim().replace(/\s+/g, ' ');
  if (looksLikeGibberish(description)) return { verdict: 'gibberish' };
  if (!aiEnabled()) return { verdict: 'unchecked' };
  const type = await db.requestType.findUnique({ where: { id: requestTypeId }, include: { category: true } });
  if (!type || !type.active) return { verdict: 'unchecked' };

  const masked = maskContacts(description) ?? ''; // no e-mail addresses or phone numbers to the AI
  const cacheKey = sha256(`description-check:v1:${config().ai.model}:${type.code}:${masked.toLowerCase()}`);
  try {
    const answer = await chatJson({
      kind: 'description-check',
      system: DESCRIPTION_CHECK_SYSTEM,
      userText: `Chosen problem: ${type.nameEn} (category: ${type.category.nameEn}).\nDescription: """${masked.slice(0, 1500)}"""`,
      cacheKey,
    });
    return { verdict: descriptionVerdictOf(answer) };
  } catch (err) {
    if (err instanceof AiRefusedError) return { verdict: 'abusive' }; // the model would not even read it
    if (err instanceof AiUnavailableError) {
      console.error('[description-check] AI unavailable:', hideKeys(err.message));
      return { verdict: 'unchecked' };
    }
    throw err;
  }
}
