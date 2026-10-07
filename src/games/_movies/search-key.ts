/**
 * The catalog's search normal form, the same as the SQL `catalog_search_key`: lowercase, accents
 * stripped, apostrophes dropped, every other run of non-alphanumerics collapsed to one space,
 * trimmed. Pure; safe on both sides of the wire.
 *
 * An apostrophe is part of its word ("Don't" → "dont", "Ocean's" → "oceans", "O'Toole" →
 * "otoole"), so "don" finds Don as an exact title and Don't Look Up only as the start of a longer
 * word, and "dont look up" and "don't look up" are the same query. SQL's `unaccent` turns every
 * apostrophe-like character into "'" (’ ‘ ‛ ′ ＇ and the modifier letters ʹ ʻ ʼ ʽ ˈ; ŉ into "'n")
 * before the key drops it, so `APOSTROPHES` lists the same set.
 *
 * SQL strips accents with `unaccent`, which also rewrites letters Unicode decomposition leaves
 * alone (ø → o, æ → ae, ı → i, ł → l…), writes vulgar fractions as " 1/2", and drops superscript
 * digits. Those are mirrored here so both sides key a name alike ("Bølgen", "8½", "Hababam Sınıfı").
 */
export function catalogSearchKey(value: string): string {
  return value
    .replace(UNACCENT_LETTERS, (letter) => UNACCENT_MAP[letter]!)
    .replace(FRACTIONS, (fraction) => ` ${fraction}`)
    .replace(SUPERSCRIPTS, "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const UNACCENT_MAP: Readonly<Record<string, string>> = {
  Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", Ø: "O", ø: "o", Ð: "D", ð: "d", Þ: "TH", þ: "th", ß: "ss", ẞ: "SS",
  Đ: "D", đ: "d", Ħ: "H", ħ: "h", ı: "i", Ł: "L", ł: "l", Ŀ: "L", ŀ: "l", Ŋ: "N", ŋ: "n", Ŧ: "T", ŧ: "t",
  Ĳ: "IJ", ĳ: "ij", ĸ: "q",
};
const UNACCENT_LETTERS = new RegExp(`[${Object.keys(UNACCENT_MAP).join("")}]`, "g");
const FRACTIONS = /[¼-¾⅐-⅞]/g;
const SUPERSCRIPTS = /[²³¹⁰-₟]/g;
/** After NFKD (which turns ＇ into ' and ŉ into ʼn): every character `unaccent` maps to an apostrophe. */
const APOSTROPHES = /['ʹʻʼʽˈ‘’‛′]/g;

/** Shortest normalized query worth sending to the catalog ("e." normalizes to "e", too short). */
export const CATALOG_MIN_QUERY_KEY = 2;
