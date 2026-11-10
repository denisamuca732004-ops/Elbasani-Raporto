import type { Metadata } from 'next';
import Dashboard, { type OnboardingInfo } from '@/components/panel/Dashboard';
import { getT } from '@/i18n/server';
import { PANEL_INCLUDES_DEMO, flatParams, pageStaff } from '@/lib/server/pageData';
import { listDepartments } from '@/lib/server/services/admin';
import { getDashboard, type DashboardResult } from '@/lib/server/services/dashboard';
import { findRepeatPlaces } from '@/lib/server/services/weeklySummary';
import type { RepeatPlace } from '@/lib/shared/types';
import { dashboardSchema } from '@/lib/validation/report';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('panel.nav.dashboard') };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const principal = await pageStaff('/admin');
  const params = flatParams(await searchParams);
  const parsed = dashboardSchema.safeParse({ period: params.period, departmentId: principal.role === 'ADMIN' ? params.departmentId : undefined });
  const query = { ...(parsed.success ? parsed.data : dashboardSchema.parse({})), includeTest: PANEL_INCLUDES_DEMO };

  let data: DashboardResult | null = null;
  try {
    data = await getDashboard(principal, query);
  } catch (err) {
    console.error('[dashboard] failed', err);
  }

  let onboarding: OnboardingInfo | null = null;
  let repeats: RepeatPlace[] | null = null;
  if (principal.role === 'ADMIN') {
    repeats = await findRepeatPlaces().catch((err) => { console.error('[dashboard] repeat places failed', err); return null; });
    const departments = await listDepartments(principal).catch(() => []);
    const active = departments.filter((d) => d.active);
    onboarding = {
      activeDepartments: active.length,
      // Sectors work only by e-mail: a sector without an address cannot get its reports.
      withoutHead: active.filter((d) => !d.email).map((d) => ({ nameSq: d.nameSq, nameEn: d.nameEn })),
    };
  }
  return <Dashboard principal={principal} data={data} onboarding={onboarding} repeats={repeats} />;
}
