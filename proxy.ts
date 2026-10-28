/**
 * Next.js Proxy (the file Next.js 16 uses for what was called Middleware).
 * Runs before every page and API request:
 *
 *  1. /admin pages and /api/admin routes: the encrypted session cookie must be
 *     valid AND its role must be MUNICIPALITY_STAFF or ADMIN. Otherwise pages
 *     redirect to the sign-in page and APIs answer 401/403 immediately.
 *     (Pages, Route Handlers and Server Actions check the account again
 *     against the database: lib/server/session.ts.)
 *     The proxy only READS the session (getToken decrypts the JWE cookie with
 *     AUTH_SECRET); it never writes cookies, so it can never undo a sign-out
 *     that happens in the same request.
 *  2. Security headers on every page, including a Content Security Policy with
 *     a fresh nonce per request (no inline script can run without it).
 *  3. /embed pages may only be shown inside the sites the admin allowed.
 */
import { getToken } from 'next-auth/jwt';
import { NextResponse, type NextRequest } from 'next/server';

const PANEL_ROLES = new Set(['MUNICIPALITY_STAFF', 'ADMIN']);
const isDev = process.env.NODE_ENV !== 'production';

/* ── Which sites may embed /embed (cached per instance for one minute) ── */
let embedOrigins: { value: string[]; at: number } | null = null;
async function allowedEmbedOrigins(request: NextRequest): Promise<string[]> {
  if (embedOrigins && Date.now() - embedOrigins.at < 60_000) return embedOrigins.value;
  let value = (process.env.EMBED_ALLOWED_ORIGINS ?? 'https://elbasani.gov.al,https://www.elbasani.gov.al')
    .split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const res = await fetch(new URL('/api/public/embed-origins', request.url), { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (res.ok) {
      const body = (await res.json()) as { origins?: unknown };
      if (Array.isArray(body.origins)) value = body.origins.filter((o): o is string => typeof o === 'string' && /^https?:\/\/[^/\s;]+$/.test(o));
    }
  } catch {
    /* keep the default list */
  }
  embedOrigins = { value, at: Date.now() };
  return value;
}

function contentSecurityPolicy(nonce: string, frameAncestors: string, secure: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", // Leaflet positions map tiles with inline styles
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
    "font-src 'self'",
    // Photos are uploaded from the browser straight to Vercel Blob.
    "connect-src 'self' https://vercel.com/api/blob https://*.blob.vercel-storage.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** The role inside the session cookie, or null. Expired, tampered or foreign cookies give null. */
async function sessionRole(request: NextRequest): Promise<{ signedIn: boolean; role: string | null }> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return { signedIn: false, role: null };
  try {
    // On HTTPS Auth.js names the cookie "__Secure-authjs.session-token"; locally (http) "authjs.session-token".
    const secureCookie = request.cookies.has('__Secure-authjs.session-token');
    const token = await getToken({ req: request, secret, secureCookie });
    return { signedIn: Boolean(token?.uid), role: typeof token?.role === 'string' ? token.role : null };
  } catch {
    return { signedIn: false, role: null };
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const panelPath = pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin');
  const { signedIn, role } = panelPath ? await sessionRole(request) : { signedIn: false, role: null };

  // 1. Panel and panel APIs: signed in, with a panel role. Rejected right here otherwise.
  if (pathname.startsWith('/api/admin')) {
    if (!signedIn) return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Duhet të hyni në llogari.' } }, { status: 401 });
    if (!role || !PANEL_ROLES.has(role)) return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Nuk keni leje për këtë veprim.' } }, { status: 403 });
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!signedIn || !role || !PANEL_ROLES.has(role)) {
      const login = new URL('/hyrje', request.url);
      login.searchParams.set('next', `${pathname}${search}`);
      if (signedIn) login.searchParams.set('error', 'forbidden');
      return NextResponse.redirect(login);
    }
  }
  if (pathname.startsWith('/api/')) return NextResponse.next();

  // 2 + 3. Pages: security headers and a nonce for Next.js' own scripts.
  const nonce = btoa(crypto.randomUUID());
  const embed = pathname === '/embed' || pathname.startsWith('/embed/');
  const ancestors = embed ? `'self' ${(await allowedEmbedOrigins(request)).join(' ')}`.trim() : "'none'";
  const secure = request.nextUrl.protocol === 'https:';
  const csp = contentSecurityPolicy(nonce, ancestors, secure);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  if (!embed) response.headers.set('X-Frame-Options', 'DENY');
  if (secure && !isDev) response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  if (pathname.startsWith('/admin') || pathname.startsWith('/hyrje')) response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  // Everything except static files. Server Actions posted from /admin pages pass through here too.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|logo-bashkia-elbasan.svg|robots.txt|manifest.webmanifest|sw.js).*)'],
};
