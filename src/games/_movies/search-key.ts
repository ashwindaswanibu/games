/**
 * The catalog's search normal form, the same as the SQL `catalog_search_key`: lowercase, accents
 * stripped, apostrophes dropped, every other run of non-alphanumerics collapsed to one space,
 * trimmed. Pure; safe on both sides of the wire.
 *
 * An apostrophe is part of its word ("Don't" → "dont", "Ocean's" → "oceans", "O'Toole" →
 * "otoole"), so "don" finds Don as an exact title and Don't Look Up only as the start of a longer
 * word, and "dont look up" and "don't look up" are the same query. The word after an apostrophe
 * ("toole" in O'Toole) is searchable by the split key, `catalogSplitKey`. SQL's `unaccent` turns
 * every apostrophe-like character into "'" (’ ‘ ‛ ′ ＇ and the modifier letters ʹ ʻ ʼ ʽ ˈ; ŉ into
 * "'n") before the key drops it, so `APOSTROPHES` lists the same set.
 *
 * SQL strips accents with `unaccent`, which also rewrites letters Unicode decomposition leaves
 * alone (ø → o, æ → ae, ı → i, ł → l…), writes vulgar fractions as " 1/2", and drops superscript
 * digits. Those are mirrored here so both sides key a name alike ("Bølgen", "8½", "Hababam Sınıfı").
 */
export function catalogSearchKey(value: string): string {
  return searchNormalForm(value, "");
}

/**
 * The split key, the same as the SQL `catalog_split_key`: `catalogSearchKey` with apostrophes as
 * spaces ("Don't Look Up" → "don t look up", "Peter O'Toole" → "peter o toole"). Search matches a
 * name by either key, so "toole" finds Peter O'Toole as a later word.
 */
export function catalogSplitKey(value: string): string {
  return searchNormalForm(value, " ");
}

function searchNormalForm(value: string, apostrophe: "" | " "): string {
  return value
    .replace(UNACCENT_LETTERS, (letter) => UNACCENT_MAP[letter]!)
    .replace(FRACTIONS, (fraction) => ` ${fraction}`)
    .replace(SUPERSCRIPTS, "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(APOSTROPHES, apostrophe)
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
/**
 * After NFKD (which turns ＇ into ' and ŉ into ʼn): every character `unaccent` maps to an
 * apostrophe. The modifier letters among them are letters to `\p{L}`, so the split key replaces
 * them explicitly too.
 */
const APOSTROPHES = /['ʹʻʼʽˈ‘’‛′]/g;

/** Shortest normalized query worth sending to the catalog ("e." normalizes to "e", too short). */
export const CATALOG_MIN_QUERY_KEY = 2;

const SEQUEL_WORDS = new Set(["part", "pt", "chapter", "vol", "volume", "episode"]);
const ROMAN: Readonly<Record<string, string>> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
  xi: "11", xii: "12", xiii: "13", xiv: "14", xv: "15", xvi: "16", xvii: "17", xviii: "18", xix: "19", xx: "20",
};
const SPELLED: Readonly<Record<string, string>> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };

/**
 * A search key with sequel numbering as digits, the same as the SQL `catalog_number_key`: "the
 * godfather part ii" → "the godfather 2", "kill bill vol 1" → "kill bill 1", "rocky ii" →
 * "rocky 2". Roman numerals count when they are two letters or more, or follow "part", "vol" and
 * the like (which then drop out); spelled numbers only after those words. Pure.
 */
export function catalogNumberKey(key: string): string {
  const words = key.split(" ");
  if (!words.some((word) => SEQUEL_WORDS.has(word) || /^[ivx]{2,5}$/.test(word))) return key;
  const numbers = words.map((word, i) => {
    const afterSequelWord = i > 0 && SEQUEL_WORDS.has(words[i - 1]!);
    if (/^[0-9]+$/.test(word)) return word;
    const roman = Object.hasOwn(ROMAN, word) ? ROMAN[word]! : null;
    if (roman !== null && (word.length > 1 || afterSequelWord)) return roman;
    const spelled = Object.hasOwn(SPELLED, word) ? SPELLED[word]! : null;
    return spelled !== null && afterSequelWord ? spelled : null;
  });
  return words
    .flatMap((word, i) => (SEQUEL_WORDS.has(word) && numbers[i + 1] != null ? [] : [numbers[i] ?? word]))
    .join(" ");
}
