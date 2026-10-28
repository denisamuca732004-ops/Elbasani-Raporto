/**
 * A photo anyone may see: public, and (for the resident's own photo) the
 * report has been verified. Cached by the CDN; storage URLs stay private.
 */
import { z } from 'zod';
import { handle } from '@/lib/server/http';
import { notFound } from '@/lib/server/errors';
import { getPublicPhoto } from '@/lib/server/services/publicReport';
import { openStoredImage } from '@/lib/server/storage';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = z.uuid().safeParse((await ctx.params).id);
    if (!id.success) throw notFound('Fotoja nuk u gjet.');
    const photo = await getPublicPhoto(id.data);
    const { body, size } = await openStoredImage(photo);
    return new Response(body as BodyInit, {
      headers: {
        'content-type': photo.mime,
        ...(size ? { 'content-length': String(size) } : {}),
        // Short cache: a photo hidden by staff disappears from the public quickly.
        'cache-control': 'public, max-age=300, s-maxage=300',
        'x-content-type-options': 'nosniff',
      },
    });
  });
}
