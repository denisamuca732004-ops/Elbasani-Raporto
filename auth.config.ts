/**
 * Auth.js settings shared by the proxy (middleware) and the server.
 * No database here: the proxy only checks the encrypted session cookie and
 * the role inside it. Server pages, Route Handlers and Server Actions then
 * check the account again against the database (lib/server/session.ts).
 *
 * The session is a JWT encrypted with AUTH_SECRET (JWE) in an HTTP-only,
 * SameSite=Lax cookie (Secure and "__Secure-" prefixed on HTTPS), so page
 * scripts can never read it.
 */
import type { NextAuthConfig } from 'next-auth';
import type { Role } from '@/lib/shared/domain';

declare module 'next-auth' {
  interface User {
    role?: Role;
    sessionVersion?: number;
  }
  interface Session {
    user: { id: string; email: string; name: string; role: Role };
    sessionVersion: number;
    /** When this person signed in (seconds since 1970). Staff sessions end STAFF_SESSION_SECONDS after it. */
    loginAt: number | null;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    uid?: string;
    role?: Role;
    sv?: number;
    /** Sign-in time, seconds. */
    lt?: number;
  }
}

/** Staff: signed out SESSION_MAX_AGE_HOURS (12) after signing in, whatever they do. */
export const STAFF_SESSION_SECONDS = (Number(process.env.SESSION_MAX_AGE_HOURS) || 12) * 3600;
/** Residents: stay signed in on their phone for RESIDENT_SESSION_DAYS (30). */
const RESIDENT_SESSION_SECONDS = (Number(process.env.RESIDENT_SESSION_DAYS) || 30) * 86400;

/** True when a staff session is older than its limit (the cookie itself lives as long as a resident's). */
export function staffSessionExpired(loginAt: number | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return typeof loginAt === 'number' && nowSeconds - loginAt > STAFF_SESSION_SECONDS;
}

export const authConfig = {
  trustHost: true,
  // Errors of the Google sign-in (e.g. a refused account) land on the residents' sign-in page.
  pages: { signIn: '/hyrje', error: '/llogaria/hyr' },
  session: { strategy: 'jwt', maxAge: Math.max(RESIDENT_SESSION_SECONDS, STAFF_SESSION_SECONDS) },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // Only at sign-in. Afterwards the token is never extended with data sent by the browser.
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.sv = user.sessionVersion;
        token.lt = Math.floor(Date.now() / 1000);
      }
      return token;
    },
    session({ session, token }) {
      return {
        ...session,
        user: { ...session.user, id: token.uid ?? '', email: token.email ?? '', name: token.name ?? '', role: token.role ?? 'USER' },
        sessionVersion: token.sv ?? -1,
        loginAt: token.lt ?? null,
      };
    },
  },
} satisfies NextAuthConfig;
