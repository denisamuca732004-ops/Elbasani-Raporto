/** Zod schema for asking permission to upload a photo (actions/upload.ts). */
import { z } from 'zod';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const uploadRequestSchema = z.strictObject({
  contentType: z.enum(IMAGE_TYPES),
  /** Bytes; the real size is checked again on the server after the upload. */
  size: z.coerce.number().int().min(1),
});
export type UploadRequest = z.output<typeof uploadRequestSchema>;
