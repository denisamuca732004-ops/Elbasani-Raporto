/**
 * Daily maintenance, called by Vercel Cron (vercel.json) with
 * "Authorization: Bearer <CRON_SECRET>". Anyone else gets 401.
 */
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { config } from '@/lib/server/env';
import { runDaily } from '@/lib/server/services/maintenance';

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = config().cronSecret;
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  return Boolean(secret) && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await runDaily();
  return NextResponse.json({ ok: true, ...result });
}
