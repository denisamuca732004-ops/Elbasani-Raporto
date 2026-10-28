/**
 * Uploads a photo the safe way:
 *  1. the photo is re-drawn in the browser (max 2048 px, JPEG): smaller to
 *     send and without the hidden data of the original file (GPS position);
 *  2. actions/upload.ts gives permission for exactly this one file;
 *  3. the photo goes straight to Vercel Blob with that short-lived token
 *     (or to the local signed address in development).
 * Returns the key the report action needs.
 */
import { put } from '@vercel/blob/client';
import { requestPhotoUploadAction } from '@/actions/upload';
import { ActionFailure, call } from './action';

const MAX_SIDE = 2048;

async function shrink(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (blob) return blob;
  } catch {
    /* the browser cannot decode it: send the original, the server checks it */
  }
  return file;
}

export async function uploadPhoto(file: Blob): Promise<string> {
  const photo = await shrink(file);
  const contentType = (['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) ? photo.type : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';
  const grant = await call(requestPhotoUploadAction({ contentType, size: photo.size }));
  if (grant.driver === 'blob') {
    try {
      await put(grant.key, photo, { access: grant.access, token: grant.clientToken, contentType, multipart: photo.size > 5 * 1024 * 1024 });
    } catch {
      throw new ActionFailure({ code: 'NETWORK', status: 0, message: 'network' });
    }
    return grant.key;
  }
  let res: Response;
  try {
    res = await fetch(grant.uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body: photo });
  } catch {
    throw new ActionFailure({ code: 'NETWORK', status: 0, message: 'network' });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string; status: number } } | null;
    throw new ActionFailure(body?.error ?? { code: 'UPLOAD_FAILED', status: res.status, message: 'upload' });
  }
  return grant.key;
}
