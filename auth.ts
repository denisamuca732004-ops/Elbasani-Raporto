/**
 * Auth.js (NextAuth v5).
 *  - "credentials": email + password for municipal staff (the panel).
 *  - "resident": email + password for a resident's own account.
 *  - "google": a resident signs up / signs in with Google (only when
 *    AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are set).
 * Wrong email and wrong password give the same answer in the same time;
 * disabled accounts get their own message only after a correct password.
 * Sessions are encrypted JWT cookies; role and account state are checked
 * against the database on every request (lib/server/session.ts).
 */
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { authConfig } from './auth.config';
import { AccountDisabledError, verifyCredentials } from './lib/server/services/auth';
import { StaffAccountError, googleSignInVerdict, signInWithGoogle, verifyResidentCredentials, type GoogleProfile } from './lib/server/services/residents';
import { loginSchema } from './lib/validation/auth';
import { check } from './lib/validation/zod';

class AccountDisabled extends CredentialsSignin {
  override code = 'account_disabled';
}

/** A correct password for an account without access to the panel (role USER): no session is created. */
class NoPanelAccess extends CredentialsSignin {
  override code = 'no_panel_access';
}

/** A correct password on the residents' page, but for a staff account. */
class StaffAccount extends CredentialsSignin {
  override code = 'staff_account';
}

const PANEL_ROLES = new Set(['MUNICIPALITY_STAFF', 'ADMIN']);

export const googleEnabled = () => Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const nextAuth = NextAuth(() => ({
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
    Credentials({
      id: 'resident',
      credentials: { email: { type: 'email' }, password: { type: 'password' } },
      async authorize(raw) {
        const parsed = check(loginSchema, { email: raw?.email, password: raw?.password });
        if (!parsed.ok) return null;
        try {
          const user = await verifyResidentCredentials(parsed.data.email, parsed.data.password);
          if (!user) return null;
          return { id: user.id, email: user.email, name: user.name, role: user.role, sessionVersion: user.sessionVersion };
        } catch (err) {
          if (err instanceof AccountDisabledError) throw new AccountDisabled();
          if (err instanceof StaffAccountError) throw new StaffAccount();
          throw err;
        }
      },
    }),
    ...(googleEnabled() ? [Google({ authorization: { params: { prompt: 'select_account' } } })] : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    /** Google: a refused account goes back to the sign-in page with the reason, before anything is created. */
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return true;
      const verdict = await googleSignInVerdict((profile ?? {}) as GoogleProfile);
      return verdict === 'ok' ? true : `/llogaria/hyr?gabim=${verdict}`;
    },
    /** Google: the token gets OUR account (found, linked or created), never Google's id. */
    async jwt(params) {
      const { token, account, profile } = params;
      if (account?.provider === 'google') {
        const user = await signInWithGoogle((profile ?? {}) as GoogleProfile);
        token.uid = user.id;
        token.role = user.role;
        token.sv = user.sessionVersion;
        token.lt = Math.floor(Date.now() / 1000);
        token.name = user.name;
        token.email = user.email;
        delete token.picture;
        return token;
      }
      return authConfig.callbacks.jwt(params);
    },
  },
}));

export const { handlers, auth, signIn, signOut } = nextAuth;
export const { GET, POST } = nextAuth.handlers;
