import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MovieCreditRow, MovieFilmRow, MoviePersonRow } from "./database.types";
import { db } from "./supabase/admin";

/**
 * Read-only facts a game's `resolveMove` may consult (see `src/server/game-server.ts`). Handed to
 * resolvers as an interface so they can be unit-tested with an in-memory fake.
 *
 * Today that is the movie catalog. Lookups never throw for unknown ids: missing ids are simply
 * absent from the returned map, or the call returns null / an empty list.
 */
export interface GameServices {
  readonly films: {
    get(ids: readonly number[]): Promise<Map<number, FilmRecord>>;
  };
  readonly people: {
    get(ids: readonly number[]): Promise<Map<number, PersonRecord>>;
  };
  readonly credits: {
    /** Every film the person has a cast credit in. */
    filmsOf(personId: number): Promise<CreditRecord[]>;
    /** The film's cast, top billed first (unknown billing last). */
    castOf(filmId: number): Promise<CreditRecord[]>;
    /** The person's credit in the film, or null if they weren't in it. */
    together(personId: number, filmId: number): Promise<CreditRecord | null>;
  };
}

export interface FilmRecord {
  id: number;
  title: string;
  year: number | null;
  genres: string[];
  directors: string[];
  popularity: number;
  tmdbId: number | null;
  imdbId: string | null;
  wikidataId: string | null;
}

export interface PersonRecord {
  id: number;
  name: string;
  popularity: number;
  wikidataId: string | null;
}

export interface CreditRecord {
  filmId: number;
  personId: number;
  /** Cast-list position, 0 = top billed; null when unknown. */
  billing: number | null;
}

/** Ids per `in (...)` query; keeps request URLs well under PostgREST's limits. */
const CHUNK = 200;
const MAX_IDS = 5000;

function cleanIds(ids: readonly number[]): number[] {
  const unique = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (unique.length > MAX_IDS) throw new Error(`Too many ids in one lookup (${unique.length} > ${MAX_IDS})`);
  return unique;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const FILM_COLUMNS = "id, title, year, genres, directors, popularity, tmdb_id, imdb_id, wikidata_id";
const PERSON_COLUMNS = "id, name, popularity, wikidata_id";

type FilmColumns = Omit<MovieFilmRow, "search_key">;
type PersonColumns = Omit<MoviePersonRow, "search_key">;

export function toFilmRecord(row: FilmColumns): FilmRecord {
  return {
    id: row.id,
    title: row.title,
    year: row.year,
    genres: row.genres,
    directors: row.directors,
    popularity: row.popularity,
    tmdbId: row.tmdb_id,
    imdbId: row.imdb_id,
    wikidataId: row.wikidata_id,
  };
}

function toPersonRecord(row: PersonColumns): PersonRecord {
  return { id: row.id, name: row.name, popularity: row.popularity, wikidataId: row.wikidata_id };
}

function toCreditRecord(row: MovieCreditRow): CreditRecord {
  return { filmId: row.film_id, personId: row.person_id, billing: row.billing };
}

const byBilling = (a: CreditRecord, b: CreditRecord) =>
  (a.billing ?? Number.MAX_SAFE_INTEGER) - (b.billing ?? Number.MAX_SAFE_INTEGER) || a.personId - b.personId;

/** Catalog-backed services over a service-role client. Callers must have authorized the request. */
export function createGameServices(client: SupabaseClient<Database>): GameServices {
  return {
    films: {
      async get(ids) {
        const result = new Map<number, FilmRecord>();
        for (const part of chunks(cleanIds(ids), CHUNK)) {
          const { data, error } = await client.from("movie_films").select(FILM_COLUMNS).in("id", part);
          if (error) throw new Error(`Failed to load films: ${error.message}`);
          for (const row of data) result.set(row.id, toFilmRecord(row));
        }
        return result;
      },
    },
    people: {
      async get(ids) {
        const result = new Map<number, PersonRecord>();
        for (const part of chunks(cleanIds(ids), CHUNK)) {
          const { data, error } = await client.from("movie_people").select(PERSON_COLUMNS).in("id", part);
          if (error) throw new Error(`Failed to load people: ${error.message}`);
          for (const row of data) result.set(row.id, toPersonRecord(row));
        }
        return result;
      },
    },
    credits: {
      async filmsOf(personId) {
        if (!Number.isSafeInteger(personId) || personId <= 0) return [];
        const { data, error } = await client.from("movie_credits").select("film_id, person_id, billing").eq("person_id", personId);
        if (error) throw new Error(`Failed to load credits: ${error.message}`);
        return data.map(toCreditRecord).sort((a, b) => a.filmId - b.filmId);
      },
      async castOf(filmId) {
        if (!Number.isSafeInteger(filmId) || filmId <= 0) return [];
        const { data, error } = await client.from("movie_credits").select("film_id, person_id, billing").eq("film_id", filmId);
        if (error) throw new Error(`Failed to load cast: ${error.message}`);
        return data.map(toCreditRecord).sort(byBilling);
      },
      async together(personId, filmId) {
        if (!Number.isSafeInteger(personId) || personId <= 0 || !Number.isSafeInteger(filmId) || filmId <= 0) return null;
        const { data, error } = await client
          .from("movie_credits")
          .select("film_id, person_id, billing")
          .eq("person_id", personId)
          .eq("film_id", filmId)
          .maybeSingle();
        if (error) throw new Error(`Failed to load credit: ${error.message}`);
        return data ? toCreditRecord(data) : null;
      },
    },
  };
}

let services: GameServices | undefined;

export function gameServices(): GameServices {
  services ??= createGameServices(db());
  return services;
}
