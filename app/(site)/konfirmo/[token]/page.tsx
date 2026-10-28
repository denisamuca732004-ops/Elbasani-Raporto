import type { Metadata } from 'next';
import Feedback from '@/components/public/Feedback';
import { getT } from '@/i18n/server';
import { AppError } from '@/lib/server/errors';
import { getFeedbackInfo } from '@/lib/server/services/publicReport';
import type { PublicCase } from '@/lib/shared/types';

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('feedback.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function FeedbackPage({ params }: Props) {
  const { token } = await params;
  let info: PublicCase | null = null;
  if (/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    try {
      info = await getFeedbackInfo(token);
    } catch (err) {
      if (!(err instanceof AppError && err.status === 404)) console.error('[feedback] lookup failed', err);
    }
  }
  return <Feedback token={token} info={info} />;
}
