/** Random tokens and their hashes. Only hashes are stored in the database. */
import 'server-only';
import crypto from 'node:crypto';

/** Random URL-safe token (sent to a person) and its SHA-256 hash (stored). */
export function createToken(bytes = 24): { token: string; hash: string } {
  const token = crypto.randomBytes(bytes).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Readable temporary password, e.g. "Elb-7k3q-9xw2-m4pt" (about 70 bits). No ambiguous characters. */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const group = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return `Elb-${group()}-${group()}-${group()}`;
}
