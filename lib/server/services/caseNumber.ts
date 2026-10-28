/** Readable case numbers like EL-2026-00042: unique and gap-free per year (Tirana time). */
import 'server-only';
import type { Tx } from '../db';
import { config } from '../env';

const yearInTirana = (date: Date): number =>
  Number(new Intl.DateTimeFormat('en', { timeZone: config().rules.timezone, year: 'numeric' }).format(date));

export async function nextCaseNumber(tx: Tx, date = new Date()): Promise<string> {
  const year = yearInTirana(date);
  // One atomic statement (parameterised): two reports at the same moment never get the same number.
  const rows = await tx.$queryRaw<Array<{ last_seq: number }>>`
    INSERT INTO case_counters (year, last_seq) VALUES (${year}, 1)
    ON CONFLICT (year) DO UPDATE SET last_seq = case_counters.last_seq + 1
    RETURNING last_seq`;
  const seq = rows[0]?.last_seq;
  if (!seq) throw new Error('Could not allocate a case number');
  return `${config().rules.casePrefix}-${year}-${String(seq).padStart(5, '0')}`;
}
