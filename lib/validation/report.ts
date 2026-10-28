/**
 * Zod schemas for everything that changes a report. Every Server Action
 * parses its input with one of these before the database is touched.
 */
import { z } from 'zod';
import {
  ADMIN_SETTABLE_STATUSES, CITIZEN_CHANNELS, DASHBOARD_PERIODS, LIMITS, PRIORITIES, STAFF_CHANNELS, STATUSES, TRANSFER_STATUSES,
} from '@/lib/shared/domain';
import {
  flag, id, latitude, longitude, nullableId, optionalEmail, optionalText, phone, requiredText, singleLine, uuid,
} from './zod';

export const priority = z.enum(PRIORITIES);
export const status = z.enum(STATUSES);

/** Key of a photo uploaded with actions/upload.ts and not yet attached to a report. */
export const uploadKey = z.string().regex(/^tmp\/[0-9a-f-]{36}\.(jpg|png|webp)$/);

/* ─── Citizen report (all steps mandatory, checked field by field in the service) ─── */

/**
 * How the resident gives the place:
 *  - map:     GPS or a tap on the map. The zone is found from the point; the text is an optional landmark.
 *  - address: zone → lagje/village of THAT zone → street, number or landmark. No point on the map.
 * Reports queued offline by an older version of the app have no mode: they are "map" reports.
 */
export const LOCATION_MODES = ['map', 'address'] as const;
export type LocationMode = (typeof LOCATION_MODES)[number];

/** Shape only. The service adds the rules that need the database and returns every problem with its wizard step. */
export const citizenReportShape = z.strictObject({
  requestTypeId: id,
  locationMode: z.enum(LOCATION_MODES).default('map'),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  address: z.string().max(LIMITS.maxAddress).default(''),
  neighbourhoodId: id.optional(),
  localityId: id.optional(),
  description: z.string().max(LIMITS.maxDescription),
  anonymous: z.boolean(),
  contactName: z.string().max(160).optional(),
  contactEmail: z.string().max(200).optional(),
  contactPhone: z.string().max(40).optional(),
  photoKey: uploadKey,
  channel: z.enum(CITIZEN_CHANNELS).default('WEB'),
  clientRef: z.string().max(64).optional(),
});
export type CitizenReportInput = z.input<typeof citizenReportShape>;

/** A report recorded by the admin for a resident who called, wrote or came in person. */
export const staffReportSchema = z.strictObject({
  requestTypeId: id,
  channel: z.enum(STAFF_CHANNELS),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  address: optionalText(LIMITS.maxAddress),
  neighbourhoodId: nullableId.optional(),
  description: requiredText(LIMITS.minDescription, LIMITS.maxDescription),
  priority: priority.optional(),
  contactName: optionalText(160),
  contactEmail: optionalEmail,
  contactPhone: phone,
  photoKey: uploadKey.optional(),
}).refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
  path: ['latitude'], message: 'Vendosni të dyja koordinatat ose asnjërën.',
});
export type StaffReportInput = z.output<typeof staffReportSchema>;

/* ─── Working on a report ─── */

/** Admin only: edit any detail. */
export const reportUpdateSchema = z.strictObject({
  requestTypeId: id.optional(),
  departmentId: nullableId.optional(),
  priority: priority.optional(),
  neighbourhoodId: nullableId.optional(),
  description: requiredText(LIMITS.minDescription, LIMITS.maxDescription).optional(),
  address: singleLine(LIMITS.minAddress, LIMITS.maxAddress).optional(),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'Nuk ka asnjë ndryshim.' })
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), { path: ['latitude'], message: 'Vendosni të dyja koordinatat.' });
export type ReportUpdateInput = z.output<typeof reportUpdateSchema>;

export const statusChangeSchema = z.strictObject({
  status,
  note: optionalText(2000),
  publicNote: z.boolean().default(true),
});
export type StatusChangeInput = z.output<typeof statusChangeSchema>;

/** The statuses an admin can choose in the "set any status" control. */
export const adminStatus = z.enum(ADMIN_SETTABLE_STATUSES as [string, ...string[]]);

export const prioritySchema = z.strictObject({ priority });
export const assignSchema = z.strictObject({ userId: uuid.nullable() });
export const noteSchema = z.strictObject({ message: requiredText(1, 2000) });
export const messageSchema = z.strictObject({ message: requiredText(1, 2000) });
export const rejectSchema = z.strictObject({ reason: requiredText(LIMITS.minRejectReason, 1000) });
export const resolveSchema = z.strictObject({ note: optionalText(2000), photoKey: uploadKey.optional() });
export const photoVisibilitySchema = z.strictObject({ isPublic: z.boolean() });
export const testFlagSchema = z.strictObject({ isTest: z.boolean() });
export const extractSchema = z.strictObject({ text: requiredText(3, 5000) });

export const transferRequestSchema = z.strictObject({
  reason: requiredText(LIMITS.minTransferReason, 1000),
  suggestedDepartmentId: nullableId.optional(),
});
export type TransferRequestInput = z.output<typeof transferRequestSchema>;

export const transferDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approve'), toDepartmentId: id.optional(), note: optionalText(1000) }),
  z.strictObject({ decision: z.literal('decline'), note: requiredText(LIMITS.minDeclineNote, 1000) }),
]);
export type TransferDecisionInput = z.output<typeof transferDecisionSchema>;

/* ─── Lists, counts, export (from the URL, so values arrive as strings) ─── */

const csvStatuses = z
  .string()
  .max(200)
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const out = new Set<z.infer<typeof status>>();
    for (const raw of v.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) {
      if (raw === 'OPEN') ['PENDING', 'NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS'].forEach((s) => out.add(s as never));
      else if (raw === 'DONE') ['RESOLVED', 'CLOSED', 'REJECTED'].forEach((s) => out.add(s as never));
      else if (raw === 'ALL') return undefined;
      else if ((STATUSES as readonly string[]).includes(raw)) out.add(raw as never);
      else {
        ctx.addIssue({ code: 'custom', message: `Status i panjohur: ${raw}`, params: { code: 'invalid' } });
        return z.NEVER;
      }
    }
    return [...out];
  });

export const reportFiltersSchema = z.object({
  status: csvStatuses,
  priority: priority.optional(),
  departmentId: id.optional(),
  unrouted: flag.optional(),
  categoryId: id.optional(),
  neighbourhoodId: id.optional(),
  overdue: flag.optional(),
  assignedToMe: flag.optional(),
  transferPending: flag.optional(),
  includeTest: flag.optional(),
  q: optionalText(100),
});
export type ReportFilters = z.output<typeof reportFiltersSchema>;

export const reportListSchema = reportFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['newest', 'oldest', 'due', 'priority']).default('priority'),
});
export type ReportListQuery = z.output<typeof reportListSchema>;

export const exportSchema = reportFiltersSchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type ExportQuery = z.output<typeof exportSchema>;

export const dashboardSchema = z.object({
  period: z.enum(DASHBOARD_PERIODS).default('month'),
  departmentId: id.optional(),
  includeTest: flag.optional(),
});
export type DashboardQuery = z.output<typeof dashboardSchema>;

export const transferListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(TRANSFER_STATUSES).optional(),
});
export type TransferListQuery = z.output<typeof transferListSchema>;

/* ─── Public (no account) ─── */

export const caseNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,6}-\d{4}-\d{5,}$/);

export const nearbySchema = z.strictObject({ requestTypeId: id, latitude, longitude });
/** Home page search: a street, an area or a problem ("gropë Rinia"). */
export const placeSearchSchema = z.strictObject({ q: requiredText(3, 100) });
export const followSchema = z.strictObject({ caseNumber, email: optionalEmail });
export const feedbackSchema = z.strictObject({
  token: z.string().min(16).max(128),
  action: z.enum(['confirm', 'reopen']),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  comment: optionalText(1000),
});
export type FeedbackInput = z.output<typeof feedbackSchema>;

export const recentSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['open', 'closed', 'all']).default('all'),
  category: optionalText(60),
  q: optionalText(100),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
});
export type RecentQuery = z.output<typeof recentSchema>;

export const mapSchema = z.object({
  status: z.enum(['open', 'closed', 'all']).default('all'),
  category: optionalText(60),
  days: z.coerce.number().int().min(1).max(730).default(180),
});
export type MapQuery = z.output<typeof mapSchema>;
