/** Public status of one report (for the municipality's site or other apps). Never contains contact details. */
import { NextResponse } from 'next/server';
import { handle } from '@/lib/server/http';
import { notFound } from '@/lib/server/errors';
import { getPublicCase } from '@/lib/server/services/publicReport';
import { caseNumber } from '@/lib/validation/report';

export async function GET(_request: Request, ctx: { params: Promise<{ caseNumber: string }> }) {
  return handle(async () => {
    const parsed = caseNumber.safeParse((await ctx.params).caseNumber);
    if (!parsed.success) throw notFound('Raportimi nuk u gjet.');
    return NextResponse.json(await getPublicCase(parsed.data), { headers: { 'cache-control': 'public, max-age=30' } });
  });
}
