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
import { enforceRateLimit } from '@/lib/server/ratelimit';
import { requireAdmin, requireStaff } from '@/lib/server/session';
import * as publicReports from '@/lib/server/services/publicReport';
import * as reports from '@/lib/server/services/report';
import * as transfers from '@/lib/server/services/transfer';
import { extractFromText } from '@/lib/server/services/triage';
import {
  assignSchema, extractSchema, feedbackSchema, followSchema, messageSchema, nearbySchema, noteSchema, photoVisibilitySchema, placeSearchSchema,
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

/** Creates a report only when every step is complete (the service checks each field and returns the wizard step). */
export async function createReportAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('report', await clientIp());
    return publicReports.createCitizenReport(input);
  });
}

export async function findNearbyAction(input: unknown) {
  return run(async () => publicReports.findNearbyOpen(parseInput(nearbySchema, input)));
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
    return publicReports.followReport(data.caseNumber, data.email);
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
