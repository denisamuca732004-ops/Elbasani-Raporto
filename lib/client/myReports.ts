/**
 * What this phone or browser remembers about reports, without an account:
 * the reports made on it (so their author is never offered "I have this
 * problem too" on their own report) and the reports it already supported.
 * Kept in localStorage only; if storage is blocked, nothing is remembered and
 * the pages still work.
 */
const MINE = 'er-my-reports';
const SUPPORTED = 'er-supported-reports';
const MAX = 100;

function read(key: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function add(key: string, caseNumber: string): void {
  try {
    const list = [caseNumber, ...read(key).filter((c) => c !== caseNumber)].slice(0, MAX);
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage blocked (private window): nothing to remember */
  }
}

/** A report was created on this device. */
export const rememberMine = (caseNumber: string) => add(MINE, caseNumber);
export const isMine = (caseNumber: string) => read(MINE).includes(caseNumber);

/** This device already said "I have this problem too". */
export const rememberSupported = (caseNumber: string) => add(SUPPORTED, caseNumber);
export const hasSupported = (caseNumber: string) => read(SUPPORTED).includes(caseNumber);
