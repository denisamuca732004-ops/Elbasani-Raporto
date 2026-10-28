/**
 * Photo storage.
 *
 * Production: Vercel Blob. The browser never gets the store's write token:
 *   1. actions/upload.ts asks createUploadGrant() for a short-lived client
 *      token that can write ONE file (tmp/<uuid>.jpg), of ONE image type,
 *      up to UPLOAD_MAX_MB, for 10 minutes;
 *   2. the browser uploads the photo straight to Blob with that token;
 *   3. the report action passes only the key. takeTemporaryUpload() reads the
 *      file on the server, storeImage() re-encodes it with sharp (rotated
 *      upright, max 1600 px, JPEG WITHOUT metadata, so the GPS position hidden
 *      in phone photos is never kept) and the temporary file is deleted.
 * Files are private: people only see them through /api/files/[id], which
 * checks who may look. Storage URLs never reach a browser.
 *
 * Development and tests (no BLOB_READ_WRITE_TOKEN): the same flow with a
 * local folder and an HMAC-signed upload address (/api/uploads/local).
 */
import 'server-only';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { del, get, head, list, put } from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import sharp from 'sharp';
import type { ImageType } from '@/lib/validation/upload';
import { config } from './env';
import { AppError, notFound } from './errors';

const EXT: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const TMP_KEY = /^tmp\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const STORED_KEY = /^reports\/\d{4}-\d{2}\/[0-9a-f-]{36}\.jpg$/;
const GRANT_MINUTES = 10;
/** Vercel Blob stores are private by default here; set BLOB_ACCESS=public only for a public store. */
const access = (): 'private' | 'public' => (process.env.BLOB_ACCESS === 'public' ? 'public' : 'private');

export type UploadGrant =
  | { driver: 'blob'; key: string; clientToken: string; access: 'private' | 'public'; contentType: ImageType; maxBytes: number }
  | { driver: 'local'; key: string; uploadUrl: string; contentType: ImageType; maxBytes: number };

export interface StoredImage { key: string; url: string; mime: 'image/jpeg'; size: number; width: number; height: number }

const photoError = (message: string, code = 'invalid') =>
  new AppError(400, 'PHOTO_INVALID', message, [{ field: 'photo', code, message, step: 'photo' }]);

const blobToken = () => config().storage.blobToken;
// Local disk is only used in development and tests (Vercel Blob in production): keep it out of the build's file tracing.
const localRoot = () => path.resolve(/*turbopackIgnore: true*/ process.cwd(), config().storage.localDir);

function localPath(key: string): string {
  const full = path.resolve(/*turbopackIgnore: true*/ localRoot(), key);
  if (!full.startsWith(localRoot() + path.sep)) throw notFound('Skedari nuk u gjet.');
  return full;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', config().auth.secret).update(`local-upload:${payload}`).digest('base64url');
}

/* ─── 1. Permission to upload one photo ─── */

export async function createUploadGrant(contentType: ImageType, declaredSize: number): Promise<UploadGrant> {
  const maxBytes = config().storage.maxBytes;
  if (declaredSize > maxBytes) throw photoError(`Fotoja është shumë e madhe (maksimumi ${Math.round(maxBytes / 1048576)} MB).`, 'too_large');
  const key = `tmp/${crypto.randomUUID()}.${EXT[contentType]}`;
  const validUntil = Date.now() + GRANT_MINUTES * 60_000;
  const token = blobToken();
  if (token) {
    const clientToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname: key,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: maxBytes,
      validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return { driver: 'blob', key, clientToken, access: access(), contentType, maxBytes };
  }
  const payload = `${key}|${validUntil}|${contentType}`;
  const query = new URLSearchParams({ key, exp: String(validUntil), type: contentType, sig: sign(payload) });
  return { driver: 'local', key, uploadUrl: `/api/uploads/local?${query}`, contentType, maxBytes };
}

/** Local driver: receives the file sent to the signed /api/uploads/local address. */
export async function receiveLocalUpload(params: URLSearchParams, contentType: string | null, body: ArrayBuffer): Promise<{ key: string }> {
  if (blobToken()) throw notFound();
  const key = params.get('key') ?? '';
  const exp = Number(params.get('exp'));
  const type = params.get('type') ?? '';
  const sig = params.get('sig') ?? '';
  const expected = sign(`${key}|${exp}|${type}`);
  const valid = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid || !TMP_KEY.test(key)) throw new AppError(403, 'FORBIDDEN', 'Adresa e ngarkimit nuk është e vlefshme.');
  if (!Number.isFinite(exp) || exp < Date.now()) throw new AppError(403, 'FORBIDDEN', 'Koha për ngarkimin mbaroi. Provoni përsëri.');
  if ((contentType ?? '').split(';')[0] !== type) throw photoError('Lloji i fotos nuk përputhet.');
  if (body.byteLength === 0) throw photoError('Fotoja është bosh.');
  if (body.byteLength > config().storage.maxBytes) throw photoError('Fotoja është shumë e madhe.', 'too_large');
  const file = localPath(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, Buffer.from(body), { flag: 'wx' });
  } catch {
    throw new AppError(409, 'CONFLICT', 'Kjo foto është ngarkuar tashmë.');
  }
  return { key };
}

/* ─── 2. Reading the uploaded file on the server ─── */

async function readStream(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw photoError('Fotoja është shumë e madhe.', 'too_large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** The bytes of a temporary upload. Throws a photo error the form can show if it is missing or too large. */
export async function takeTemporaryUpload(key: string): Promise<Buffer> {
  if (!TMP_KEY.test(key)) throw photoError('Fotoja nuk u gjet. Ngarkojeni përsëri.', 'required');
  const maxBytes = config().storage.maxBytes;
  const token = blobToken();
  if (token) {
    let meta;
    try {
      meta = await head(key, { token });
    } catch {
      throw photoError('Fotoja nuk u gjet. Ngarkojeni përsëri.', 'required');
    }
    if (meta.size > maxBytes) throw photoError('Fotoja është shumë e madhe.', 'too_large');
    if (!meta.contentType.startsWith('image/')) throw photoError('Pranohen vetëm foto JPEG, PNG ose WebP.');
    const file = await get(key, { access: access(), token, useCache: false });
    if (!file || file.statusCode !== 200 || !file.stream) throw photoError('Fotoja nuk u gjet. Ngarkojeni përsëri.', 'required');
    return readStream(file.stream, maxBytes);
  }
  try {
    const buffer = await fs.readFile(localPath(key));
    if (buffer.length > maxBytes) throw photoError('Fotoja është shumë e madhe.', 'too_large');
    return buffer;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw photoError('Fotoja nuk u gjet. Ngarkojeni përsëri.', 'required');
  }
}

export async function discardTemporaryUpload(key: string): Promise<void> {
  if (!TMP_KEY.test(key)) return;
  const token = blobToken();
  try {
    if (token) await del(key, { token });
    else await fs.unlink(localPath(key));
  } catch {
    /* already gone; the daily clean-up removes leftovers */
  }
}

/* ─── 3. Saving a clean copy ─── */

export async function storeImage(buffer: Buffer): Promise<StoredImage> {
  let data: Buffer;
  let info: { width: number; height: number };
  try {
    ({ data, info } = await sharp(buffer, { failOn: 'error', limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw photoError('Fotoja nuk u lexua. Provoni një foto tjetër.');
  }
  const key = `reports/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`;
  const token = blobToken();
  let url: string;
  if (token) {
    const saved = await put(key, data, { access: access(), token, contentType: 'image/jpeg', addRandomSuffix: false, cacheControlMaxAge: 31_536_000 });
    url = saved.url;
  } else {
    const file = localPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
    url = `local:${key}`;
  }
  return { key, url, mime: 'image/jpeg', size: data.length, width: info.width, height: info.height };
}

/** Takes a temporary upload, saves a clean copy and removes the temporary file. */
export async function storeUploadedPhoto(tmpKey: string): Promise<StoredImage> {
  const stored = await storeImage(await takeTemporaryUpload(tmpKey));
  await discardTemporaryUpload(tmpKey);
  return stored;
}

/* ─── 4. Serving and removing saved photos ─── */

export async function openStoredImage(file: { storageKey: string }): Promise<{ body: ReadableStream<Uint8Array> | Buffer; size: number | null }> {
  if (!STORED_KEY.test(file.storageKey)) throw notFound('Fotoja nuk u gjet.');
  const token = blobToken();
  if (token) {
    const result = await get(file.storageKey, { access: access(), token });
    if (!result || result.statusCode !== 200 || !result.stream) throw notFound('Fotoja nuk u gjet.');
    return { body: result.stream, size: result.blob.size };
  }
  try {
    const buffer = await fs.readFile(localPath(file.storageKey));
    return { body: buffer, size: buffer.length };
  } catch {
    throw notFound('Fotoja nuk u gjet.');
  }
}

export async function deleteStoredImage(storageKey: string): Promise<void> {
  if (!STORED_KEY.test(storageKey)) return;
  const token = blobToken();
  try {
    if (token) await del(storageKey, { token });
    else await fs.unlink(localPath(storageKey));
  } catch {
    /* already gone */
  }
}

/** A small JPEG as a data URL, for the AI model. */
export async function imageDataUrl(file: { storageKey: string }, maxSize = 1024): Promise<string> {
  const { body } = await openStoredImage(file);
  const buffer = Buffer.isBuffer(body) ? body : await readStream(body, 50 * 1024 * 1024);
  const small = await sharp(buffer).resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  return `data:image/jpeg;base64,${small.toString('base64')}`;
}

/** Removes temporary uploads that were never attached to a report. */
export async function cleanupTemporaryUploads(olderThanMs = 24 * 3600_000): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  const token = blobToken();
  if (token) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: 'tmp/', cursor, limit: 500, token });
      const old = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff).map((b) => b.pathname);
      if (old.length) {
        await del(old, { token });
        removed += old.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return removed;
  }
  const dir = path.join(/*turbopackIgnore: true*/ localRoot(), 'tmp');
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    const file = path.join(/*turbopackIgnore: true*/ dir, name);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.unlink(file).catch(() => undefined);
      removed += 1;
    }
  }
  return removed;
}

