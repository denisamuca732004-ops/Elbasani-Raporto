/** A photo of a public "Ndihmo qytetin" action (before / after). Cached briefly by the CDN. */
import { z } from 'zod';
import { handle } from '@/lib/server/http';
import { notFound } from '@/lib/server/errors';
import { getActionPhoto } from '@/lib/server/services/community';
import { openStoredImage } from '@/lib/server/storage';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = z.uuid().safeParse((await ctx.params).id);
    if (!id.success) throw notFound('Fotoja nuk u gjet.');
    const photo = await getActionPhoto(id.data);
    const { body, size } = await openStoredImage(photo);
    return new Response(body as BodyInit, {
      headers: {
        'content-type': photo.mime,
        ...(size ? { 'content-length': String(size) } : {}),
        'cache-control': 'public, max-age=300, s-maxage=300',
        'x-content-type-options': 'nosniff',
      },
    });
  });
}
