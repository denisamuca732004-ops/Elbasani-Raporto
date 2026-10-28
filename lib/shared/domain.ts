/**
 * The vocabulary of the platform: statuses, roles, priorities, channels.
 * Safe to import from both server and browser code. The values are the same
 * as the PostgreSQL enums in prisma/schema.prisma (checked at compile time in
 * lib/server/db.ts).
 */

export const ROLES = ['USER', 'MUNICIPALITY_STAFF', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];
/** Roles that may open the /admin panel. */
export const PANEL_ROLES: readonly Role[] = ['MUNICIPALITY_STAFF', 'ADMIN'];
export type PanelRole = 'MUNICIPALITY_STAFF' | 'ADMIN';

export const STATUSES = [
  'PENDING', // just received, the automatic check has not finished
  'NEEDS_REVIEW', // a person must verify it
  'VERIFIED', // confirmed, waiting for the department to start
  'ASSIGNED', // a person in the department is responsible
  'IN_PROGRESS', // work has started
  'RESOLVED', // work done, waiting for the resident (or auto-close)
  'CLOSED', // final
  'REJECTED', // final, with a reason the resident can read
] as const;
export type Status = (typeof STATUSES)[number];

export const OPEN_STATUSES: readonly Status[] = ['PENDING', 'NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS'];
export const FINAL_STATUSES: readonly Status[] = ['CLOSED', 'REJECTED'];
/** Shown on the public map and feed. Unverified reports stay private. */
export const PUBLIC_LISTED_STATUSES: readonly Status[] = ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

/** The normal workflow of a department head. The admin may set any status except PENDING. */
export const STATUS_TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  PENDING: ['NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REJECTED'],
  NEEDS_REVIEW: ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REJECTED'],
  VERIFIED: ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  ASSIGNED: ['VERIFIED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  IN_PROGRESS: ['ASSIGNED', 'RESOLVED', 'REJECTED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
  REJECTED: [],
};
export const ADMIN_SETTABLE_STATUSES: readonly Status[] = STATUSES.filter((s) => s !== 'PENDING');

export const PUBLIC_STATUSES = ['RECEIVED', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED'] as const;
export type PublicStatus = (typeof PUBLIC_STATUSES)[number];

/** The simplified status residents see. */
export function publicStatusOf(status: Status): PublicStatus {
  if (status === 'PENDING' || status === 'NEEDS_REVIEW') return 'RECEIVED';
  if (status === 'VERIFIED' || status === 'ASSIGNED') return 'OPEN';
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (status === 'RESOLVED') return 'RESOLVED';
  if (status === 'CLOSED') return 'CLOSED';
  return 'REJECTED';
}

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = { LOW: 1, MEDIUM: 2, HIGH: 3 };
/** The highest of the given priorities (missing values are ignored). */
export function maxPriority(...values: Array<Priority | null | undefined>): Priority {
  return values.reduce<Priority>((best, p) => (p && PRIORITY_RANK[p] > PRIORITY_RANK[best] ? p : best), 'LOW');
}

export const REQUEST_KINDS = ['PROBLEM', 'SERVICE'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const CITIZEN_CHANNELS = ['WEB', 'APP', 'EMBED'] as const;
export const STAFF_CHANNELS = ['IN_PERSON', 'PHONE', 'FACEBOOK', 'EMAIL'] as const;
export const CHANNELS = [...CITIZEN_CHANNELS, ...STAFF_CHANNELS] as const;
export type Channel = (typeof CHANNELS)[number];
export type StaffChannel = (typeof STAFF_CHANNELS)[number];

export const AI_STATUSES = ['PENDING', 'DONE', 'FAILED', 'DISABLED'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const ATTACHMENT_KINDS = ['BEFORE', 'AFTER'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const TRANSFER_STATUSES = ['PENDING', 'APPROVED', 'DECLINED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const EVENT_TYPES = [
  'CREATED',
  'STATUS_CHANGED',
  'ASSIGNED',
  'ROUTING_CHANGED',
  'PRIORITY_CHANGED',
  'DETAILS_UPDATED',
  'AI_TRIAGE',
  'AI_CLOSING_CHECK',
  'NOTE',
  'MESSAGE_TO_CITIZEN',
  'FOLLOWER_ADDED',
  'CITIZEN_CONFIRMED',
  'CITIZEN_REOPENED',
  'PHOTO_VISIBILITY',
  'TRANSFER_REQUESTED',
  'TRANSFER_APPROVED',
  'TRANSFER_DECLINED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const MAIL_STATUSES = ['QUEUED', 'SENDING', 'LOGGED', 'SENT', 'FAILED'] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

/** Where the button under a guide answer leads (see GUIDE_ACTION_HREF in lib/shared/guide.ts). */
export const GUIDE_ACTIONS = ['NONE', 'REPORT', 'TRACK', 'MAP', 'STATS', 'PRIVACY', 'CALL_112'] as const;
export type GuideAction = (typeof GUIDE_ACTIONS)[number];

export const DASHBOARD_PERIODS = ['week', 'month', 'year'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** Report form limits, shared by the browser and the server. */
export const LIMITS = {
  minDescription: 10,
  maxDescription: 4000,
  minAddress: 3,
  maxAddress: 300,
  minRejectReason: 5,
  minTransferReason: 10,
  minDeclineNote: 3,
  minPassword: 8,
} as const;

/** The Municipality of Elbasan with a margin, used when the server does not send its own box. */
export const DEFAULT_SERVICE_AREA = { minLat: 40.85, minLng: 19.75, maxLat: 41.35, maxLng: 20.45 } as const;
export type ServiceArea = { minLat: number; minLng: number; maxLat: number; maxLng: number };

export function insideArea(lat: number, lng: number, area: ServiceArea = DEFAULT_SERVICE_AREA): boolean {
  return lat >= area.minLat && lat <= area.maxLat && lng >= area.minLng && lng <= area.maxLng;
}
