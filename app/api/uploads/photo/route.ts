/**
 * Receives ONE photo sent to the HMAC-signed address made by actions/upload.ts
 * (the signature fixes the file name, the image type and a 10-minute deadline).
 * Used with a Vercel Blob store connected through OIDC (the server writes the
 * file to Blob) and locally (a folder on disk). With a Blob read-write token the
 * browser uploads straight to Blob instead, and this address answers 404.
 * (The grant itself is rate-limited per IP in actions/upload.ts and works only once.)
 */
import { NextResponse } from 'next/server';
import { handle } from '@/lib/server/http';
import { receiveSignedUpload } from '@/lib/server/storage';

export async function PUT(request: Request) {
  return handle(async () => {
    const result = await receiveSignedUpload(new URL(request.url).searchParams, request.headers.get('content-type'), await request.arrayBuffer());
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  });
}
