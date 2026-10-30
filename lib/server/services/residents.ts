/**
 * Residents' own accounts (role USER). Optional: anyone can report without
 * one. With an account, a resident signs in with Google or with email +
 * password, finds their reports on any device ("Raportimet e mia") and has
 * their contact details filled in.
 *
 * Rules that keep accounts safe:
 *  - a resident account never opens the panel (proxy + loadPrincipal);
 *  - Google only signs in to resident accounts, never to staff ones, and
 *    only with an email Google has verified;
 *  - an email + password sign-up does not prove the email belongs to that
 *    person. When the real owner later signs in with Google, Google proves
 *    it: the account is linked, its password removed and every other
 *    session ended, so whoever registered someone else's email loses access;
 *  - staff never see which account made a report (citizen_id), so an
 *    anonymous report stays anonymous.
 */
import 'server-only';
import bcrypt from 'bcryptjs';
import type { PublicCard } from '@/lib/shared/types';
import type { RegisterInput, ResidentProfileInput, SetPasswordInput } from '@/lib/validation/auth';
import { Prisma, db } from '../db';
import { AppError, badRequest, conflict, unauthorized } from '../errors';
import { AccountDisabledError, assertStrongPassword, forgetUserState, hashPassword, readUserState, type SignInResult } from './auth';
import { publicInclude, toPublicCard } from './mapper';

// Makes "unknown email" and "wrong password" take the same time.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

export interface Resident {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  hasPassword: boolean;
  hasGoogle: boolean;
}

/** A correct password, but for a staff account: staff sign in on their own page. */
export class StaffAccountError extends AppError {
  constructor() {
    super(403, 'STAFF_ACCOUNT', 'Kjo është llogari e stafit të Bashkisë. Hyni te “Hyrja për stafin”.');
  }
}

export async function registerResident(input: RegisterInput): Promise<SignInResult> {
  assertStrongPassword(input.password, input.email);
  try {
    const user = await db.user.create({
      data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password), role: 'USER', passwordChangedAt: new Date(), lastLoginAt: new Date() },
    });
    return { id: user.id, email: user.email, name: user.name, role: user.role, sessionVersion: user.sessionVersion };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('Ky email ka tashmë një llogari. Hyni, ose përdorni “Vazhdo me Google”.', { field: 'email' });
    }
    throw err;
  }
}

/** Email + password of a resident. Null for a wrong email or password (same answer, same time). */
export async function verifyResidentCredentials(email: string, password: string): Promise<SignInResult | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) return null;
  if (user.role !== 'USER') throw new StaffAccountError();
  if (!user.active) throw new AccountDisabledError();
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { id: user.id, email: user.email, name: user.name, role: user.role, sessionVersion: user.sessionVersion };
}

/* ───────────────────────── Google ───────────────────────── */

export interface GoogleProfile {
  sub?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  name?: string | null;
}

export type GoogleVerdict = 'ok' | 'unverified' | 'staff' | 'disabled';

/** May this Google account sign in? Checked before any account is created or changed. */
export async function googleSignInVerdict(profile: GoogleProfile): Promise<GoogleVerdict> {
  const email = profile.email?.trim().toLowerCase();
  if (!profile.sub || !email || profile.email_verified !== true) return 'unverified';
  const user = (await db.user.findUnique({ where: { googleId: profile.sub } })) ?? (await db.user.findUnique({ where: { email } }));
  if (!user) return 'ok';
  if (user.role !== 'USER') return 'staff';
  if (!user.active) return 'disabled';
  return 'ok';
}

/**
 * Signs in with Google: the account with this Google id, else the resident
 * account with this (verified) email, linked now, else a new account.
 */
export async function signInWithGoogle(profile: GoogleProfile): Promise<SignInResult> {
  const verdict = await googleSignInVerdict(profile);
  if (verdict !== 'ok') throw new AppError(403, 'GOOGLE_DENIED', verdict);
  const sub = profile.sub!;
  const email = profile.email!.trim().toLowerCase();
  const name = (profile.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 160) || email.split('@')[0]!;
  const now = new Date();

  let user = await db.user.findUnique({ where: { googleId: sub } });
  if (!user) {
    const byEmail = await db.user.findUnique({ where: { email } });
    if (byEmail) {
      // Google has just proved who owns this email. A password set by an unverified sign-up is removed.
      const unproven = byEmail.emailVerifiedAt === null && byEmail.passwordHash !== null;
      user = await db.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: sub,
          emailVerifiedAt: byEmail.emailVerifiedAt ?? now,
          ...(unproven ? { passwordHash: null, sessionVersion: { increment: 1 } } : {}),
        },
      });
    } else {
      user = await db.user.create({ data: { email, name, googleId: sub, emailVerifiedAt: now, role: 'USER' } });
    }
  }
  user = await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
  await forgetUserState(user.id);
  return { id: user.id, email: user.email, name: user.name, role: user.role, sessionVersion: user.sessionVersion };
}

/* ───────────────────────── The signed-in resident ───────────────────────── */

/** The resident behind a session token, or null (staff, disabled, signed out elsewhere). */
export async function loadResident(userId: string, tokenSessionVersion: number): Promise<Resident | null> {
  const state = await readUserState(userId);
  if (!state || !state.active || state.sessionVersion !== tokenSessionVersion || state.role !== 'USER') return null;
  return { id: userId, email: state.email, name: state.name, phone: state.phone, hasPassword: state.hasPassword, hasGoogle: state.hasGoogle };
}

/** "Raportimet e mia": every report made while signed in, newest first (also those not public yet). */
export async function listMyReports(resident: Resident): Promise<PublicCard[]> {
  const rows = await db.report.findMany({
    where: { citizenId: resident.id },
    include: publicInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  return rows.map((r) => toPublicCard(r));
}

export async function updateResidentProfile(resident: Resident, input: ResidentProfileInput): Promise<void> {
  await db.user.update({
    where: { id: resident.id },
    data: { ...(input.name !== undefined ? { name: input.name } : {}), ...('phone' in input ? { phone: input.phone ?? null } : {}) },
  });
  await forgetUserState(resident.id);
}

/**
 * Changes the password (the current one is required), or sets the first one
 * for an account made with Google. Every other session ends.
 */
export async function setResidentPassword(resident: Resident, input: SetPasswordInput): Promise<void> {
  const row = await db.user.findUnique({ where: { id: resident.id } });
  if (!row) throw unauthorized();
  if (row.passwordHash) {
    const ok = input.currentPassword ? await bcrypt.compare(input.currentPassword, row.passwordHash) : false;
    if (!ok) {
      throw badRequest('Fjalëkalimi aktual është i gabuar.', [{ field: 'currentPassword', code: 'wrong_password', message: 'Fjalëkalimi aktual është i gabuar.' }]);
    }
  }
  assertStrongPassword(input.newPassword, row.email, 'newPassword');
  await db.user.update({
    where: { id: row.id },
    data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date(), sessionVersion: { increment: 1 } },
  });
  await forgetUserState(row.id);
}

/** Deletes the account. The reports stay (the Municipality still handles them), no longer linked to anyone. */
export async function deleteResidentAccount(resident: Resident): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.report.updateMany({ where: { citizenId: resident.id }, data: { citizenId: null } });
    await tx.user.delete({ where: { id: resident.id, role: 'USER' } });
  });
  await forgetUserState(resident.id);
}
