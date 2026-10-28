'use server';
/**
 * Server Actions for administration. Every action starts with requireAdmin():
 * a department head (MUNICIPALITY_STAFF) gets 403 even if they call it directly.
 * Inputs are validated with Zod (lib/validation/admin.ts); changes to the
 * catalogue and the departments clear the Redis cache (services/catalog.ts).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/session';
import * as admin from '@/lib/server/services/admin';
import { runDaily } from '@/lib/server/services/maintenance';
import * as users from '@/lib/server/services/users';
import {
  categoryPatchSchema, categorySchema, departmentPatchSchema, departmentSchema, neighbourhoodPatchSchema, neighbourhoodSchema,
  requestTypePatchSchema, requestTypeSchema, settingsSchema, userCreateSchema, userPatchSchema,
} from '@/lib/validation/admin';
import { parseInput, run } from './_shared';

const intId = z.coerce.number().int().min(1);

function refresh(path: string) {
  revalidatePath(path);
  revalidatePath('/admin', 'layout');
}

/* ── Departments ── */

export async function createDepartmentAction(input: unknown) {
  return run(async () => {
    const result = await admin.createDepartment(await requireAdmin(), parseInput(departmentSchema, input));
    refresh('/admin/departments');
    return result;
  });
}

export async function updateDepartmentAction(id: unknown, input: unknown) {
  return run(async () => {
    const result = await admin.updateDepartment(await requireAdmin(), parseInput(intId, id), parseInput(departmentPatchSchema, input));
    refresh('/admin/departments');
    return result;
  });
}

/* ── Categories and report types ── */

export async function createCategoryAction(input: unknown) {
  return run(async () => {
    const result = await admin.createCategory(await requireAdmin(), parseInput(categorySchema, input));
    refresh('/admin/report-types');
    return result;
  });
}

export async function updateCategoryAction(id: unknown, input: unknown) {
  return run(async () => {
    const result = await admin.updateCategory(await requireAdmin(), parseInput(intId, id), parseInput(categoryPatchSchema, input));
    refresh('/admin/report-types');
    return result;
  });
}

export async function createRequestTypeAction(input: unknown) {
  return run(async () => {
    const result = await admin.createRequestType(await requireAdmin(), parseInput(requestTypeSchema, input));
    refresh('/admin/report-types');
    return result;
  });
}

export async function updateRequestTypeAction(id: unknown, input: unknown) {
  return run(async () => {
    const result = await admin.updateRequestType(await requireAdmin(), parseInput(intId, id), parseInput(requestTypePatchSchema, input));
    refresh('/admin/report-types');
    return result;
  });
}

/* ── Areas ── */

export async function createNeighbourhoodAction(input: unknown) {
  return run(async () => {
    const result = await admin.createNeighbourhood(await requireAdmin(), parseInput(neighbourhoodSchema, input));
    refresh('/admin/areas');
    return result;
  });
}

export async function updateNeighbourhoodAction(id: unknown, input: unknown) {
  return run(async () => {
    const result = await admin.updateNeighbourhood(await requireAdmin(), parseInput(intId, id), parseInput(neighbourhoodPatchSchema, input));
    refresh('/admin/areas');
    return result;
  });
}

/* ── Accounts ── */

export async function createUserAction(input: unknown) {
  return run(async () => {
    const result = await users.createUser(await requireAdmin(), parseInput(userCreateSchema, input));
    refresh('/admin/users');
    return result;
  });
}

export async function updateUserAction(id: unknown, input: unknown) {
  return run(async () => {
    const result = await users.updateUser(await requireAdmin(), parseInput(z.uuid(), id), parseInput(userPatchSchema, input));
    refresh('/admin/users');
    return result;
  });
}

export async function resetPasswordAction(id: unknown) {
  return run(async () => {
    const result = await users.resetPassword(await requireAdmin(), parseInput(z.uuid(), id));
    refresh('/admin/users');
    return result;
  });
}

/* ── Appearance ── */

export async function saveSettingsAction(input: unknown) {
  return run(async () => {
    const result = await admin.saveSettings(await requireAdmin(), parseInput(settingsSchema, input));
    revalidatePath('/', 'layout');
    return result;
  });
}

/* ── Demo data and maintenance ── */

export async function loadDemoDataAction() {
  return run(async () => {
    const result = await admin.loadSampleData(await requireAdmin());
    refresh('/admin/demo');
    return result;
  });
}

export async function deleteDemoDataAction() {
  return run(async () => {
    const result = await admin.deleteSampleData(await requireAdmin());
    refresh('/admin/demo');
    return result;
  });
}

export async function runDailyJobAction() {
  return run(async () => {
    await requireAdmin();
    const result = await runDaily();
    refresh('/admin/demo');
    return result;
  });
}
