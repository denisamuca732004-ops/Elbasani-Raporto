/**
 * "Ask or search": matching what a resident types against the guide (the
 * questions and answers the admin manages) and against the report types.
 * Runs in the browser, so answers appear instantly while typing, with no
 * request to the server and no AI. Safe to import from server code too.
 *
 *   "si raportoj"            → "Si raportoj një problem?"
 *   "a më shohin emrin"      → "A e shohin të tjerët emrin tim?"
 *   "zjarr"                  → the emergency numbers, first and already open
 *   "si raportoj një gropë"  → the guide answer AND the report type "Gropë në rrugë"
 */
import type { GuideAction } from './domain';

export interface GuideItem {
  id: number;
  questionSq: string;
  questionEn: string;
  answerSq: string;
  answerEn: string;
  keywords: string | null;
  action: GuideAction;
  emergency: boolean;
}

/** The only places a guide button can lead to. The admin picks one; no free links. */
export const GUIDE_ACTION_HREF: Readonly<Record<Exclude<GuideAction, 'NONE'>, string>> = {
  REPORT: '/raporto',
  TRACK: '/ndiq',
  MAP: '/harta',
  STATS: '/statistika',
  PRIVACY: '/privatesia',
  CALL_112: 'tel:112',
};

export function guideHref(action: GuideAction): string | null {
  return action === 'NONE' ? null : GUIDE_ACTION_HREF[action];
}

/** Lower case, without accents: "Ë", "ç", "é" → "e", "c", "e". */
export const normalise = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Words that say nothing about the topic (Albanian and English, already normalised). */
const STOP_WORDS = new Set([
  // Albanian
  'nje', 'per', 'dhe', 'por', 'apo', 'ose', 'nga', 'tek', 'mbi', 'pas', 'para', 'deri', 'edhe', 'qe', 'kjo', 'ky', 'keto', 'ato', 'ata',
  'cfare', 'cila', 'cili', 'cilat', 'cilet', 'kur', 'ku', 'pse', 'jam', 'jemi', 'eshte', 'jane', 'ishte', 'mund', 'duhet', 'dua', 'doja',
  'nese', 'sepse', 'pra', 'atehere', 'vetem', 'une', 'ju', 'juaj', 'tuaj', 'tim', 'time', 'ime', 'yne', 'kam', 'ke', 'ka', 'kemi', 'keni', 'kane', 'nuk', 'mos', 'bej', 'behet',
  'bere', 'beni', 'tani', 'sot', 'pak', 'shume', 'gjithe', 'cdo', 'ndonje', 'ai', 'ajo', 'atij', 'asaj', 'ketu', 'atje', 'lutem', 'faleminderit',
  // English
  'the', 'and', 'for', 'are', 'was', 'can', 'how', 'what', 'why', 'who', 'when', 'where', 'which', 'does', 'did', 'you', 'your', 'yours',
  'this', 'that', 'there', 'with', 'have', 'has', 'get', 'should', 'would', 'could', 'need', 'want', 'from', 'about', 'please', 'mine',
]);

/** The meaningful words of a text: at least 3 characters (or a number), stop words removed. */
export function significantWords(text: string): string[] {
  return normalise(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOP_WORDS.has(w));
}

/**
 * Two words match when one starts with the other ("raport" ~ "raportoj") or
 * when they differ only in the ending ("gropa" ~ "grope", "zgjat" ~ "zgjate").
 */
export function wordsMatch(typed: string, word: string): boolean {
  if (word.startsWith(typed) || (word.length >= 4 && typed.startsWith(word))) return true;
  const shorter = Math.min(typed.length, word.length);
  if (shorter < 5) return false;
  let common = 0;
  while (common < shorter && typed[common] === word[common]) common += 1;
  return common >= shorter - 1;
}

interface Prepared {
  item: GuideItem;
  words: string[];
  phrases: string[];
}

/** Keywords are comma-separated: single words are matched word by word, phrases as a whole. */
function prepare(item: GuideItem): Prepared {
  const keywords = (item.keywords ?? '').split(',').map((k) => normalise(k).trim().replace(/\s+/g, ' ')).filter(Boolean);
  const single = keywords.filter((k) => !k.includes(' '));
  const phrases = keywords.filter((k) => k.includes(' '));
  const words = [...new Set([...significantWords(`${item.questionSq} ${item.questionEn}`), ...single.flatMap((k) => significantWords(k))])];
  return { item, words, phrases };
}

export interface GuideMatch {
  item: GuideItem;
  score: number;
}

/**
 * The best answers for what was typed, at most `limit`. Emergencies come
 * first whenever they match; then the highest score; then the admin's order
 * (the order of `items`).
 */
export function matchGuide(items: GuideItem[], query: string, limit = 3): GuideMatch[] {
  const typed = significantWords(query);
  const text = ` ${normalise(query).replace(/[^a-z0-9]+/g, ' ').trim()} `;
  if (!typed.length) return [];
  const results: Array<GuideMatch & { order: number }> = [];
  items.forEach((item, order) => {
    const p = prepare(item);
    let score = 0;
    for (const t of typed) if (p.words.some((w) => wordsMatch(t, w))) score += 1;
    for (const phrase of p.phrases) if (text.includes(` ${phrase} `)) score += 2;
    if (score > 0) results.push({ item, score, order });
  });
  results.sort((a, b) => Number(b.item.emergency) - Number(a.item.emergency) || b.score - a.score || a.order - b.order);
  return results.slice(0, limit).map(({ item, score }) => ({ item, score }));
}

/** Words too general to pick a report type ("raportoj", "problem", "rruga"…). */
const GENERIC_PREFIXES = ['raport', 'problem', 'kerkes', 'rrug', 'sherbim', 'bashki', 'lagj', 'report', 'request', 'street', 'servic', 'municip'];

interface TypeLike {
  nameSq: string;
  nameEn: string;
  category: { nameSq: string; nameEn: string };
}

/**
 * Report types for what was typed: first the exact text inside a type or
 * category name ("gropë", "dritë rruge"); if none, word by word, so a
 * question such as "si raportoj një gropë" still offers "Gropë në rrugë".
 */
export function matchTypes<T extends TypeLike>(types: T[], query: string, limit = 6): T[] {
  const q = normalise(query.trim());
  if (q.length < 2) return [];
  const haystack = (ty: T) => normalise(`${ty.nameSq} ${ty.nameEn} ${ty.category.nameSq} ${ty.category.nameEn}`);
  const direct = types.filter((ty) => haystack(ty).includes(q));
  if (direct.length) return direct.slice(0, limit);
  const typed = significantWords(query).filter((w) => !GENERIC_PREFIXES.some((g) => w.startsWith(g)));
  if (!typed.length) return [];
  return types
    .map((ty, order) => {
      const words = significantWords(haystack(ty));
      return { ty, order, score: typed.filter((t) => words.some((w) => wordsMatch(t, w))).length };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((r) => r.ty);
}
