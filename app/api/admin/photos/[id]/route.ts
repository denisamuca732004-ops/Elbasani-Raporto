/** A photo for the panel: only for staff who may see the report (never cached by shared caches). */
import { z } from 'zod';
import { handle } from '@/lib/server/http';
import { notFound } from '@/lib/server/errors';
import { requireStaff } from '@/lib/server/session';
import { getStaffPhoto } from '@/lib/server/services/report';
import { openStoredImage } from '@/lib/server/storage';

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireStaff();
    const id = z.uuid().safeParse((await ctx.params).id);
    if (!id.success) throw notFound('Fotoja nuk u gjet.');
    const photo = await getStaffPhoto(user, id.data);
    const { body, size } = await openStoredImage(photo);
    return new Response(body as BodyInit, {
      headers: {
        'content-type': photo.mime,
        ...(size ? { 'content-length': String(size) } : {}),
        'cache-control': 'private, max-age=600',
        'x-content-type-options': 'nosniff',
      },
    });
  });
}
