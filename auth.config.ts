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
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    uid?: string;
    role?: Role;
    sv?: number;
  }
}

const maxAgeHours = Number(process.env.SESSION_MAX_AGE_HOURS) || 12;

export const authConfig = {
  trustHost: true,
  pages: { signIn: '/hyrje' },
  session: { strategy: 'jwt', maxAge: maxAgeHours * 3600 },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // Only at sign-in. Afterwards the token is never extended with data sent by the browser.
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        token.sv = user.sessionVersion;
      }
      return token;
    },
    session({ session, token }) {
      return {
        ...session,
        user: { ...session.user, id: token.uid ?? '', email: token.email ?? '', name: token.name ?? '', role: token.role ?? 'USER' },
        sessionVersion: token.sv ?? -1,
      };
    },
  },
} satisfies NextAuthConfig;
