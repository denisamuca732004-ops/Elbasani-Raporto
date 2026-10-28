import type { Metadata } from 'next';
import Link from 'next/link';
import Icon from '@/components/Icon';
import ReportDetail, { type AssignablePerson } from '@/components/panel/ReportDetail';
import { getT } from '@/i18n/server';
import { AppError } from '@/lib/server/errors';
import { flatParams, pageStaff } from '@/lib/server/pageData';
import { assignableUsers, getReport } from '@/lib/server/services/report';
import type { ReportDetail as Report } from '@/lib/shared/types';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('detail.report') };
}

/** A department head can open only their department's reports (getReport checks it); others get a clear message. */
export default async function ReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const principal = await pageStaff(`/admin/reports/${encodeURIComponent(id)}`);
  const from = flatParams(await searchParams).from;
  const backTo = from && /^\/admin\/reports(\?[A-Za-z0-9=&%_.,+-]*)?$/.test(from) ? from : '/admin/reports';
  const { t } = await getT();

  let report: Report | null = null;
  let problem: 'forbidden' | 'notFound' | 'error' | null = null;
  if (!UUID.test(id)) problem = 'notFound';
  else {
    try {
      report = await getReport(principal, id);
    } catch (err) {
      if (err instanceof AppError && err.status === 403) problem = 'forbidden';
      else if (err instanceof AppError && err.status === 404) problem = 'notFound';
      else {
        console.error('[report] load failed', err);
        problem = 'error';
      }
    }
  }

  if (!report) {
    return (
      <div className="stack">
        <Link href={backTo} className="back-link"><Icon name="arrowLeft" size={16} />{t('common.back')}</Link>
        <div className={`alert ${problem === 'error' ? 'alert-error' : 'alert-warn'}`} role="alert">
          {problem === 'forbidden' ? t('detail.otherSector') : problem === 'notFound' ? t('detail.notFound') : t('errors.generic')}
        </div>
      </div>
    );
  }

  const assignable: AssignablePerson[] = report.permissions.canAssign
    ? (await assignableUsers(principal, id).catch(() => [])).map((a) => ({ id: a.id, name: a.name, role: a.role }))
    : [];
  return <ReportDetail key={report.id} principal={principal} report={report} assignable={assignable} backTo={backTo} />;
}
