import type { Rng } from "@/core/random";
import type { FilmRef } from "@/games/_movies/schemas";
import { OPTION_COUNT } from "./logic";

/**
 * The final pick's look-alikes: films a player could believe are the answer. Chosen once, when the
 * puzzle is made, and stored in the solution (owner decision, 2026-10-06: same kind of film, era
 * and fame). Pure: the pipeline loads the candidates from the catalog and passes an `Rng`.
 *
 * A decoy must be a different film by a different director from a different series, with a known
 * year. It ranks by shared genres, closeness in year and closeness in fame (Wikipedia language
 * editions, compared as a ratio so a classic and a new release are each measured against films of
 * their own standing). The best few are shuffled so the same answer doesn't always draw the same
 * decoys. If the strict bounds leave too few, they widen step by step.
 *
 * The options show their years, so the answer must not stand out by them: all four come from one
 * window of years that holds the answer at a random place, and closeness in year is measured from
 * the window's middle, not from the answer. (Genres and fame aren't shown.) The `Rng` must be
 * seeded with the server's secret (see `scripts/content/movies/lib/decoys.mts`): with a public seed
 * the shuffle could be replayed to find the answer.
 */

export interface DecoyCandidate {
  id: number;
  title: string;
  year: number | null;
  genres: readonly string[];
  directors: readonly string[];
  /** Wikipedia language editions with an article on the film. */
  popularity: number | null;
}

/** How far apart a decoy may be, from strictest to loosest. */
const BOUNDS = [
  { years: 5, fame: 1.6, sharedGenres: 1 },
  { years: 8, fame: 2, sharedGenres: 1 },
  { years: 15, fame: 3, sharedGenres: 1 },
  // Last resort: any other known film, still ranked by likeness.
  { years: Infinity, fame: Infinity, sharedGenres: 0 },
] as const;

/** The pool the decoys are drawn from: this many of the best-ranked, then shuffled. */
const SHORTLIST = 10;

const words = (title: string) =>
  title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const SEQUEL_TAIL = /\s+(?:part|chapter|episode|vol|volume)?\s*(?:\d+|[ivx]+|two|three|four|five)$/;
const ARTICLE = /^(?:the|a|an)\s+/;

/**
 * A film's series, roughly: its title before any subtitle (or "and the …"), without a leading
 * article or a trailing number. "Dune: Part Two" → "dune", "Harry Potter and the Goblet of Fire" →
 * "harry potter", "The Exorcist" / "Exorcist II: The Heretic" → "exorcist".
 */
export function seriesKey(title: string): string {
  const head = title.split(/:|\s[-–—]\s|\s+and\s+the\s+/i)[0] ?? title;
  return words(head).replace(ARTICLE, "").replace(SEQUEL_TAIL, "").trim();
}

const stem = (word: string) => word.replace(/s$/, "");

/**
 * Whether two titles look like one series. The catalog has no franchise data, so this matches
 * generously, which only ever removes a candidate: the same key, one key starting the other ("the
 * matrix" / "the matrix reloaded"), the same first word ("bourne identity" / "bourne supremacy",
 * "alien" / "aliens"), or a key of two or more words inside the other title ("mad max" in "Furiosa:
 * A Mad Max Saga", "spider man" in "The Amazing Spider-Man", "star wars" in "Rogue One: A Star Wars
 * Story"). Sequels that share no words with their series ("The Empire Strikes Back") still slip
 * through, unless they share a director.
 */
export function sameSeries(a: string, b: string): boolean {
  const ka = seriesKey(a);
  const kb = seriesKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || `${kb} `.startsWith(`${ka} `) || `${ka} `.startsWith(`${kb} `)) return true;
  if (stem(ka.split(" ")[0]!) === stem(kb.split(" ")[0]!)) return true;
  const inside = (key: string, title: string) => key.includes(" ") && ` ${words(title)} `.includes(` ${key} `);
  return inside(ka, b) || inside(kb, a);
}

const lower = (items: readonly string[]) => new Set(items.map((s) => s.trim().toLowerCase()).filter(Boolean));

function related(a: DecoyCandidate, b: DecoyCandidate): boolean {
  if (a.id === b.id || words(a.title) === words(b.title) || sameSeries(a.title, b.title)) return true;
  const directors = lower(a.directors);
  return b.directors.some((d) => directors.has(d.trim().toLowerCase()));
}

/** Up to `count` decoys for `answer`, best look-alikes first (before the caller shuffles the options). */
export function pickDecoys(answer: DecoyCandidate, pool: readonly DecoyCandidate[], rng: Rng, count = OPTION_COUNT - 1): DecoyCandidate[] {
  const answerGenres = lower(answer.genres);
  const answerFame = Math.max(1, answer.popularity ?? 1);
  const usable = pool.filter((c) => c.year !== null && c.popularity !== null && !related(answer, c));

  for (const bound of BOUNDS) {
    // The window of years all four options come from, holding the answer at a random place.
    const span = answer.year !== null && Number.isFinite(bound.years) ? bound.years : null;
    const from = span === null ? null : answer.year! - rng.int(0, span);
    const middle = from === null ? null : from + span! / 2;
    const ranked = usable
      .map((c) => {
        const genres = lower(c.genres);
        const shared = [...genres].filter((g) => answerGenres.has(g)).length;
        const union = new Set([...genres, ...answerGenres]).size || 1;
        const inWindow = from === null || (c.year! >= from && c.year! <= from + span!);
        const fromMiddle = middle === null ? 0 : Math.abs(c.year! - middle);
        const fame = Math.max(answerFame, c.popularity!) / Math.max(1, Math.min(answerFame, c.popularity!));
        const fits = shared >= bound.sharedGenres && inWindow && fame <= bound.fame;
        const likeness = 3 * (shared / union) + (1 - Math.min(1, fromMiddle / 15)) + (1 - Math.min(1, Math.log(fame) / Math.log(6)));
        return { c, fits, likeness };
      })
      .filter((r) => r.fits)
      .sort((a, b) => b.likeness - a.likeness || a.c.id - b.c.id);

    const picked: DecoyCandidate[] = [];
    for (const { c } of rng.shuffle(ranked.slice(0, SHORTLIST))) {
      if (picked.length === count) break;
      if (picked.some((p) => related(p, c))) continue;
      picked.push(c);
    }
    // The shortlist can hold too many relatives of one another; fill from the rest in rank order.
    for (const { c } of ranked.slice(SHORTLIST)) {
      if (picked.length === count) break;
      if (picked.some((p) => related(p, c))) continue;
      picked.push(c);
    }
    if (picked.length === count) return picked;
  }
  throw new Error(`Couldn't find ${count} look-alike films for ${answer.title}`);
}

/** The final pick as stored: the answer and its decoys, in a shuffled order. */
export function pickOptions(answer: DecoyCandidate, pool: readonly DecoyCandidate[], rng: Rng): FilmRef[] {
  const films = [answer, ...pickDecoys(answer, pool, rng)];
  return rng.shuffle(films).map(({ id, title, year }) => ({ id, title, year }));
}
