import { z } from "zod";
import { CATALOG_MIN_QUERY_KEY, catalogSearchKey } from "./search-key";

/**
 * Shared shapes for Movies games. Pure zod, safe on both sides of the wire.
 *
 * Naming: a *Ref* is what a player may see about a film or person (enough to display it), *Facts*
 * are the comparable attributes clues are computed from, and *Details* is both together. A game's
 * solution typically stores the answer as `FilmDetails` (a snapshot, so later catalog edits can't
 * change a published puzzle); its state stores the player's guesses and the clues they earned.
 */

// ---------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------

/** Catalog primary keys (`movie_films.id`, `movie_people.id`). */
export const filmIdSchema = z.number().int().positive().max(2_147_483_647);
export const personIdSchema = z.number().int().positive().max(2_147_483_647);

const yearSchema = z.number().int().min(1870).max(2100);
const titleSchema = z.string().min(1).max(300);
const nameSchema = z.string().min(1).max(200);

export const filmRefSchema = z.object({
  id: filmIdSchema,
  title: titleSchema,
  year: yearSchema.nullable(),
});
export type FilmRef = z.infer<typeof filmRefSchema>;

export const personRefSchema = z.object({
  id: personIdSchema,
  name: nameSchema,
});
export type PersonRef = z.infer<typeof personRefSchema>;

export const filmFactsSchema = z.object({
  year: yearSchema.nullable(),
  /** Display names, most specific first. */
  genres: z.array(z.string().min(1).max(60)).max(20),
  /** Display names, credited order. */
  directors: z.array(nameSchema).max(10),
});
export type FilmFacts = z.infer<typeof filmFactsSchema>;

export const filmDetailsSchema = filmRefSchema.extend(filmFactsSchema.shape);
export type FilmDetails = z.infer<typeof filmDetailsSchema>;

// ---------------------------------------------------------------------------------------------
// Autocomplete (GET /api/catalog/films and /api/catalog/people)
// ---------------------------------------------------------------------------------------------

/**
 * Search queries: trimmed, 2–80 characters, and at least 2 characters once normalized. Short keys
 * match most of the catalog, so "e." (key "e") is refused rather than scanned.
 */
export const catalogQuerySchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .refine((q) => catalogSearchKey(q).length >= CATALOG_MIN_QUERY_KEY);
export const CATALOG_DEFAULT_LIMIT = 8;
export const CATALOG_MAX_LIMIT = 20;
export const catalogLimitSchema = z.coerce.number().int().min(1).max(CATALOG_MAX_LIMIT).default(CATALOG_DEFAULT_LIMIT);
export const catalogSearchParamsSchema = z.object({ q: catalogQuerySchema, limit: catalogLimitSchema });
export type CatalogSearchParams = z.infer<typeof catalogSearchParamsSchema>;
export const CATALOG_PARAMS_ERROR = `Search for 2–80 characters (at least 2 letters or digits), with a limit of 1–${CATALOG_MAX_LIMIT}.`;

/** A catalog route's query string → validated params, or null (respond 400 with CATALOG_PARAMS_ERROR). */
export function parseCatalogSearchParams(search: URLSearchParams): CatalogSearchParams | null {
  // Repeated keys (`?q=a&q=b`) are ambiguous; refuse them rather than silently picking one.
  if (search.getAll("q").length > 1 || search.getAll("limit").length > 1) return null;
  const parsed = catalogSearchParamsSchema.safeParse({ q: search.get("q") ?? undefined, limit: search.get("limit") || undefined });
  return parsed.success ? parsed.data : null;
}

export const filmSearchHitSchema = filmRefSchema.extend({
  /** Up to two director names, to tell remakes and namesakes apart. */
  directors: z.array(nameSchema).max(2),
  /**
   * The name the query matched when it isn't the film's title (another title the film is known
   * by: "K3G" or "Kabhi Khushi Kabhie Gham..." for Kabhi Khushi Kabhie Gham), else null.
   */
  aka: titleSchema.nullable().default(null),
});
export type FilmSearchHit = z.infer<typeof filmSearchHitSchema>;

export const personSearchHitSchema = personRefSchema.extend({
  /** Title of their best-known film, to tell namesakes apart. */
  knownFor: titleSchema.nullable(),
});
export type PersonSearchHit = z.infer<typeof personSearchHitSchema>;

export const filmSearchResponseSchema = z.object({ results: z.array(filmSearchHitSchema) });
export const personSearchResponseSchema = z.object({ results: z.array(personSearchHitSchema) });
export type FilmSearchResponse = z.infer<typeof filmSearchResponseSchema>;
export type PersonSearchResponse = z.infer<typeof personSearchResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Clues: what a wrong guess tells you about the answer. Computed by `computeClues` in ./hints.
// ---------------------------------------------------------------------------------------------

export const CLUE_KINDS = ["year", "decade", "genres", "director"] as const;
export type ClueKind = (typeof CLUE_KINDS)[number];

/** Where the answer's release year lies relative to the guess's. */
export const yearDirectionSchema = z.enum(["earlier", "later", "same", "unknown"]);
export type YearDirection = z.infer<typeof yearDirectionSchema>;

export const yearClueSchema = z.object({
  kind: z.literal("year"),
  guessYear: yearSchema.nullable(),
  direction: yearDirectionSchema,
});

export const decadeClueSchema = z.object({
  kind: z.literal("decade"),
  /** e.g. 1990 for the 1990s. */
  guessDecade: yearSchema.nullable(),
  match: z.enum(["same", "different", "unknown"]),
});

export const genresClueSchema = z.object({
  kind: z.literal("genres"),
  /** Genres the guess shares with the answer, in the guess's order (empty when none). */
  shared: z.array(z.string().min(1).max(60)).max(20),
  match: z.enum(["some", "none", "unknown"]),
});

export const directorClueSchema = z.object({
  kind: z.literal("director"),
  /** Directors the guess shares with the answer (empty when none). */
  shared: z.array(nameSchema).max(10),
  match: z.enum(["same", "different", "unknown"]),
});

export const clueSchema = z.discriminatedUnion("kind", [yearClueSchema, decadeClueSchema, genresClueSchema, directorClueSchema]);
export type Clue = z.infer<typeof clueSchema>;
export type YearClue = z.infer<typeof yearClueSchema>;
export type DecadeClue = z.infer<typeof decadeClueSchema>;
export type GenresClue = z.infer<typeof genresClueSchema>;
export type DirectorClue = z.infer<typeof directorClueSchema>;

/** One guess as most Movies games record it in their state. */
export const filmGuessSchema = z.object({
  film: filmRefSchema,
  correct: z.boolean(),
  /** Empty for a correct guess. */
  clues: z.array(clueSchema).max(CLUE_KINDS.length),
});
export type FilmGuess = z.infer<typeof filmGuessSchema>;
