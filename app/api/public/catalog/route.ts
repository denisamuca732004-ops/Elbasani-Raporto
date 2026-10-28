/** The report catalogue (categories, types, areas, departments). Public; used by the app offline too. */
import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/server/services/catalog';

export async function GET() {
  return NextResponse.json(await getCatalog(), { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=600' } });
}
