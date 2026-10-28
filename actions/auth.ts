'use server';
/** Server Actions for signing in and for one's own account. */
import { AuthError } from 'next-auth';
import { cookies } from 'next/headers';
import { signIn, signOut } from '@/auth';
import { AppError, unauthorized } from '@/lib/server/errors';
import { enforceRateLimit } from '@/lib/server/ratelimit';
import { getPrincipal, requireStaff } from '@/lib/server/session';
import { changePassword, homeAfterSignIn, setupFirstAdmin, setupStatus, updateProfile } from '@/lib/server/services/auth';
import { changePasswordSchema, loginSchema, profileSchema, setupSchema } from '@/lib/validation/auth';
import { clientIp, parseInput, run } from './_shared';

async function startSession(email: string, password: string): Promise<void> {
  try {
    await signIn('credentials', { email, password, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) {
      const code = (err as AuthError & { code?: string }).code;
      if (code === 'account_disabled') throw new AppError(403, 'ACCOUNT_DISABLED', 'Kjo llogari është çaktivizuar. Kontaktoni administratorin.');
      if (code === 'no_panel_access') throw new AppError(403, 'FORBIDDEN', 'Kjo llogari nuk ka akses në panelin e Bashkisë.');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email ose fjalëkalim i gabuar.');
    }
    throw err;
  }
}

export async function loginAction(input: unknown) {
  return run(async () => {
    const data = parseInput(loginSchema, input);
    await enforceRateLimit('login', `${await clientIp()}:${data.email}`);
    // Only MUNICIPALITY_STAFF and ADMIN accounts get a session (checked in auth.ts).
    await startSession(data.email, data.password);
    return { next: await homeAfterSignIn(data.email) };
  });
}

export async function logoutAction() {
  return run(async () => {
    await signOut({ redirect: false });
    return { next: '/hyrje' };
  });
}

export async function setupStatusAction() {
  return run(() => setupStatus());
}

/** Creates the very first admin (only once, only with ADMIN_EMAIL) and signs them in. */
export async function setupAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('setup', await clientIp());
    const data = parseInput(setupSchema, input);
    await setupFirstAdmin(data);
    await startSession(data.email, data.password);
    return { next: '/admin' };
  });
}

/** Also used for the forced change of a temporary password. Signs in again with the new password. */
export async function changePasswordAction(input: unknown) {
  return run(async () => {
    const user = await requireStaff({ allowPasswordChange: true });
    const data = parseInput(changePasswordSchema, input);
    await changePassword(user, data);
    // The old session stopped working (session version raised); start a new one.
    await startSession(user.email, data.newPassword);
    return { next: '/admin' };
  });
}

export async function updateProfileAction(input: unknown) {
  return run(async () => {
    const user = await requireStaff();
    await updateProfile(user, parseInput(profileSchema, input));
    const fresh = await getPrincipal();
    if (!fresh) throw unauthorized();
    return fresh;
  });
}

/** Albanian or English, remembered in a cookie so server-rendered pages use it too. */
export async function setLanguageAction(lang: unknown) {
  return run(async () => {
    const value = lang === 'en' ? 'en' : 'sq';
    (await cookies()).set('er_lang', value, { path: '/', maxAge: 365 * 86400, sameSite: 'lax', httpOnly: false });
    return { lang: value };
  });
}
