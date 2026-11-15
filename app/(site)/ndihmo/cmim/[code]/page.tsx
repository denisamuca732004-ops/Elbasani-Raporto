import type { Metadata } from 'next';
import PrizeRedeem from '@/components/public/PrizeRedeem';
import { getT } from '@/i18n/server';
import { AppError } from '@/lib/server/errors';
import { getPrize } from '@/lib/server/services/community';

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('community.redeem.title'), robots: { index: false } };
}

export default async function PrizeRoute({ params }: Props) {
  const code = decodeURIComponent((await params).code).toUpperCase();
  let prize = null;
  if (/^[A-Z0-9]{6,16}$/.test(code)) {
    try {
      prize = await getPrize(code);
    } catch (err) {
      if (!(err instanceof AppError && err.status === 404)) throw err;
    }
  }
  return <PrizeRedeem prize={prize} />;
}
