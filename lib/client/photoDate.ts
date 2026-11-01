/**
 * When a photo was taken, read in the browser before the photo is made
 * smaller (making it smaller drops this information, and the server removes
 * it from the stored copy anyway). Used to warn about an old photo picked by
 * mistake from the gallery. Works without the AI and without a connection.
 *
 * JPEG photos from a phone carry the camera time in their EXIF data
 * (DateTimeOriginal, or DateTime). Without it, the file's date is used.
 */

/** "2026:03:12 18:40:05" (local camera time) → a Date, or null. */
export function parseExifDate(text: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  if (y < 1990 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The EXIF date inside the first bytes of a JPEG, or null. Never throws. */
export function exifDateFromJpeg(bytes: Uint8Array): Date | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      const size = view.getUint16(offset + 2);
      if ((marker & 0xff00) !== 0xff00 || size < 2) return null;
      // APP1 "Exif\0\0"
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
        return readTiffDate(view, offset + 10);
      }
      if (marker === 0xffda) return null; // image data starts: no EXIF before it
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

function readTiffDate(view: DataView, tiff: number): Date | null {
  const little = view.getUint16(tiff) === 0x4949; // "II" = little-endian, "MM" = big-endian
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const ascii = (at: number, length: number) => {
    let out = '';
    for (let i = 0; i < length; i += 1) {
      const c = view.getUint8(at + i);
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return out;
  };
  /** The value of `tag` (ASCII) or of a pointer tag in the directory at `ifd`. */
  const find = (ifd: number, tag: number): { text?: string; pointer?: number } | null => {
    const count = u16(ifd);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) !== tag) continue;
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      if (type === 2) return { text: ascii(n > 4 ? tiff + u32(entry + 8) : entry + 8, n) }; // ASCII
      if (type === 4) return { pointer: u32(entry + 8) }; // LONG
      return null;
    }
    return null;
  };
  const ifd0 = tiff + u32(tiff + 4);
  const exifPointer = find(ifd0, 0x8769)?.pointer;
  const original = exifPointer !== undefined ? find(tiff + exifPointer, 0x9003)?.text : undefined; // DateTimeOriginal
  return parseExifDate(original ?? find(ifd0, 0x0132)?.text ?? ''); // or DateTime
}

/** When the photo was taken: EXIF date of a JPEG, else the file's date, else null. */
export async function photoTakenAt(file: File): Promise<Date | null> {
  if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) {
    try {
      const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
      const exif = exifDateFromJpeg(head);
      if (exif) return exif;
    } catch {
      /* unreadable: fall back to the file's date */
    }
  }
  return file.lastModified > 0 ? new Date(file.lastModified) : null;
}

/** A photo older than this (in days) gets "is this the problem as it is today?". */
export const OLD_PHOTO_DAYS = 7;

export function isOldPhoto(takenAt: Date | null, now = Date.now()): boolean {
  return takenAt !== null && now - takenAt.getTime() > OLD_PHOTO_DAYS * 86_400_000;
}
