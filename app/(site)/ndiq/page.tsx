import type { Metadata } from 'next';
import Track from '@/components/public/Track';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('track.title') };
}

export default function TrackPage() {
  return <Track />;
}
