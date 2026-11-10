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

/**
 * The model declined to answer (OpenAI-compatible APIs put the reason in
 * `message.refusal`). For a photo check that usually means the picture
 * itself is not acceptable. Callers that only need "no answer" can treat it
 * as AiUnavailableError, which it extends.
 */
export class AiRefusedError extends AiUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = 'AiRefusedError';
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

/* ── The monthly spending limit ── */

/** "2026-11": the month in Elbasan's time zone. */
export function usageMonth(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7);
}

/** Estimated cost in US dollars of the given tokens, at the configured prices. */
export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  const ai = config().ai;
  return (inputTokens * ai.priceInputPerMTok + outputTokens * ai.priceOutputPerMTok) / 1_000_000;
}

export interface AiUsageSummary { month: string; calls: number; costUsd: number; budgetUsd: number; reached: boolean }

/** This month's AI use and whether the limit is reached (budget 0 = no limit). */
export async function aiUsageThisMonth(): Promise<AiUsageSummary> {
  const month = usageMonth();
  const row = await db.aiUsage.findUnique({ where: { month } });
  const costUsd = row ? estimateCostUsd(Number(row.inputTokens), Number(row.outputTokens)) : 0;
  const budgetUsd = config().ai.monthlyBudgetUsd;
  return { month, calls: row?.calls ?? 0, costUsd, budgetUsd, reached: budgetUsd > 0 && costUsd >= budgetUsd };
}

// Read at most every 30 s per server instance: a few calls past the limit cost cents, a query per call costs more.
let budgetSeen: { at: number; reached: boolean } | null = null;
export async function aiBudgetReached(): Promise<boolean> {
  if (config().ai.monthlyBudgetUsd <= 0) return false;
  if (budgetSeen && Date.now() - budgetSeen.at < 30_000) return budgetSeen.reached;
  let reached = false;
  try {
    reached = (await aiUsageThisMonth()).reached;
  } catch {
    reached = false; // the counter is unreadable: the AI goes on (the provider's own limit still protects)
  }
  budgetSeen = { at: Date.now(), reached };
  return reached;
}
export function resetAiBudgetCacheForTests(): void {
  budgetSeen = null;
}

/** The AI is on AND this month's limit is not reached (what the public forms use). */
export async function aiAvailable(): Promise<boolean> {
  return aiEnabled() && !(await aiBudgetReached());
}

async function recordUsage(inputTokens: number, outputTokens: number): Promise<void> {
  const month = usageMonth();
  try {
    await db.aiUsage.upsert({
      where: { month },
      create: { month, calls: 1, inputTokens: BigInt(inputTokens), outputTokens: BigInt(outputTokens) },
      update: { calls: { increment: 1 }, inputTokens: { increment: BigInt(inputTokens) }, outputTokens: { increment: BigInt(outputTokens) } },
    });
  } catch (err) {
    console.error('[ai] usage not recorded:', err instanceof Error ? err.message : err);
  }
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
  if (await aiBudgetReached()) throw new AiUnavailableError('AI monthly budget reached');

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
  let json: { choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    throw new AiUnavailableError('AI answer was not valid JSON');
  }
  const tokens = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  await recordUsage(tokens(json?.usage?.prompt_tokens), tokens(json?.usage?.completion_tokens));
  const message = json?.choices?.[0]?.message;
  if (typeof message?.refusal === 'string' && message.refusal.trim()) throw new AiRefusedError(`AI refused: ${message.refusal.slice(0, 200)}`);
  const output = parseJsonLoose(message?.content);

  if (cacheKey) {
    await db.aiResult.upsert({
      where: { cacheKey },
      create: { cacheKey, kind, model: ai.model, output: output as Prisma.InputJsonObject },
      update: {},
    });
  }
  return output;
}

/** Hides anything that looks like an API key in an error text (OpenAI repeats part of a wrong key). */
export const hideKeys = (text: string): string => text.replace(/\b(sk|pk|key)-[A-Za-z0-9_*-]{4,}/g, '$1-…');

export type AiProblem = 'disabled' | 'budget' | 'key' | 'quota' | 'model' | 'timeout' | 'other';

/** What the admin sees about the AI settings (never the key itself). */
export function aiSettingsSummary(): { enabled: boolean; enabledFlag: boolean; hasKey: boolean; model: string; host: string } {
  const ai = config().ai;
  let host = '';
  try { host = new URL(ai.baseUrl).host; } catch { host = ai.baseUrl; }
  return { enabled: aiEnabled(), enabledFlag: ai.enabled, hasKey: Boolean(ai.apiKey), model: ai.model, host };
}

/**
 * "Test the AI connection" in the panel: one tiny request (not cached), and in
 * plain words why it failed: a wrong key, no credit, an unknown model, a timeout.
 */
export async function testAiConnection(): Promise<{ ok: boolean; problem?: AiProblem; detail?: string }> {
  if (!aiEnabled()) return { ok: false, problem: 'disabled' };
  if (await aiBudgetReached()) return { ok: false, problem: 'budget' };
  try {
    await chatJson({ kind: 'test', system: 'Answer ONLY with the JSON object {"ok": true}.', userText: 'ping' });
    return { ok: true };
  } catch (err) {
    const message = hideKeys(err instanceof Error ? err.message : String(err)).slice(0, 300);
    const problem: AiProblem = /HTTP 401|HTTP 403/.test(message) ? 'key'
      : /HTTP 429|quota|billing/i.test(message) ? 'quota'
        : /HTTP 404|model_not_found|does not exist/i.test(message) ? 'model'
          : /timed out/i.test(message) ? 'timeout' : 'other';
    return { ok: false, problem, detail: message };
  }
}
