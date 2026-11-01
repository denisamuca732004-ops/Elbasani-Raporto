/**
 * A cheap check for a description that says nothing: letters typed at random
 * to get past the form ("asdfkz kcp zvkmv"), one letter repeated, or no words
 * at all. Runs in the browser and on the server, without the AI (the AI check,
 * when on, also catches "test test test" and text about something else).
 * Loose on purpose: a short or misspelled real description passes.
 */
export function looksLikeGibberish(text: string): boolean {
  const plain = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''); // ë → e, ç → c
  const letters = plain.match(/\p{L}/gu) ?? [];
  if (letters.length < 4 || new Set(letters).size < 4) return true; // "1234567890", "aaaaaaaaaa"
  const vowels = letters.filter((c) => 'aeiouy'.includes(c)).length;
  if (vowels / letters.length < 0.2) return true; // Albanian and English text: about 0.35–0.45
  const words = plain.split(/[^\p{L}]+/u).filter((w) => w.length >= 2);
  if (words.length < 2) return true;
  const long = words.filter((w) => w.length >= 3);
  const withoutVowel = long.filter((w) => !/[aeiouy]/.test(w)).length;
  return long.length > 0 && withoutVowel / long.length > 0.5;
}
