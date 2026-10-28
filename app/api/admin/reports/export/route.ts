/** CSV export for Excel, with the same filters as the report list. Department heads get only their department. */
import { handle } from '@/lib/server/http';
import { invalid } from '@/lib/server/errors';
import { requireStaff } from '@/lib/server/session';
import { exportCsv } from '@/lib/server/services/stats';
import { exportSchema } from '@/lib/validation/report';
import { check } from '@/lib/validation/zod';

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireStaff();
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = check(exportSchema, params);
    if (!parsed.ok) throw invalid(parsed.errors);
    const csv = await exportCsv(user, parsed.data);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="raportimet-${date}.csv"`,
        'cache-control': 'no-store',
      },
    });
  });
}
