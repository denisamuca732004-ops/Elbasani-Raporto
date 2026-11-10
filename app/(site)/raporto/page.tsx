import type { Metadata } from 'next';
import ReportWizard from '@/components/public/ReportWizard';
import { getT } from '@/i18n/server';
import { flatParams } from '@/lib/server/pageData';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('nav.report') };
}

/**
 * ?kategoria=streets opens a category, ?lloji=12 opens a report type (links from the home page search).
 * Otherwise "Raporto me foto" (with the AI on; without it the normal form), or the form with ?menyra=formular.
 */
export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await getT();
  const params = flatParams(await searchParams);
  const typeId = Number(params.lloji);
  const category = params.kategoria && /^[a-z0-9_.-]{1,60}$/.test(params.kategoria) ? params.kategoria : undefined;
  return (
    <div className="page">
      <div className="container">
        <h1 className="sr-only">{t('nav.report')}</h1>
        <ReportWizard
          initialCategory={category} initialType={Number.isInteger(typeId) && typeId > 0 ? typeId : undefined}
          initialMode={params.menyra === 'formular' ? 'form' : 'photo'}
        />
      </div>
    </div>
  );
}
