/** Branding and the form rules (service area, minimum lengths). Public. */
import { NextResponse } from 'next/server';
import { getPublicSettings } from '@/lib/server/services/settings';

export async function GET() {
  return NextResponse.json(await getPublicSettings(), { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=600' } });
}
