/**
 * Auth.js (NextAuth v5) with email + password for municipal staff.
 * Wrong email and wrong password give the same answer in the same time;
 * disabled accounts get their own message only after a correct password.
 */
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { AccountDisabledError, verifyCredentials } from './lib/server/services/auth';
import { loginSchema } from './lib/validation/auth';
import { check } from './lib/validation/zod';

class AccountDisabled extends CredentialsSignin {
  override code = 'account_disabled';
}

/** A correct password for an account without access to the panel (role USER): no session is created. */
class NoPanelAccess extends CredentialsSignin {
  override code = 'no_panel_access';
}

const PANEL_ROLES = new Set(['MUNICIPALITY_STAFF', 'ADMIN']);

const nextAuth = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: { type: 'email' }, password: { type: 'password' } },
      async authorize(raw) {
        const parsed = check(loginSchema, { email: raw?.email, password: raw?.password });
        if (!parsed.ok) return null;
        try {
          const user = await verifyCredentials(parsed.data.email, parsed.data.password);
          if (!user) return null;
          if (!PANEL_ROLES.has(user.role)) throw new NoPanelAccess();
          return { id: user.id, email: user.email, name: user.name, role: user.role, sessionVersion: user.sessionVersion };
        } catch (err) {
          if (err instanceof AccountDisabledError) throw new AccountDisabled();
          throw err;
        }
      },
    }),
  ],
});

export const { handlers, auth, signIn, signOut } = nextAuth;
export const { GET, POST } = nextAuth.handlers;
