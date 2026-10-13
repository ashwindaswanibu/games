"use client";

import { addFilmIndexPart, emptyFilmIndex, searchFilmIndex, type FilmIndex } from "../film-index";
import { castListSchema, filmographyListSchema, type CastList, type FilmSearchHit, type PersonSearchHit } from "../schemas";
import { rankByQuery } from "../scoped-search";

/*
 * Whole filmographies and casts in the browser, for searches scoped to one person or one film
 * (Degrees' link line): each list comes down once (the browser keeps it a day) and every keystroke
 * ranks it at once, the way film search does with the film list (`film-index-client.ts`). A
 * filmography ranks as `search_films` ranks it (`searchFilmIndex`), so the server is asked only
 * for its typo matches; a cast ranks as the server ranks it (`rankByQuery`), so never. A game loads
 * the next list ahead (`prefetchScopedList`) as soon as it knows it: a film's cast as the film is
 * chosen, a co-star's filmography as they're linked. Until a list is here a search waits for it;
 * one that can't be loaded leaves its searches to the server, as before.
 */

export type ScopedListEndpoint = "/api/catalog/filmography" | "/api/catalog/cast";

type Entry<T> = { state: "loading"; ready: Promise<void> } | { state: "ready"; list: T } | { state: "failed" };

const filmographies = new Map<number, Entry<FilmIndex>>();
const casts = new Map<number, Entry<CastList["people"]>>();

function load<T>(entries: Map<number, Entry<T>>, id: number, url: string, read: (body: unknown) => T | null): Entry<T> {
  const held = entries.get(id);
  if (held) return held;
  const ready = fetch(url, { headers: { Accept: "application/json" } })
    .then(async (response) => (response.ok ? read(await response.json()) : null))
    .catch(() => null)
    .then((list) => {
      entries.set(id, list === null ? { state: "failed" } : { state: "ready", list });
    });
  const entry: Entry<T> = { state: "loading", ready };
  entries.set(id, entry);
  return entry;
}

function filmography(personId: number): Entry<FilmIndex> {
  return load(filmographies, personId, `/api/catalog/filmography?person=${personId}`, (body) => {
    const parsed = filmographyListSchema.safeParse(body);
    if (!parsed.success) return null;
    const index = emptyFilmIndex();
    addFilmIndexPart(index, parsed.data.films);
    return index;
  });
}

function cast(filmId: number): Entry<CastList["people"]> {
  return load(casts, filmId, `/api/catalog/cast?film=${filmId}`, (body) => {
    const parsed = castListSchema.safeParse(body);
    return parsed.success ? parsed.data.people : null;
  });
}

/** The id a scoped search is scoped to (`{ person }` for a filmography, `{ film }` for a cast), or null. */
function scopeId(endpoint: ScopedListEndpoint, scope: Readonly<Record<string, string>>): number | null {
  const id = Number(endpoint === "/api/catalog/filmography" ? scope.person : scope.film);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Whether a search on `endpoint` ranks a whole list in the browser. */
export function isScopedList(endpoint: string): endpoint is ScopedListEndpoint {
  return endpoint === "/api/catalog/filmography" || endpoint === "/api/catalog/cast";
}

/** Whether the server has matches a whole list doesn't: a filmography's typo matches. */
export function serverAddsTypos(endpoint: ScopedListEndpoint): boolean {
  return endpoint === "/api/catalog/filmography";
}

/** Starts downloading a scoped search's list, if it isn't here or on its way already. */
export function prefetchScopedList(endpoint: ScopedListEndpoint, scope: Readonly<Record<string, string>>): void {
  const id = scopeId(endpoint, scope);
  if (id === null) return;
  if (endpoint === "/api/catalog/filmography") filmography(id);
  else cast(id);
}

function answer<T, Hit>(entry: Entry<T>, rank: (list: T) => Hit[]): Hit[] | Promise<void> | null {
  return entry.state === "ready" ? rank(entry.list) : entry.state === "loading" ? entry.ready : null;
}

/**
 * The best `limit` hits for `query` from a scoped search's whole list: the hits once the list is
 * here (unchecked, like any response), a promise that settles when it has arrived (or failed), or
 * null if it couldn't be loaded (ask the server).
 */
export function searchScopedList(endpoint: ScopedListEndpoint, scope: Readonly<Record<string, string>>, query: string, limit: number): FilmSearchHit[] | PersonSearchHit[] | Promise<void> | null {
  const id = scopeId(endpoint, scope);
  if (id === null) return null;
  if (endpoint === "/api/catalog/filmography") return answer(filmography(id), (index) => searchFilmIndex(index, query, limit));
  return answer(cast(id), (people) =>
    rankByQuery(people, query, { text: (person) => person.name, popularity: (person) => person.popularity, limit }).map(
      (person): PersonSearchHit => ({ id: person.id, name: person.name, knownFor: null, portrait: person.portrait }),
    ),
  );
}
