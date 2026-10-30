/**
 * The status "views" of the report list (tabs above the table). The address
 * carries the view name (?status=review); the server turns it into the
 * exact statuses before validation.
 */
import { OPEN_STATUSES, STATUSES, type Status } from './domain';
export const STATUS_VIEWS = {
  open: 'open',
  review: 'PENDING,NEEDS_REVIEW',
  work: 'ASSIGNED,IN_PROGRESS',
  resolved: 'RESOLVED',
  done: 'CLOSED,REJECTED',
  all: 'all',
} as const;
export type StatusView = keyof typeof STATUS_VIEWS;
export const STATUS_VIEW_NAMES = Object.keys(STATUS_VIEWS) as StatusView[];
export const isStatusView = (v: unknown): v is StatusView => typeof v === 'string' && v in STATUS_VIEWS;

export const REPORT_SORTS = ['priority', 'newest', 'oldest', 'due'] as const;
export type ReportSort = (typeof REPORT_SORTS)[number];

/** The statuses inside a view ("all" = every status). */
export function viewStatuses(view: StatusView): readonly Status[] {
  const value: string = STATUS_VIEWS[view];
  if (value === 'all') return STATUSES;
  if (value === 'open') return OPEN_STATUSES;
  return value.split(',') as Status[];
}

/** How many reports a status tab holds, from the count of each status. */
export function viewCount(view: StatusView, counts: Partial<Record<Status, number>>): number {
  return viewStatuses(view).reduce((sum, s) => sum + (counts[s] ?? 0), 0);
}
