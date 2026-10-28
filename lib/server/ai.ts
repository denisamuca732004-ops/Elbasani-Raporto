/**
 * Client for any OpenAI-compatible chat completions API (OpenAI, Azure,
 * a hackathon proxy, a local model server…).
 * Rules: the key stays on the server, every call has a timeout, there are
 * NO automatic retries (to protect the budget) and identical questions are
 * answered from the ai_results cache.
 */
import 'server-only';
import { Prisma, db } from './db';
import { config } from './env';

export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export type AiJson = Record<string, unknown>;

export function aiEnabled(): boolean {
  return Boolean(config().ai.enabled && config().ai.apiKey);
}

/** Accepts plain JSON, or JSON wrapped in ```json fences or surrounded by text. */
export function parseJsonLoose(text: unknown): AiJson {
  if (typeof text !== 'string' || !text.trim()) throw new AiUnavailableError('Empty AI answer');
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const attempt = (s: string): AiJson | null => {
    try {
      const value: unknown = JSON.parse(s);
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as AiJson) : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(cleaned);
  if (direct) return direct;
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const inner = attempt(cleaned.slice(start, end + 1));
    if (inner) return inner;
  }
  throw new AiUnavailableError('AI answer was not valid JSON');
}

export interface ChatJsonInput { kind: string; system: string; userText: string; imageDataUrls?: string[]; cacheKey?: string }

/** Asks the model for a JSON object. */
export async function chatJson({ kind, system, userText, imageDataUrls = [], cacheKey }: ChatJsonInput): Promise<AiJson> {
  if (!aiEnabled()) throw new AiUnavailableError('AI is disabled');

  if (cacheKey) {
    const hit = await db.aiResult.findUnique({ where: { cacheKey } });
    if (hit) return hit.output as AiJson;
  }
  const ai = config().ai;

  const userContent = imageDataUrls.length
    ? [{ type: 'text', text: userText }, ...imageDataUrls.map((url) => ({ type: 'image_url', image_url: { url, detail: 'low' } }))]
    : userText;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ai.timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const e = err as Error;
    throw new AiUnavailableError(e.name === 'AbortError' ? 'AI request timed out' : `AI request failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AiUnavailableError(`AI HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  let json: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    throw new AiUnavailableError('AI answer was not valid JSON');
  }
  const output = parseJsonLoose(json?.choices?.[0]?.message?.content);

  if (cacheKey) {
    await db.aiResult.upsert({
      where: { cacheKey },
      create: { cacheKey, kind, model: ai.model, output: output as Prisma.InputJsonObject },
      update: {},
    });
  }
  return output;
}
