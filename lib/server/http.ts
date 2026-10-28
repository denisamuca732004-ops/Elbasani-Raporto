/** Helpers for Route Handlers: one JSON error format, the same as Server Actions. */
import 'server-only';
import { NextResponse } from 'next/server';
import { toActionError } from '@/actions/_shared';

export function jsonError(err: unknown): NextResponse {
  const error = toActionError(err);
  return NextResponse.json({ error }, { status: error.status, headers: { 'cache-control': 'no-store' } });
}

export async function handle(body: () => Promise<Response>): Promise<Response> {
  try {
    return await body();
  } catch (err) {
    return jsonError(err);
  }
}
