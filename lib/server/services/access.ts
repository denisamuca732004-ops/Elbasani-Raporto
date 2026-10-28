/**
 * Who may see and change what.
 *  - ADMIN: every report, every department, every setting.
 *  - MUNICIPALITY_STAFF: only the reports routed to their own department.
 */
import 'server-only';
import type { Prisma } from '@/lib/generated/prisma/client';
import type { Principal } from '@/lib/shared/types';
import { forbidden } from '../errors';

export const isAdmin = (user: Principal): boolean => user.role === 'ADMIN';

/** Extra WHERE conditions on reports for the current user. */
export function reportScope(user: Principal): Prisma.ReportWhereInput {
  if (isAdmin(user)) return {};
  // A department head without a department sees nothing (-1 never matches).
  return { departmentId: user.departmentId ?? -1 };
}

export function canAccessReport(user: Principal, report: { departmentId: number | null }): boolean {
  return isAdmin(user) || (user.departmentId !== null && report.departmentId === user.departmentId);
}

export function assertCanAccessReport(user: Principal, report: { departmentId: number | null }): void {
  if (!canAccessReport(user, report)) throw forbidden('Ky raportim i përket një sektori tjetër.');
}

export function assertAdmin(user: Principal): void {
  if (!isAdmin(user)) throw forbidden('Vetëm administratori mund ta bëjë këtë veprim.');
}

export function assertDepartmentStaff(user: Principal): void {
  if (user.role !== 'MUNICIPALITY_STAFF' || !user.departmentId) {
    throw forbidden('Këtë veprim e bën përgjegjësi i sektorit.');
  }
}
