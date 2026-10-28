/** Sites allowed to show the embedded form; read by proxy.ts for the frame-ancestors rule. */
import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/server/services/settings';

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({ origins: settings.embed.allowedOrigins }, { headers: { 'cache-control': 'public, max-age=60' } });
}
