/**
 * Lexicon's letter arithmetic, shared by the game (`./logic.ts`) and the content pipeline that
 * makes the daily puzzles (`scripts/content/words/`). Pure. Words are lower-case a–z only; the
 * dictionary order is plain letter order (a < ab < b), which for a–z words is code-unit order.
 */

/** Letters in a day's jumble. */
export const JUMBLE_SIZE = 9;
/** The shortest word a guess (or a dictionary entry) may be. */
export const MIN_WORD = 3;
/** Answers are this long. */
export const ANSWER_LENGTHS = { min: 5, max: 7 } as const;

/** A typed guess as the game compares it: trimmed and lower-cased. */
export function normalizeWord(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Only the letters a to z. */
export function isLetters(word: string): boolean {
  return /^[a-z]+$/.test(word);
}

/** How many of each letter `text` has. */
export function letterCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return counts;
}

/** Whether `word` can be spelled from `letters`, each letter used at most once. */
export function canSpell(word: string, letters: string): boolean {
  const available = letterCounts(letters);
  for (const ch of word) {
    const left = available.get(ch) ?? 0;
    if (left === 0) return false;
    available.set(ch, left - 1);
  }
  return true;
}

/** Dictionary order (a–z words): negative if `a` comes first. */
export function compareWords(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Where `word` is in the sorted list `words`, or -1. Binary search. */
export function indexOfWord(words: readonly string[], word: string): number {
  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const order = compareWords(words[mid]!, word);
    if (order === 0) return mid;
    if (order < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Guesses a perfect player needs at most to find any word among `count` (always guessing the middle). */
export function perfectGuesses(count: number): number {
  return Math.max(1, Math.ceil(Math.log2(count + 1)));
}
