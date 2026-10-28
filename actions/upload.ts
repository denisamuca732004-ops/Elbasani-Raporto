'use server';
/**
 * Server Action that lets a browser upload ONE photo to Vercel Blob safely.
 *
 * The browser never sees the store's read-write token. It asks here with the
 * photo's type and size; after Zod validation and a rate limit per IP it gets
 * a client token that can write exactly one file (tmp/<random uuid>.jpg|png|webp),
 * of that one image type, up to UPLOAD_MAX_MB, for 10 minutes. The browser
 * uploads straight to Blob, then sends only the key with the report. The
 * server re-reads the file, checks it really is an image, saves a clean copy
 * without hidden metadata (GPS) and deletes the temporary file
 * (lib/server/storage.ts). Files are private and only shown through
 * /api/public/photos/[id] or /api/admin/photos/[id], which check access.
 */
import { enforceRateLimit } from '@/lib/server/ratelimit';
import { createUploadGrant } from '@/lib/server/storage';
import { uploadRequestSchema } from '@/lib/validation/upload';
import { clientIp, parseInput, run } from './_shared';

export async function requestPhotoUploadAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('upload', await clientIp());
    const { contentType, size } = parseInput(uploadRequestSchema, input);
    return createUploadGrant(contentType, size);
  });
}
