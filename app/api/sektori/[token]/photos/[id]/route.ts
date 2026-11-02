/** A photo of a report, for the sector that works by e-mail: only with its valid report link. */
import { z } from 'zod';
import { clientIp } from '@/actions/_shared';
import { handle } from '@/lib/server/http';
import { notFound } from '@/lib/server/errors';
import { enforceRateLimit } from '@/lib/server/ratelimit';
import { sectorPhoto } from '@/lib/server/services/sectorLink';
import { openStoredImage } from '@/lib/server/storage';

export async function GET(_request: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  return handle(async () => {
    await enforceRateLimit('sector', await clientIp());
    const { token, id } = await ctx.params;
    const attachmentId = z.uuid().safeParse(id);
    if (!attachmentId.success) throw notFound('Fotoja nuk u gjet.');
    const photo = await sectorPhoto(token, attachmentId.data);
    const { body, size } = await openStoredImage(photo);
    return new Response(body as BodyInit, {
      headers: {
        'content-type': photo.mime,
        ...(size ? { 'content-length': String(size) } : {}),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    });
  });
}
