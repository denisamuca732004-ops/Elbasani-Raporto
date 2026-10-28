/**
 * Development and tests only (no BLOB_READ_WRITE_TOKEN): receives a photo sent
 * to the HMAC-signed address made by actions/upload.ts. With Vercel Blob
 * configured this address answers 404 and the browser uploads to Blob.
 */
import { NextResponse } from 'next/server';
import { handle } from '@/lib/server/http';
import { receiveLocalUpload } from '@/lib/server/storage';

export async function PUT(request: Request) {
  return handle(async () => {
    const result = await receiveLocalUpload(new URL(request.url).searchParams, request.headers.get('content-type'), await request.arrayBuffer());
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  });
}
