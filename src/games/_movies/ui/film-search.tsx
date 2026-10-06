"use client";

import { filmSearchResponseSchema, type FilmSearchHit } from "../schemas";
import { CatalogCombobox, type CatalogSearchProps } from "./catalog-combobox";

export interface FilmSearchProps extends CatalogSearchProps<FilmSearchHit> {
  /** Only films this person is credited in (searches `/api/catalog/filmography`). */
  withPerson?: number;
  /** The "nothing matched" line, e.g. for a filmography search. */
  emptyNote?(query: string): string;
}

/**
 * Film autocomplete over `/api/catalog/films`. Hits show year and director so remakes and
 * namesakes can be told apart. Pass guessed film ids as `excludeIds`. With `withPerson`, it searches
 * only that person's filmography.
 *
 *   <FilmSearch label="Name the film" onSelect={(film) => submitMove({ type: "guess", filmId: film.id })} />
 */
export function FilmSearch({ placeholder = "Search films", withPerson, ...props }: FilmSearchProps) {
  return (
    <CatalogCombobox
      {...props}
      placeholder={placeholder}
      endpoint={withPerson === undefined ? "/api/catalog/films" : "/api/catalog/filmography"}
      scope={withPerson === undefined ? undefined : { person: String(withPerson) }}
      responseSchema={filmSearchResponseSchema}
      noun={{ one: "film", many: "films" }}
      describe={(film) => ({
        primary: film.title,
        secondary: [film.year, film.directors.join(" & ")].filter(Boolean).join(" · ") || null,
      })}
    />
  );
}
