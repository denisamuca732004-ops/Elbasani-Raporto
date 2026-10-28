import type { Metadata } from 'next';
import TransferList, { type TransferFilter } from '@/components/panel/TransferList';
import { getT } from '@/i18n/server';
import { flatParams, pageStaff } from '@/lib/server/pageData';
import { listTransfers } from '@/lib/server/services/transfer';
import type { Paged, TransferListItem } from '@/lib/shared/types';
import { transferListSchema } from '@/lib/validation/report';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.reviews') };
}

const FILTERS: TransferFilter[] = ['pending', 'approved', 'declined', 'all'];

export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await pageStaff('/admin/transfers');
  const params = flatParams(await searchParams);
  const filter: TransferFilter = FILTERS.includes(params.status as TransferFilter) ? (params.status as TransferFilter) : 'pending';
  const parsed = transferListSchema.safeParse({ status: filter === 'all' ? undefined : filter.toUpperCase(), page: params.page ?? '1', pageSize: '20' });
  let data: Paged<TransferListItem> | null = null;
  try {
    data = await listTransfers(principal, parsed.success ? parsed.data : transferListSchema.parse({ status: 'PENDING' }));
  } catch (err) {
    console.error('[transfers] list failed', err);
  }
  return <TransferList principal={principal} filter={filter} data={data} />;
}
