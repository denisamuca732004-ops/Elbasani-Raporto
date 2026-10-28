'use server';
/** Panel preferences kept in a cookie, so server-rendered pages use them too. */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireStaff } from '@/lib/server/session';
import { INCLUDE_TEST_COOKIE } from '@/lib/shared/panel';
import { run } from './_shared';

/** "Show demo data" switch of the left menu. */
export async function setIncludeTestAction(value: unknown) {
  return run(async () => {
    await requireStaff();
    const on = value === true;
    const jar = await cookies();
    if (on) jar.set(INCLUDE_TEST_COOKIE, '1', { path: '/admin', maxAge: 30 * 86400, sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    else jar.delete({ name: INCLUDE_TEST_COOKIE, path: '/admin' });
    revalidatePath('/admin', 'layout');
    return { includeTest: on };
  });
}
