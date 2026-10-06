import type { Clue, ClueKind, DecadeClue, DirectorClue, FilmFacts, GenresClue, YearClue, YearDirection } from "./schemas";

/**
 * Clue computation for Movies games. Pure and deterministic: call these from a game's
 * `applyMove` with the guessed film's facts (from the resolved move) and the answer's facts (from
 * the solution).
 */

/** Where the answer's year lies relative to the guess: "later" means guess higher. */
export function compareYear(guessYear: number | null, answerYear: number | null): YearDirection {
  if (guessYear === null || answerYear === null) return "unknown";
  if (answerYear === guessYear) return "same";
  return answerYear > guessYear ? "later" : "earlier";
}

/** First year of the decade, e.g. 1994 → 1990. */
export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

export function sameDecade(guessYear: number | null, answerYear: number | null): DecadeClue["match"] {
  if (guessYear === null || answerYear === null) return "unknown";
  return decadeOf(guessYear) === decadeOf(answerYear) ? "same" : "different";
}

/** Case-, accent- and whitespace-insensitive key for comparing genre and person names. */
export function nameKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function shared(guess: readonly string[], answer: readonly string[]): string[] {
  const answerKeys = new Set(answer.map(nameKey));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of guess) {
    const key = nameKey(item);
    if (key && answerKeys.has(key) && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/** Genres of the guess that the answer also has, in the guess's order and spelling. */
export function sharedGenres(guess: Pick<FilmFacts, "genres">, answer: Pick<FilmFacts, "genres">): string[] {
  return shared(guess.genres, answer.genres);
}

/** Directors of the guess who also directed the answer, in the guess's order and spelling. */
export function sharedDirectors(guess: Pick<FilmFacts, "directors">, answer: Pick<FilmFacts, "directors">): string[] {
  return shared(guess.directors, answer.directors);
}

/** Whether the films share a director; "unknown" when either has no director on record. */
export function sameDirector(guess: Pick<FilmFacts, "directors">, answer: Pick<FilmFacts, "directors">): DirectorClue["match"] {
  if (guess.directors.length === 0 || answer.directors.length === 0) return "unknown";
  return sharedDirectors(guess, answer).length > 0 ? "same" : "different";
}

export function yearClue(guess: FilmFacts, answer: FilmFacts): YearClue {
  return { kind: "year", guessYear: guess.year, direction: compareYear(guess.year, answer.year) };
}

export function decadeClue(guess: FilmFacts, answer: FilmFacts): DecadeClue {
  return {
    kind: "decade",
    guessDecade: guess.year === null ? null : decadeOf(guess.year),
    match: sameDecade(guess.year, answer.year),
  };
}

export function genresClue(guess: FilmFacts, answer: FilmFacts): GenresClue {
  if (guess.genres.length === 0 || answer.genres.length === 0) return { kind: "genres", shared: [], match: "unknown" };
  const common = sharedGenres(guess, answer);
  return { kind: "genres", shared: common, match: common.length > 0 ? "some" : "none" };
}

export function directorClue(guess: FilmFacts, answer: FilmFacts): DirectorClue {
  const match = sameDirector(guess, answer);
  return { kind: "director", shared: match === "same" ? sharedDirectors(guess, answer) : [], match };
}

const BUILDERS: Record<ClueKind, (guess: FilmFacts, answer: FilmFacts) => Clue> = {
  year: yearClue,
  decade: decadeClue,
  genres: genresClue,
  director: directorClue,
};

/** The clues of the requested kinds, in the order requested (duplicates ignored). */
export function computeClues(guess: FilmFacts, answer: FilmFacts, kinds: readonly ClueKind[]): Clue[] {
  return [...new Set(kinds)].map((kind) => BUILDERS[kind](guess, answer));
}
