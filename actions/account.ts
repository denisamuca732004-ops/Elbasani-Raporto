'use server';
/**
 * Server Actions for residents' own (optional) accounts: sign up, sign in
 * with email + password or with Google, and the "my account" page.
 * Staff keep their own sign-in (actions/auth.ts).
 */
import { AuthError } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { googleEnabled, signIn, signOut } from '@/auth';
import { AppError } from '@/lib/server/errors';
import { enforceRateLimit } from '@/lib/server/ratelimit';
import { requireResident } from '@/lib/server/session';
import {
  deleteResidentAccount, listMyReports, registerResident, setResidentPassword, updateResidentProfile,
} from '@/lib/server/services/residents';
import { safePublicNext } from '@/lib/shared/safeNext';
import { loginSchema, registerSchema, residentProfileSchema, setPasswordSchema } from '@/lib/validation/auth';
import { clientIp, parseInput, run } from './_shared';

/** Where to go after signing in: a page of the public site, by default "my account". */
const after = (next: unknown) => (typeof next === 'string' ? safePublicNext(next) : null) ?? '/llogaria';

async function residentSession(email: string, password: string): Promise<void> {
  try {
    await signIn('resident', { email, password, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) {
      const code = (err as AuthError & { code?: string }).code;
      if (code === 'account_disabled') throw new AppError(403, 'ACCOUNT_DISABLED', 'Kjo llogari është çaktivizuar.');
      if (code === 'staff_account') throw new AppError(403, 'STAFF_ACCOUNT', 'Kjo është llogari e stafit të Bashkisë. Hyni te “Hyrja për stafin”.');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email ose fjalëkalim i gabuar.');
    }
    throw err;
  }
}

export async function registerAction(input: unknown, next?: unknown) {
  return run(async () => {
    await enforceRateLimit('register', await clientIp());
    const data = parseInput(registerSchema, input);
    await registerResident(data);
    await residentSession(data.email, data.password);
    return { next: after(next) };
  });
}

export async function residentLoginAction(input: unknown, next?: unknown) {
  return run(async () => {
    const data = parseInput(loginSchema, input);
    await enforceRateLimit('login', `${await clientIp()}:${data.email}`);
    await residentSession(data.email, data.password);
    return { next: after(next) };
  });
}

/** "Continue with Google": a plain form posts here and the browser goes on to Google's page. */
export async function googleSignInAction(formData: FormData) {
  const next = after(formData.get('next'));
  if (!googleEnabled()) redirect('/llogaria/hyr?gabim=google_off');
  await enforceRateLimit('login', `${await clientIp()}:google`).catch(() => redirect('/llogaria/hyr?gabim=too_many'));
  await signIn('google', { redirectTo: next });
}

export async function residentLogoutAction() {
  return run(async () => {
    await signOut({ redirect: false });
    return { next: '/' };
  });
}

export async function myReportsAction() {
  return run(async () => listMyReports(await requireResident()));
}

export async function updateMyProfileAction(input: unknown) {
  return run(async () => {
    await updateResidentProfile(await requireResident(), parseInput(residentProfileSchema, input));
    revalidatePath('/', 'layout');
    return { saved: true };
  });
}

/** Sets or changes the password, then signs in again with it (other sessions end). */
export async function setMyPasswordAction(input: unknown) {
  return run(async () => {
    const resident = await requireResident();
    const data = parseInput(setPasswordSchema, input);
    await setResidentPassword(resident, data);
    await residentSession(resident.email, data.newPassword);
    return { saved: true };
  });
}

export async function deleteMyAccountAction() {
  return run(async () => {
    await deleteResidentAccount(await requireResident());
    await signOut({ redirect: false });
    return { next: '/' };
  });
}
