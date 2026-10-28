/**
 * Background jobs called by Upstash QStash. Every request must carry a valid
 * QStash signature (signed with QSTASH_CURRENT_SIGNING_KEY or _NEXT_), or it
 * is refused. A failed job answers 500 and QStash retries it.
 */
import { Receiver } from '@upstash/qstash';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/server/env';
import { JOB_NAMES, runJob, type JobName } from '@/lib/server/queue';

export const maxDuration = 60;

const payloads: { [N in JobName]: z.ZodType } = {
  triage: z.strictObject({ reportId: z.uuid() }),
  'closing-check': z.strictObject({ reportId: z.uuid() }),
  'deliver-email': z.strictObject({ ids: z.array(z.string().regex(/^\d+$/)).min(1).max(500) }),
};

export async function POST(request: Request, ctx: { params: Promise<{ name: string }> }) {
  const qstash = config().qstash;
  if (!qstash) return NextResponse.json({ error: 'QStash is not configured' }, { status: 404 });
  const { name } = await ctx.params;
  if (!(JOB_NAMES as readonly string[]).includes(name)) return NextResponse.json({ error: 'Unknown job' }, { status: 404 });

  const body = await request.text();
  const signature = request.headers.get('upstash-signature') ?? '';
  const receiver = new Receiver({ currentSigningKey: qstash.currentSigningKey, nextSigningKey: qstash.nextSigningKey });
  const valid = await receiver
    .verify({ signature, body, url: `${config().appUrl}/api/jobs/${name}` })
    .catch(() => false);
  if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  let payload: unknown;
  try {
    payload = payloads[name as JobName].parse(JSON.parse(body));
  } catch {
    // A malformed payload will never succeed: answer 200 so QStash does not retry it.
    console.error(`[jobs] ${name}: invalid payload`);
    return NextResponse.json({ ok: false, error: 'Invalid payload' });
  }
  try {
    await runJob(name as JobName, payload as never);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[jobs] ${name} failed`, err);
    return NextResponse.json({ error: 'Job failed' }, { status: 500 });
  }
}
