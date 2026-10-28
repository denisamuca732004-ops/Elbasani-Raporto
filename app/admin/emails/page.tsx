import type { Metadata } from 'next';
import EmailLog from '@/components/admin/EmailLog';
import { getT } from '@/i18n/server';
import { flatParams, pageAdmin } from '@/lib/server/pageData';
import { listEmailLog } from '@/lib/server/services/admin';
import { emailLogSchema } from '@/lib/validation/admin';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.emails') };
}

export default async function EmailsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await pageAdmin('/admin/emails');
  const params = flatParams(await searchParams);
  const parsed = emailLogSchema.safeParse({ page: params.page ?? '1', pageSize: '25', q: params.q });
  const query = parsed.success ? parsed.data : emailLogSchema.parse({});
  return <EmailLog data={await listEmailLog(admin, query)} q={query.q ?? ''} />;
}
