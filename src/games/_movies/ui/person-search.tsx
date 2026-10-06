"use client";

import { personSearchResponseSchema, type PersonSearchHit } from "../schemas";
import { CatalogCombobox, type CatalogSearchProps } from "./catalog-combobox";

export interface PersonSearchProps extends CatalogSearchProps<PersonSearchHit> {
  /** Only people credited in this film (searches `/api/catalog/cast`). */
  inFilm?: number;
  /** The "nothing matched" line, e.g. for a cast search. */
  emptyNote?(query: string): string;
}

/**
 * Person autocomplete over `/api/catalog/people`. Hits show the person's best-known film so
 * namesakes can be told apart. With `inFilm`, it searches only that film's cast.
 *
 *   <PersonSearch label="Next actor" onSelect={(person) => setCoStar(person)} />
 */
export function PersonSearch({ placeholder = "Search actors", excludedNote = "Already used", inFilm, ...props }: PersonSearchProps) {
  return (
    <CatalogCombobox
      {...props}
      placeholder={placeholder}
      excludedNote={excludedNote}
      endpoint={inFilm === undefined ? "/api/catalog/people" : "/api/catalog/cast"}
      scope={inFilm === undefined ? undefined : { film: String(inFilm) }}
      responseSchema={personSearchResponseSchema}
      noun={{ one: "person", many: "people" }}
      describe={(person) => ({ primary: person.name, secondary: person.knownFor ? `Known for ${person.knownFor}` : null })}
    />
  );
}
