/** Health check for monitoring: the app answers and the database is reachable. */
import { NextResponse } from 'next/server';
import { db } from '@/lib/server/db';
import { config } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', env: config().env, time: new Date().toISOString() }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
