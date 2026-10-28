/** Only pages of the panel are allowed as a return address after sign-in (no open redirects). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !/^\/admin(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&%_.,-]*)?$/.test(next)) return null;
  return next;
}
