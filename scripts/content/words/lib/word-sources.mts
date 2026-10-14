/**
 * Readers for the free word sources Lexicon is built from (see `../lexicon-data.mts`). Pure: each
 * takes a file's text.
 *
 * - 12dicts (Alan Beale; public domain, with AGID's notice for the inflected lists):
 *   `International/3of6game.txt`, a list made for word games (no names, abbreviations or
 *   hyphenations; inflections included), and `Lemmatized/2+2+3frq.txt`, headwords in frequency
 *   groups (1 = the most common).
 * - WordNet 3.1 (Princeton; free with its notice): `index.<pos>` and `data.<pos>`, for a word's
 *   commonest sense, its definition, and whether a dictionary marks it vulgar or a slur.
 */

const lines = (text: string) => text.replace(/\r/g, "").split("\n");

/** 3of6game: every entry, lower case a–z, `minLength`–`maxLength` letters, annotation marks dropped ($ + ^ & !). */
export function parseGameList(text: string, minLength: number, maxLength: number): string[] {
  const words = new Set<string>();
  for (const raw of lines(text)) {
    const entry = raw.trim().replace(/[$+^&!]+$/, "");
    if (!/^[a-z]+$/.test(entry)) continue; // capitals or other characters: not a plain word
    if (entry.length >= minLength && entry.length <= maxLength) words.add(entry);
  }
  return [...words].sort();
}

/** 2+2+3frq: each headword and its frequency group. Indented lines are its inflections, skipped. */
export function parseFrequencyGroups(text: string): Map<string, number> {
  const groups = new Map<string, number>();
  let group = 0;
  for (const raw of lines(text)) {
    const marker = /^-+\s*(\d+)\s*-+$/.exec(raw.trim());
    if (marker) {
      group = Number(marker[1]);
      continue;
    }
    if (!raw || /^\s/.test(raw)) continue;
    const word = raw.trim();
    if (group > 0 && !groups.has(word)) groups.set(word, group);
  }
  return groups;
}

export type WordNetPos = "noun" | "verb" | "adjective" | "adverb";
export const WORDNET_FILES: Record<WordNetPos, string> = { noun: "noun", verb: "verb", adjective: "adj", adverb: "adv" };

export interface IndexEntry {
  pos: WordNetPos;
  /** How often the word's senses were tagged in WordNet's corpus: how common the word is in this part of speech. */
  tagged: number;
  /** Its synsets, commonest sense first. */
  offsets: string[];
}

/** index.<pos>: lemma → its entry. The license header (lines starting with spaces) is skipped. */
export function parseWordNetIndex(text: string, pos: WordNetPos): Map<string, IndexEntry> {
  const entries = new Map<string, IndexEntry>();
  for (const line of lines(text)) {
    if (!line || line.startsWith(" ")) continue;
    const t = line.trim().split(/\s+/);
    const synsets = Number(t[2]);
    const pointers = Number(t[3]);
    const tagged = Number(t[5 + pointers]);
    const offsets = t.slice(6 + pointers, 6 + pointers + synsets);
    if (!Number.isFinite(tagged) || offsets.length !== synsets) continue;
    entries.set(t[0]!, { pos, tagged, offsets });
  }
  return entries;
}

export interface Synset {
  words: string[];
  /** Usage-domain targets (`;u` pointers): the synsets naming the usage this one is marked with. */
  usage: string[];
  gloss: string;
}

/** data.<pos>: offset → synset (its words, usage domains and gloss). */
export function parseWordNetData(text: string): Map<string, Synset> {
  const synsets = new Map<string, Synset>();
  for (const line of lines(text)) {
    if (!line || line.startsWith(" ")) continue;
    const bar = line.indexOf(" | ");
    const head = (bar >= 0 ? line.slice(0, bar) : line).trim().split(/\s+/);
    const gloss = bar >= 0 ? line.slice(bar + 3).trim() : "";
    const offset = head[0]!;
    const wordCount = parseInt(head[3]!, 16);
    const words = Array.from({ length: wordCount }, (_, i) => head[4 + 2 * i]!.toLowerCase());
    let at = 4 + 2 * wordCount;
    const pointerCount = Number(head[at]);
    at++;
    const usage: string[] = [];
    for (let p = 0; p < pointerCount; p++, at += 4) {
      if (head[at] === ";u") usage.push(head[at + 1]!);
    }
    synsets.set(offset, { words, usage, gloss });
  }
  return synsets;
}

/**
 * A gloss's definition as a dictionary's first line: its first clause only (WordNet runs on with
 * more clauses and quoted examples after semicolons), cut at a word near `max`.
 * `a small boat; propelled by oars; "we rowed"` → `a small boat`.
 */
export function definitionOf(gloss: string, max = 160): string {
  const first = (gloss.split(/;\s*/)[0] ?? "").replace(/\s+/g, " ").trim();
  if (first.startsWith('"') || first.startsWith("'")) return "";
  return first.length > max ? `${first.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : first;
}

/** Usage domains marking a sense as rude: vulgarisms, obscenities, profanity. */
export const RUDE_USAGE_LEMMAS = ["vulgarism", "obscenity", "profanity"] as const;
/** Usage domains marking a sense as aimed at people: slurs and disparagement. */
export const SLUR_USAGE_LEMMAS = ["ethnic_slur", "slur", "disparagement", "derogation"] as const;
/** The usage domains that keep a word out of the answers: rude senses and slurs alike. */
export const OFFENSIVE_USAGE_LEMMAS = [...RUDE_USAGE_LEMMAS, ...SLUR_USAGE_LEMMAS] as const;

/** The synsets naming these usage domains (the targets of `;u` pointers that mark a sense with them). */
export function usageDomains(nouns: ReadonlyMap<string, IndexEntry>, lemmas: readonly string[]): Set<string> {
  return new Set(lemmas.flatMap((lemma) => nouns.get(lemma)?.offsets ?? []));
}

/** `index.sense`'s synset types; 5 is an adjective satellite, kept with the adjectives in `data.adj`. */
const SENSE_POS: Record<string, WordNetPos> = { "1": "noun", "2": "verb", "3": "adjective", "4": "adverb", "5": "adjective" };

export interface SenseCount {
  lemma: string;
  pos: WordNetPos;
  /** The sense's synset in its part of speech's data file. */
  offset: string;
  /** How many times WordNet's tagged corpus (edited prose) used the word in this sense. */
  tagged: number;
}

/**
 * index.sense: one line per sense of a word, `lemma%type:… offset sense-number tag-count`. Summed
 * over a word's senses, the tag counts say how common it is. Phrases (`ice_cream`) and names with
 * capitals are skipped.
 */
export function parseSenseIndex(text: string): SenseCount[] {
  const senses: SenseCount[] = [];
  for (const line of lines(text)) {
    const [key, offset, , count] = line.trim().split(" ");
    const at = key?.indexOf("%") ?? -1;
    if (!key || !offset || count === undefined || at < 0) continue;
    const lemma = key.slice(0, at);
    const pos = SENSE_POS[key[at + 1]!];
    if (!pos || !/^[a-z]+$/.test(lemma)) continue;
    senses.push({ lemma, pos, offset, tagged: Number(count) });
  }
  return senses;
}
