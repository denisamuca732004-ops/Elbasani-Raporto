import type { Metadata } from 'next';
import { Suspense } from 'react';
import ActionPage from '@/components/public/ActionPage';
import { AppError } from '@/lib/server/errors';
import { getPublicAction } from '@/lib/server/services/community';
import type { PublicAction } from '@/lib/shared/types';

type Props = { params: Promise<{ code: string }> };

async function load(code: string): Promise<PublicAction | null> {
  try {
    return await getPublicAction(code);
  } catch (err) {
    // Not public (yet): the organiser still sees it with the link kept in their browser.
    if (err instanceof AppError && err.status === 404) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const action = /^AK-\d{4}-\d{4,6}$/i.test(code) ? await load(code.toUpperCase()).catch(() => null) : null;
  return { title: action?.title ?? code.slice(0, 20).toUpperCase(), description: action?.description.slice(0, 160), robots: { index: false } };
}

export default async function ActionRoute({ params }: Props) {
  const raw = decodeURIComponent((await params).code).toUpperCase();
  const code = /^AK-\d{4}-\d{4,6}$/.test(raw) ? raw : '';
  const action = code ? await load(code) : null;
  return (
    <Suspense>
      <ActionPage code={code || raw.slice(0, 20)} initial={action} />
    </Suspense>
  );
}
