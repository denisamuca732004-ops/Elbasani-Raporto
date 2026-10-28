/**
 * The automatic check of new reports (background job "triage"). The AI never
 * decides alone: it suggests a report type, a priority (LOW / MEDIUM / HIGH)
 * and a one-line summary, and checks that the photo shows the reported
 * problem. Staff always see the suggestion labelled "AI" and can change it.
 * When the AI is off or fails, keyword rules are used and a person verifies.
 *
 * Priority rule: the AI and the keyword rules can only RAISE the default
 * priority of the report type, never lower it. People can lower it.
 */
import 'server-only';
import { maxPriority, PRIORITIES, type Priority, type Status } from '@/lib/shared/domain';
import { AiUnavailableError, aiEnabled, chatJson, type AiJson } from '../ai';
import { db } from '../db';
import { config } from '../env';
import { imageDataUrl } from '../storage';
import { sha256 } from '../tokens';
import { maskContacts } from './mapper';
import { notifyDepartmentOfReport } from './notification';

const DANGER_WORDS = [
  'rrezik', 'rrezikshëm', 'rrezikshme', 'urgjent', 'pus i hapur', 'kabllo', 'tel elektrik', 'zjarr',
  'aksident', 'fëmijë', 'rrëzuar', 'shembur', 'danger', 'urgent', 'open manhole', 'exposed cable', 'fire', 'collapsed',
];

const normalise = (s: unknown): string => String(s ?? '').toLowerCase();
const clampInt = (n: unknown, min: number, max: number): number | null =>
  (Number.isFinite(Number(n)) ? Math.max(min, Math.min(max, Math.round(Number(n)))) : null);
const asPriority = (v: unknown): Priority | null => {
  const upper = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return (PRIORITIES as readonly string[]).includes(upper) ? (upper as Priority) : null;
};
const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const asObject = (v: unknown): AiJson => (v && typeof v === 'object' && !Array.isArray(v) ? (v as AiJson) : {});

async function activeTypes() {
  return db.requestType.findMany({
    where: { active: true },
    orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  });
}

type TypeLike = { id: number; code: string; nameSq: string; nameEn: string; keywords: string | null };

/** Keyword rules used when the AI is off: HIGH for danger words, type from keywords. */
export function ruleBasedTriage<T extends TypeLike>(text: string, types: T[]): { priority: Priority | null; type: T | null } {
  const t = normalise(text);
  const priority: Priority | null = DANGER_WORDS.some((w) => t.includes(w)) ? 'HIGH' : null;
  let best: T | null = null;
  let bestScore = 0;
  for (const type of types) {
    const words = [type.nameSq, type.nameEn, ...(type.keywords ?? '').split(',')].map(normalise).map((w) => w.trim()).filter((w) => w.length > 2);
    const score = words.reduce((acc, w) => acc + (t.includes(w) ? (w.includes(' ') ? 2 : 1) : 0), 0);
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  return { priority, type: bestScore > 0 ? best : null };
}

function summaryFallback(r: { description: string | null; address: string | null }, type: { nameSq: string }): string {
  const base = r.description?.trim() ? r.description.trim() : type.nameSq;
  const where = r.address ? ` – ${r.address}` : '';
  return `${base}${where}`.replace(/\s+/g, ' ').slice(0, 140);
}

const INTAKE_SYSTEM = `You are the intake assistant of the Municipality of Elbasan (Albania) 311 reporting service.
A resident reported a problem or requested a service. Check it and help the municipal department handle it.
Answer ONLY with a JSON object with exactly these keys:
{
  "suggested_type_code": string,            // the best matching code from the list (the chosen one if it fits)
  "priority": "low" | "medium" | "high",    // high: safety risk (open manhole, exposed cable, fallen tree on a road, injured animal, collapsing structure)
                                            // medium: a real problem that affects people; low: cosmetic or non-urgent
  "summary": string,                        // max 120 characters, in Albanian, neutral, no personal data
  "photo": {
    "present": boolean,
    "matches_report": boolean,              // the photo clearly shows the reported problem
    "confidence": integer,                  // 0-100
    "privacy_issue": boolean,               // a face or a licence plate is clearly identifiable
    "reason": string                        // short explanation in English
  }
}`;

/** Background job after a new report: decides the first status, the priority and fills the AI fields. */
export async function runIntakeTriage(reportId: string): Promise<void> {
  const report = await db.report.findUnique({
    where: { id: reportId },
    include: { requestType: true, attachments: { where: { kind: 'BEFORE' }, orderBy: { createdAt: 'asc' }, take: 1 } },
  });
  if (!report || report.status !== 'PENDING') return;

  const type = report.requestType;
  const photo = report.attachments[0] ?? null;
  const types = await activeTypes();
  const rules = ruleBasedTriage(`${report.description ?? ''} ${report.address ?? ''}`, types);
  const createdByStaff = Boolean(report.createdById);
  const ai = config().ai;

  let answer: AiJson | null = null;
  let aiStatus: 'DONE' | 'FAILED' | 'DISABLED' = 'DISABLED';
  let aiError: string | null = null;
  if (aiEnabled()) {
    try {
      const catalogue = types.map((t) => `${t.code}: ${t.nameEn} (${t.kind.toLowerCase()})`).join('\n');
      const userText = `Chosen type: ${type.code} – ${type.nameEn} (${type.kind.toLowerCase()})
Description: ${report.description || '(none)'}
Address: ${report.address || '(none)'}
Photo attached: ${photo ? 'yes' : 'no'}

Available types:
${catalogue}`;
      const images = photo ? [await imageDataUrl(photo)] : [];
      answer = await chatJson({
        kind: 'intake',
        system: INTAKE_SYSTEM,
        userText,
        imageDataUrls: images,
        cacheKey: sha256(`intake:v3:${ai.model}:${type.code}:${report.description}:${report.address}:${photo?.storageKey ?? ''}`),
      });
      aiStatus = 'DONE';
    } catch (err) {
      aiStatus = 'FAILED';
      aiError = err instanceof AiUnavailableError ? err.message : String(err);
    }
  }

  // ---- interpret the answer defensively ----
  const aiPhoto = asObject(answer?.photo);
  const aiTypeCode = asString(answer?.suggested_type_code);
  const suggestedType = (aiTypeCode ? types.find((t) => t.code === aiTypeCode) : null) ?? rules.type;
  const aiPriority = answer ? asPriority(answer.priority) : null;
  const confidence = aiPhoto.present ? clampInt(aiPhoto.confidence, 0, 100) : null;
  const privacyIssue = Boolean(aiPhoto.privacy_issue);
  const photoMatches = Boolean(aiPhoto.matches_report);

  let nextStatus: Status;
  if (createdByStaff || type.kind === 'SERVICE') {
    nextStatus = 'VERIFIED'; // entered by the municipality itself, or a service request that needs no proof
  } else if (aiStatus === 'DONE' && photo) {
    nextStatus = photoMatches && !privacyIssue && (confidence ?? 0) >= ai.verifyThreshold ? 'VERIFIED' : 'NEEDS_REVIEW';
  } else {
    nextStatus = 'NEEDS_REVIEW'; // AI off or failed → a person in the department checks it
  }

  // Staff-created reports keep the priority the admin chose.
  const priority: Priority = createdByStaff ? report.priority : maxPriority(type.defaultPriority, rules.priority, aiPriority);
  const reasonParts: string[] = [];
  if (aiStatus === 'DONE') reasonParts.push(asString(aiPhoto.reason) || 'Kontrolli me AI u krye');
  if (aiStatus === 'FAILED') reasonParts.push(`AI nuk u përgjigj: ${aiError}`);
  if (aiStatus === 'DISABLED') reasonParts.push('AI joaktive; u përdorën rregullat me fjalë kyçe');
  if (confidence !== null && confidence < ai.reviewThreshold) reasonParts.push('Besueshmëri e ulët e fotos');
  if (privacyIssue) reasonParts.push('Fotoja u fsheh nga publiku: mund të duket një fytyrë ose targë');
  const aiSummary = (asString(answer?.summary) || summaryFallback(report, type)).slice(0, 300);
  const reason = reasonParts.join('. ');

  const statusChanged = await db.$transaction(async (tx) => {
    await tx.report.update({
      where: { id: reportId },
      data: {
        aiStatus,
        aiSummary,
        aiConfidence: confidence,
        aiPrivacyIssue: privacyIssue,
        aiSuggestedTypeId: suggestedType && suggestedType.id !== type.id ? suggestedType.id : null,
        aiSuggestedPriority: aiPriority ?? rules.priority,
        aiReason: reason.slice(0, 2000),
      },
    });
    // The AI can take a few seconds. Each change below only applies if nobody
    // changed that value meanwhile: a person's decision always wins.
    const claimed = await tx.report.updateMany({
      where: { id: reportId, status: 'PENDING' },
      data: { status: nextStatus, verifiedAt: nextStatus === 'VERIFIED' ? new Date() : null },
    });
    if (priority !== report.priority) {
      await tx.report.updateMany({ where: { id: reportId, priority: report.priority }, data: { priority } });
    }
    if (privacyIssue && photo) {
      await tx.attachment.update({ where: { id: photo.id }, data: { isPublic: false } });
      await tx.reportEvent.create({
        data: {
          reportId, type: 'PHOTO_VISIBILITY', message: 'Fotoja u fsheh automatikisht (mund të duket fytyrë ose targë).',
          meta: { attachmentId: photo.id, isPublic: false, automatic: true },
        },
      });
    }
    await tx.reportEvent.create({
      data: { reportId, type: 'AI_TRIAGE', message: reason, meta: { aiStatus, confidence, suggestedTypeCode: suggestedType?.code ?? null, priority } },
    });
    if (claimed.count === 0) return false;
    await tx.reportEvent.create({
      data: { reportId, type: 'STATUS_CHANGED', fromStatus: 'PENDING', toStatus: nextStatus, isPublic: nextStatus === 'VERIFIED' },
    });
    return true;
  });

  if (statusChanged) await notifyDepartmentOfReport(reportId, 'new');
}

/** Reports still PENDING after `minutes` (a job was lost): run their check again. Used by the daily job. */
export async function stuckPendingReports(minutes = 10): Promise<string[]> {
  const rows = await db.report.findMany({
    where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - minutes * 60_000) } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return rows.map((r) => r.id);
}

const EXTRACT_SYSTEM = `You help staff of the Municipality of Elbasan turn a message from a resident
(Facebook message, email, phone note, in Albanian or English) into a structured report.
Answer ONLY with a JSON object:
{
  "type_code": string,                     // best matching code from the list
  "description": string,                   // clean description in Albanian, max 500 characters, no personal data
  "address": string,                       // street, landmark or area mentioned, or ""
  "summary": string,                       // max 120 characters, Albanian
  "priority": "low" | "medium" | "high",
  "contact_name": string,                  // if the message contains it, else ""
  "contact_phone": string                  // if the message contains it, else ""
}`;

export interface ExtractedReport {
  source: 'ai' | 'rules';
  requestTypeId: number | null;
  requestTypeCode: string | null;
  description: string;
  address: string;
  summary: string;
  priority: Priority;
  contactName: string;
  contactPhone: string;
}

/** "Raportim i ri": paste a Facebook message or a phone note, get a pre-filled report. */
export async function extractFromText(text: string): Promise<ExtractedReport> {
  const types = await activeTypes();
  const rules = ruleBasedTriage(text, types);
  const fallback: ExtractedReport = {
    source: 'rules',
    requestTypeId: rules.type?.id ?? null,
    requestTypeCode: rules.type?.code ?? null,
    // The description becomes public once verified: never copy contact details into it.
    description: (maskContacts(text.trim()) ?? '').slice(0, 2000),
    address: '',
    summary: text.trim().replace(/\s+/g, ' ').slice(0, 120),
    priority: maxPriority(rules.type?.defaultPriority ?? 'MEDIUM', rules.priority),
    contactName: '',
    contactPhone: '',
  };
  if (!aiEnabled()) return fallback;
  try {
    const out = await chatJson({
      kind: 'extract',
      system: EXTRACT_SYSTEM,
      userText: `Message:\n"""${text}"""\n\nAvailable types:\n${types.map((t) => `${t.code}: ${t.nameEn}`).join('\n')}`,
      cacheKey: sha256(`extract:v3:${config().ai.model}:${text}`),
    });
    const type = types.find((t) => t.code === asString(out.type_code)) ?? rules.type;
    return {
      source: 'ai',
      requestTypeId: type?.id ?? null,
      requestTypeCode: type?.code ?? null,
      description: (maskContacts(asString(out.description)) || fallback.description).slice(0, 2000),
      address: asString(out.address).slice(0, 300),
      summary: (asString(out.summary) || fallback.summary).slice(0, 120),
      priority: asPriority(out.priority) ?? fallback.priority,
      contactName: asString(out.contact_name).slice(0, 160),
      contactPhone: asString(out.contact_phone).replace(/[^0-9 +()-]/g, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim().slice(0, 40),
    };
  } catch {
    return fallback;
  }
}

const CLOSING_SYSTEM = `You compare two photos of the same place in Elbasan: BEFORE (the reported problem)
and AFTER (taken by municipal staff when closing the report).
Answer ONLY with JSON: {"fixed": boolean, "confidence": integer 0-100, "reason": string (short, English)}`;

/** Background job after a department resolves a report with an "after" photo: does it look fixed? */
export async function runClosingCheck(reportId: string): Promise<void> {
  if (!aiEnabled()) return;
  const report = await db.report.findUnique({
    where: { id: reportId },
    include: { attachments: { orderBy: { createdAt: 'asc' } }, requestType: true },
  });
  if (!report) return;
  const before = report.attachments.find((a) => a.kind === 'BEFORE');
  const after = [...report.attachments].reverse().find((a) => a.kind === 'AFTER');
  if (!before || !after) return;
  try {
    const out = await chatJson({
      kind: 'closing',
      system: CLOSING_SYSTEM,
      userText: `Reported problem: ${report.requestType.nameEn}. First image = BEFORE, second image = AFTER.`,
      imageDataUrls: [await imageDataUrl(before), await imageDataUrl(after)],
      cacheKey: sha256(`closing:v3:${config().ai.model}:${before.storageKey}:${after.storageKey}`),
    });
    const fixed = Boolean(out.fixed);
    const confidence = clampInt(out.confidence, 0, 100);
    await db.$transaction([
      db.report.update({ where: { id: reportId }, data: { closingAiFixed: fixed, closingAiConfidence: confidence } }),
      db.reportEvent.create({
        data: {
          reportId,
          type: 'AI_CLOSING_CHECK',
          message: `${fixed ? 'Duket e rregulluar' : 'NUK duket e rregulluar'} (${confidence ?? '?'}%). ${asString(out.reason)}`.trim(),
          meta: { fixed, confidence },
        },
      }),
    ]);
  } catch (err) {
    await db.reportEvent.create({
      data: { reportId, type: 'AI_CLOSING_CHECK', message: `Kontrolli me AI nuk u krye: ${err instanceof Error ? err.message : String(err)}` },
    });
  }
}
