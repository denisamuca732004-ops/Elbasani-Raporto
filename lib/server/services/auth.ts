/**
 * Accounts and sign-in of the STAFF. (Residents may have an optional account of
 * their own, with Google or email + password: services/residents.ts.) The very
 * first admin is created once, only with the ADMIN_EMAIL configured on the
 * server; every other staff account is created by the admin with a temporary
 * password that must be changed at the first sign-in.
 *
 * Sessions are Auth.js JWTs in an encrypted, HTTP-only cookie. Each token
 * carries the user's sessionVersion; changing or resetting the password, or
 * disabling the account, raises it and every older session stops working.
 */
import 'server-only';
import bcrypt from 'bcryptjs';
import { PANEL_ROLES, type PanelRole, type Role } from '@/lib/shared/domain';
import type { Principal } from '@/lib/shared/types';
import type { ChangePasswordInput, ProfileInput, SetupInput } from '@/lib/validation/auth';
import { CACHE_KEYS, cached, invalidate } from '../cache';
import { db } from '../db';
import { config } from '../env';
import { AppError, badRequest, conflict, forbidden, unauthorized } from '../errors';

// Makes "unknown email" and "wrong password" take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

/** At least 8 characters, with letters and numbers, and not the email itself. */
export function assertStrongPassword(password: string, email?: string, field = 'password'): void {
  const problems: string[] = [];
  if (password.length < 8) problems.push('të paktën 8 karaktere');
  if (!/[A-Za-zÀ-ž]/.test(password)) problems.push('të paktën një shkronjë');
  if (!/\d/.test(password)) problems.push('të paktën një numër');
  const lower = password.toLowerCase();
  if (email && (lower === email.toLowerCase() || lower === email.split('@')[0]?.toLowerCase())) problems.push('të mos jetë emaili juaj');
  if (problems.length) {
    const message = `Fjalëkalimi duhet të ketë ${problems.join(', ')}.`;
    throw badRequest(message, [{ field, code: 'weak_password', message }]);
  }
}

export const hashPassword = (password: string): Promise<string> => bcrypt.hash(password, config().auth.bcryptRounds);

export async function setupStatus() {
  const admins = await db.user.count({ where: { role: 'ADMIN' } });
  return { setupComplete: admins > 0, adminEmailConfigured: Boolean(config().auth.adminEmail) };
}

export async function setupFirstAdmin(input: SetupInput) {
  const adminEmail = config().auth.adminEmail;
  assertStrongPassword(input.password, input.email);
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async (tx) => {
    // Serialise concurrent attempts: only one first admin can ever be created.
    await tx.$executeRaw`LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`;
    if ((await tx.user.count({ where: { role: 'ADMIN' } })) > 0) throw conflict('Llogaria e parë e administratorit është krijuar tashmë.');
    if (!adminEmail) throw badRequest('ADMIN_EMAIL nuk është vendosur në server.');
    if (input.email !== adminEmail) throw forbidden('Ky email nuk lejohet të krijojë administratorin e parë.');
    const now = new Date();
    return tx.user.create({
      data: { email: input.email, name: input.name, passwordHash, role: 'ADMIN', mustChangePassword: false, passwordChangedAt: now },
      select: { id: true, email: true },
    });
  });
}

export type SignInResult = { id: string; email: string; name: string; role: Role; sessionVersion: number };

export class AccountDisabledError extends AppError {
  constructor() {
    super(403, 'ACCOUNT_DISABLED', 'Kjo llogari është çaktivizuar. Kontaktoni administratorin.');
  }
}

/** Checks email + password. Returns null for a wrong email or password (same answer, same time). */
export async function verifyCredentials(email: string, password: string): Promise<SignInResult | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return null;
  if (!user.active) throw new AccountDisabledError();
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { id: user.id, email: user.email, name: user.name, role: user.role, sessionVersion: user.sessionVersion };
}

/** What every request needs to know about the signed-in person, cached for one minute. */
interface UserState {
  active: boolean;
  role: Role;
  sessionVersion: number;
  email: string;
  name: string;
  phone: string | null;
  departmentId: number | null;
  departmentNameSq: string | null;
  departmentNameEn: string | null;
  mustChangePassword: boolean;
  hasPassword: boolean;
  hasGoogle: boolean;
}

async function userState(id: string): Promise<UserState | null> {
  return cached(CACHE_KEYS.userState(id), 60, async () => {
    const user = await db.user.findUnique({ where: { id }, include: { department: { select: { nameSq: true, nameEn: true } } } });
    if (!user) return null;
    return {
      active: user.active,
      role: user.role,
      sessionVersion: user.sessionVersion,
      email: user.email,
      name: user.name,
      phone: user.phone,
      departmentId: user.departmentId,
      departmentNameSq: user.department?.nameSq ?? null,
      departmentNameEn: user.department?.nameEn ?? null,
      mustChangePassword: user.mustChangePassword,
      hasPassword: user.passwordHash !== null,
      hasGoogle: user.googleId !== null,
    };
  });
}

/** For residents' sessions (services/residents.ts). */
export const readUserState = userState;

/** After any change to an account: the next request reads it fresh from the database. */
export const forgetUserState = (id: string) => invalidate(CACHE_KEYS.userState(id));

/**
 * The person behind a session token, or null when the session is no longer
 * valid (account removed or disabled, password changed, not a panel role).
 * Role and department always come from the database, never from the token.
 */
export async function loadPrincipal(userId: string, tokenSessionVersion: number): Promise<Principal | null> {
  const state = await userState(userId);
  if (!state || !state.active || state.sessionVersion !== tokenSessionVersion) return null;
  if (!PANEL_ROLES.includes(state.role)) return null;
  return {
    id: userId,
    email: state.email,
    name: state.name,
    phone: state.phone,
    role: state.role as PanelRole,
    departmentId: state.departmentId,
    departmentNameSq: state.departmentNameSq,
    departmentNameEn: state.departmentNameEn,
    mustChangePassword: state.mustChangePassword,
  };
}

export async function changePassword(user: Principal, input: ChangePasswordInput): Promise<void> {
  const row = await db.user.findUnique({ where: { id: user.id } });
  if (!row?.passwordHash || !(await bcrypt.compare(input.currentPassword, row.passwordHash))) {
    throw badRequest('Fjalëkalimi aktual është i gabuar.', [{ field: 'currentPassword', code: 'wrong_password', message: 'Fjalëkalimi aktual është i gabuar.' }]);
  }
  if (input.newPassword === input.currentPassword) {
    throw badRequest('Fjalëkalimi i ri duhet të jetë i ndryshëm nga i vjetri.', [{ field: 'newPassword', code: 'same_password', message: 'Fjalëkalimi i ri duhet të jetë i ndryshëm.' }]);
  }
  assertStrongPassword(input.newPassword, row.email, 'newPassword');
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, passwordChangedAt: new Date(), sessionVersion: { increment: 1 } },
  });
  await forgetUserState(user.id);
}

export async function updateProfile(user: Principal, input: ProfileInput): Promise<void> {
  const exists = await db.user.findUnique({ where: { id: user.id }, select: { id: true } });
  if (!exists) throw unauthorized();
  await db.user.update({
    where: { id: user.id },
    data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}) },
  });
  await forgetUserState(user.id);
}

/** "My account" page: the last sign-in time (not part of the session principal). */
export async function lastLoginOf(user: Principal): Promise<string | null> {
  const row = await db.user.findUnique({ where: { id: user.id }, select: { lastLoginAt: true } });
  return row?.lastLoginAt?.toISOString() ?? null;
}

/**
 * Where a person goes right after signing in. Read by email from the database,
 * because the new session cookie is only sent with the NEXT request.
 */
export async function homeAfterSignIn(email: string): Promise<'/admin' | '/hyrje/fjalekalimi'> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { mustChangePassword: true } });
  return user?.mustChangePassword ? '/hyrje/fjalekalimi' : '/admin';
}
