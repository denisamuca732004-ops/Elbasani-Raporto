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
/** This device has sent at least one report (the install bar waits for that). */
export const hasReported = () => read(MINE).length > 0;

/** This device said "yes, the same problem" in the report form. */
export const rememberSupported = (caseNumber: string) => add(SUPPORTED, caseNumber);

/**
 * The random reference of the form that sent each report on this device: it proves, without an
 * account, that this device may answer "A u rregullua?" on the report's page.
 */
const REFS = 'er-my-report-refs';
export function rememberRef(caseNumber: string, clientRef: string): void {
  try {
    const map = JSON.parse(window.localStorage.getItem(REFS) ?? '{}') as Record<string, string>;
    map[caseNumber] = clientRef;
    const keys = Object.keys(map);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete map[k];
    window.localStorage.setItem(REFS, JSON.stringify(map));
  } catch {
    /* storage blocked: the answer then comes only through the notification link */
  }
}
export function refFor(caseNumber: string): string | null {
  try {
    const map = JSON.parse(window.localStorage.getItem(REFS) ?? '{}') as Record<string, unknown>;
    const v = map[caseNumber];
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}
