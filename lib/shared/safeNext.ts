/** Only pages of the panel are allowed as a return address after sign-in (no open redirects). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !/^\/admin(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&%_.,-]*)?$/.test(next)) return null;
  return next;
}

/** For residents: a page of the public site (not the panel, not the API, never another site). */
export function safePublicNext(next: string | null | undefined): string | null {
  if (!next || !/^\/(?!\/)[A-Za-z0-9/_.-]*(\?[A-Za-z0-9=&%_.,-]*)?$/.test(next)) return null;
  if (/^\/(admin|api|hyrje|embed)(\/|$|\?)/.test(next) || next.includes('..')) return null;
  return next;
}
