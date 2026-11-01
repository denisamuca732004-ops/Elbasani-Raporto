/**
 * The photo check while a report is created: the date of a photo picked from
 * the gallery (read in the browser, without the AI), and what happens when the
 * AI is off. The AI answers themselves are tested in ai.test.ts.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import { exifDateFromJpeg, isOldPhoto, parseExifDate } from '@/lib/client/photoDate';
import { hideKeys, testAiConnection } from '@/lib/server/ai';
import { checkPhoto, verdictOf } from '@/lib/server/services/photoCheck';

const photoWithExif = (exif: Record<string, Record<string, string>>) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#556655' } }).jpeg().withExif(exif).toBuffer();

describe('the date of a photo (an old photo from the gallery)', () => {
  test('the camera date of a phone photo is read from its EXIF data', async () => {
    const original = await photoWithExif({ IFD0: { DateTime: '2026:10:30 09:00:00' }, IFD2: { DateTimeOriginal: '2025:03:12 18:40:05' } });
    const date = exifDateFromJpeg(new Uint8Array(original));
    assert.ok(date);
    assert.equal(date.getFullYear(), 2025);
    assert.equal(date.getMonth(), 2);
    assert.equal(date.getDate(), 12);
    // Without DateTimeOriginal the DateTime of the file is used.
    const edited = exifDateFromJpeg(new Uint8Array(await photoWithExif({ IFD0: { DateTime: '2026:10:30 09:00:00' } })));
    assert.equal(edited?.getFullYear(), 2026);
  });

  test('a photo without a date, or not a JPEG, gives no date (and never an error)', async () => {
    const plain = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).jpeg().toBuffer();
    assert.equal(exifDateFromJpeg(new Uint8Array(plain)), null);
    assert.equal(exifDateFromJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
    assert.equal(exifDateFromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00])), null);
    assert.equal(parseExifDate('0000:00:00 00:00:00'), null);
  });

  test('only a photo older than a week counts as old', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    assert.equal(isOldPhoto(new Date('2026-10-30T12:00:00Z'), now), false);
    assert.equal(isOldPhoto(new Date('2026-10-20T12:00:00Z'), now), true);
    assert.equal(isOldPhoto(null, now), false);
  });
});

describe('the photo check without the AI', () => {
  test('with the AI off nothing is checked and nothing is refused', async () => {
    assert.deepEqual(await checkPhoto('tmp/00000000-0000-4000-8000-000000000000.jpg', 1), { verdict: 'unchecked' });
    assert.deepEqual(await testAiConnection(), { ok: false, problem: 'disabled' });
  });

  test('an error text never shows an API key', () => {
    assert.equal(hideKeys('Incorrect API key provided: sk-proj-abc123XYZ****wxyz.'), 'Incorrect API key provided: sk-….');
    assert.equal(hideKeys('AI HTTP 500: boom'), 'AI HTTP 500: boom');
  });

  test('only an explicit "false" refuses or warns (an odd answer lets the photo through)', () => {
    assert.equal(verdictOf({ safe: false, matches: true }), 'inappropriate');
    assert.equal(verdictOf({ safe: true, matches: false }), 'unrelated');
    assert.equal(verdictOf({ safe: true, matches: false, kind: 'document' }), 'not_photo');
    assert.equal(verdictOf({ safe: true, matches: false, kind: 'screenshot' }), 'not_photo');
    assert.equal(verdictOf({ safe: true, matches: false, kind: 'people' }), 'unrelated');
    assert.equal(verdictOf({ safe: true, matches: true, kind: 'screenshot' }), 'ok', 'a screenshot that shows the problem (e.g. a photo of it) is not refused');
    assert.equal(verdictOf({ safe: true, matches: true }), 'ok');
    assert.equal(verdictOf({}), 'ok');
    assert.equal(verdictOf({ safe: 'no', matches: 'maybe' }), 'ok');
  });
});
