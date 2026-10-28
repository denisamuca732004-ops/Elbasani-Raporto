/**
 * Who is asking. Every /admin page, Route Handler and Server Action calls one
 * of these before doing anything. The session cookie is checked by Auth.js,
 * then the account is checked against the database (active, same session
 * version, a panel role). Role and department always come from the database.
 */
import 'server-only';
import { auth } from '@/auth';
import type { Principal } from '@/lib/shared/types';
import { forbidden, passwordChangeRequired, unauthorized } from './errors';
import { loadPrincipal } from './services/auth';

/** The signed-in staff member, or null. */
export async function getPrincipal(): Promise<Principal | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return loadPrincipal(id, session.sessionVersion);
}

/** MUNICIPALITY_STAFF or ADMIN, signed in, with a password that is not temporary any more. */
export async function requireStaff(options: { allowPasswordChange?: boolean } = {}): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) throw unauthorized('Sesioni ka mbaruar. Hyni përsëri.');
  if (principal.mustChangePassword && !options.allowPasswordChange) throw passwordChangeRequired();
  return principal;
}

export async function requireAdmin(): Promise<Principal> {
  const principal = await requireStaff();
  if (principal.role !== 'ADMIN') throw forbidden('Vetëm administratori mund ta bëjë këtë veprim.');
  return principal;
}
