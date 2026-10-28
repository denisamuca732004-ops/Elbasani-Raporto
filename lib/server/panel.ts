import 'server-only';
import { cookies } from 'next/headers';
import { INCLUDE_TEST_COOKIE } from '@/lib/shared/panel';

/** Whether the panel shows demo reports too (switch in the left menu). */
export async function includeTestFromCookie(): Promise<boolean> {
  return (await cookies()).get(INCLUDE_TEST_COOKIE)?.value === '1';
}
