/**
 * Albanian by default, English as an option. t('section.key', { n: 3 }) replaces {n}.
 * A text can have a singular and a plural form: { one: '1 raportim', other: '{n} raportime' };
 * the form is picked from {n}. Used by server and browser code alike.
 */
import en from './en';
import sq from './sq';

export type Lang = 'sq' | 'en';
export const DICTS = { sq, en } as const;
export type Vars = Record<string, string | number | null | undefined>;
export type Translate = (key: string, vars?: Vars) => string;

export const isPlural = (value: unknown): value is { one: string; other: string } =>
  Boolean(value) && typeof value === 'object' && typeof (value as { one?: unknown }).one === 'string' && typeof (value as { other?: unknown }).other === 'string';

function lookup(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), dict);
}

export function translator(lang: Lang): Translate {
  return (key, vars) => {
    let text = lookup(DICTS[lang], key) ?? lookup(sq, key) ?? key;
    if (isPlural(text)) text = Number(vars?.n) === 1 ? text.one : text.other;
    if (typeof text !== 'string') return key;
    return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text;
  };
}

export const normaliseLang = (value: string | undefined | null): Lang => (value === 'en' ? 'en' : 'sq');
export const LANG_COOKIE = 'er_lang';
