'use server';
/**
 * Server Actions for reports.
 *
 * Security, in this order, in every action:
 *  1. Role check: requireStaff() / requireAdmin() read the encrypted session
 *     cookie and check the account in the database (active, same session
 *     version, MUNICIPALITY_STAFF or ADMIN). Public actions (a resident
 *     reporting, following or confirming) are rate-limited per IP instead.
 *  2. Zod validation of every value that came from the browser
 *     (lib/validation/report.ts): statuses, priorities and ids must be exactly
 *     the allowed values or the action stops here.
 *  3. The service (lib/server/services/*) does the work with Prisma inside a
 *     transaction: access to the department is checked again, photos are
 *     taken from Vercel Blob and cleaned, and emails are written to the log
 *     and handed to Upstash QStash, so this response never waits for them.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { placeAt, searchPlaces } from '@/lib/server/geocoder';
import { checkFormGuard, issueFormToken } from '@/lib/server/botGuard';
import { enforceRateLimit } from '@/lib/server/ratelimit';
import { requireAdmin, requireStaff } from '@/lib/server/session';
import * as publicReports from '@/lib/server/services/publicReport';
import * as duplicates from '@/lib/server/services/duplicates';
import * as reports from '@/lib/server/services/report';
import * as transfers from '@/lib/server/services/transfer';
import { checkDescription } from '@/lib/server/services/descriptionCheck';
import { draftNote } from '@/lib/server/services/noteDraft';
import { analyzePhoto } from '@/lib/server/services/photoAnalyze';
import { checkPhoto } from '@/lib/server/services/photoCheck';
import { extractFromText } from '@/lib/server/services/triage';
import {
  assignSchema, descriptionCheckSchema, extractSchema, feedbackSchema, followSchema, messageSchema, nearbySchema, noteSchema, photoAnalyzeSchema, photoCheckSchema,
  photoVisibilitySchema, placeQuerySchema, placeSearchSchema, pointSchema, trackSearchSchema,
  prioritySchema, rejectSchema, reportUpdateSchema, resolveSchema, staffReportSchema, statusChangeSchema, testFlagSchema,
  transferDecisionSchema, transferRequestSchema,
} from '@/lib/validation/report';
import { clientIp, parseInput, run } from './_shared';

const reportId = z.uuid();

function refreshPanel(id?: string) {
  revalidatePath('/admin', 'layout');
  if (id) revalidatePath(`/admin/reports/${id}`);
}

/* ─────────────── Residents (no account) ─────────────── */

/** The signed token of the report form, asked for when the form opens (lib/server/botGuard.ts). */
export async function reportFormTokenAction() {
  return run(async () => ({ token: issueFormToken() }));
}

/**
 * Creates a report only when every step is complete (the service checks each field and returns the wizard step).
 * Against scripts: the hidden field, the form token and its age, and limits per address and per token.
 */
export async function createReportAction(input: unknown) {
  return run(async () => {
    const ip = await clientIp();
    await enforceRateLimit('report', ip);
    await enforceRateLimit('reportDay', ip);
    const { website, formToken, ...data } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    checkFormGuard({ website, formToken });
    await enforceRateLimit('reportToken', String(formToken));
    return publicReports.createCitizenReport(data);
  });
}

/**
 * The photo step: checks the photo as soon as it is chosen (only with the AI on).
 * Answers "ok", "unrelated" (the form asks the resident to confirm), "inappropriate"
 * (the form asks for another photo; sending the report with it is refused) or "unchecked".
 */
export async function checkPhotoAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('photoCheck', await clientIp());
    const data = parseInput(photoCheckSchema, input);
    return checkPhoto(data.photoKey, data.requestTypeId);
  });
}

/**
 * "Raporto me foto": the AI proposes the type and a description from the photo (only with the AI on).
 * Also answers "inappropriate" / "not_photo" (the form asks for another photo) or "unchecked" (no proposal).
 */
export async function analyzePhotoAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('photoAnalyze', await clientIp());
    return analyzePhoto(parseInput(photoAnalyzeSchema, input).photoKey);
  });
}

/**
 * The description step: checks the text when the resident presses "Vazhdo". Answers "ok",
 * "unrelated" (the form asks to change the type or confirm), "gibberish" or "abusive"
 * (the form asks to rewrite it; sending the report with it is refused) or "unchecked".
 */
export async function checkDescriptionAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('textCheck', await clientIp());
    const data = parseInput(descriptionCheckSchema, input);
    return checkDescription(data.description, data.requestTypeId);
  });
}

export async function findNearbyAction(input: unknown) {
  return run(async () => publicReports.findNearbyOpen(parseInput(nearbySchema, input)));
}

/** "Vendndodhja" of the report form: streets and places of the Municipality (OpenStreetMap) for what was typed. */
export async function searchPlacesAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('geocode', await clientIp());
    return searchPlaces(parseInput(placeQuerySchema, input).q);
  });
}

/** The street at the point where the resident put or dragged the pin (fills "Vendndodhja"). */
export async function placeAtAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('geocode', await clientIp());
    const { latitude, longitude } = parseInput(pointSchema, input);
    return placeAt(latitude, longitude);
  });
}

/** "Ndiq raportimin" without the number: by date, zone, category, or name + phone. */
export async function findReportsAction(input: unknown) {
  return run(async () => {
    const ip = await clientIp();
    await enforceRateLimit('search', ip);
    const query = parseInput(trackSearchSchema, input);
    if (query.name && query.phone) await enforceRateLimit('trackContact', ip);
    return publicReports.findReports(query);
  });
}

/** Home page search: open reports on a street or in an area, so residents see what is already reported. */
export async function searchOpenReportsAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('search', await clientIp());
    return publicReports.searchOpenByPlace(parseInput(placeSearchSchema, input).q);
  });
}

export async function followReportAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('follow', await clientIp());
    const data = parseInput(followSchema, input);
    return publicReports.followReport(data.caseNumber);
  });
}

export async function submitFeedbackAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('feedback', await clientIp());
    return publicReports.submitCitizenFeedback(parseInput(feedbackSchema, input));
  });
}

/* ─────────────── Department heads and the admin ─────────────── */

export async function changeStatusAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    const result = await reports.changeStatus(user, parseInput(reportId, id), parseInput(statusChangeSchema, input));
    refreshPanel(id);
    return result;
  });
}

export async function changePriorityAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    const result = await reports.changePriority(user, parseInput(reportId, id), parseInput(prioritySchema, input).priority);
    refreshPanel(id);
    return result;
  });
}

export async function assignReportAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    const result = await reports.assignReport(user, parseInput(reportId, id), parseInput(assignSchema, input).userId);
    refreshPanel(id);
    return result;
  });
}

export async function addNoteAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    return reports.addNote(user, parseInput(reportId, id), parseInput(noteSchema, input).message);
  });
}

export async function messageCitizenAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    return reports.messageCitizen(user, parseInput(reportId, id), parseInput(messageSchema, input).message);
  });
}

export async function rejectReportAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    const result = await reports.rejectReport(user, parseInput(reportId, id), parseInput(rejectSchema, input));
    refreshPanel(id);
    return result;
  });
}

/** Resolves a report, optionally with an "after" photo uploaded through actions/upload.ts. */
export async function resolveReportAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    const result = await reports.resolveReport(user, parseInput(reportId, id), parseInput(resolveSchema, input));
    refreshPanel(id);
    return result;
  });
}

export async function setPhotoVisibilityAction(attachmentId: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    return reports.setPhotoVisibility(user, parseInput(z.uuid(), attachmentId), parseInput(photoVisibilitySchema, input).isPublic);
  });
}

/** "Not our department": the department head asks the admin to move the report. */
export async function requestTransferAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    const result = await transfers.requestTransfer(user, parseInput(reportId, id), parseInput(transferRequestSchema, input));
    refreshPanel(id);
    return result;
  });
}

/* ─────────────── Admin only ─────────────── */

export async function decideTransferAction(transferId: string, input: unknown) {
  return run(async () => {
    const user = await requireAdmin();
    const result = await transfers.decideTransfer(user, parseInput(z.uuid(), transferId), parseInput(transferDecisionSchema, input));
    refreshPanel(result.report.id);
    return result;
  });
}

export async function updateReportAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireAdmin();
    const result = await reports.updateReport(user, parseInput(reportId, id), parseInput(reportUpdateSchema, input));
    refreshPanel(id);
    return result;
  });
}

export async function deleteReportAction(id: string) {
  return run(async () => {
    const user = await requireAdmin();
    const result = await reports.deleteReport(user, parseInput(reportId, id));
    refreshPanel();
    return result;
  });
}

/** Admin: e-mail the report again to its sector that works by e-mail. */
export async function resendToSectorAction(id: string) {
  return run(async () => {
    const user = await requireAdmin();
    const result = await reports.resendToSector(user, parseInput(reportId, id));
    refreshPanel(id);
    return result;
  });
}

export async function setTestFlagAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireAdmin();
    const result = await reports.setTestFlag(user, parseInput(reportId, id), parseInput(testFlagSchema, input).isTest);
    refreshPanel(id);
    return result;
  });
}

/** A report taken by phone, Facebook, email or at the office. */
export async function createStaffReportAction(input: unknown) {
  return run(async () => {
    const user = await requireAdmin();
    const result = await reports.createStaffReport(user, parseInput(staffReportSchema, input));
    refreshPanel();
    return result;
  });
}

/** Turns a pasted message into a pre-filled report (AI when enabled, keyword rules otherwise). */
export async function extractReportAction(input: unknown) {
  return run(async () => {
    await requireAdmin();
    return extractFromText(parseInput(extractSchema, input).text);
  });
}

/** Admin: the same problem as an earlier report — close this one and join it to the other (by default the suggested one). */
export async function mergeDuplicateAction(id: string, intoCaseNumber?: string) {
  return run(async () => {
    const user = await requireAdmin();
    const result = await duplicates.mergeDuplicate(user, parseInput(reportId, id), intoCaseNumber ? parseInput(z.string().trim().max(32), intoCaseNumber) : undefined);
    refreshPanel(id);
    return result;
  });
}

/** Admin: not the same problem after all — send it to its sector now. */
export async function dismissDuplicateAction(id: string) {
  return run(async () => {
    const user = await requireAdmin();
    await duplicates.dismissDuplicate(user, parseInput(reportId, id));
    refreshPanel(id);
    return { ok: true };
  });
}

const draftSchema = z.strictObject({ kind: z.enum(['resolve', 'reject', 'message']), notes: z.string().max(1000).default('') });

/** Panel: the AI proposes the note for the resident (fixed, refused, message). The person edits and sends it. */
export async function draftNoteAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    await enforceRateLimit('draft', user.id);
    const data = parseInput(draftSchema, input);
    return draftNote(user, parseInput(reportId, id), data.kind, data.notes);
  });
}
