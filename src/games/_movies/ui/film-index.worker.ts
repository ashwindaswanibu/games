/// <reference lib="webworker" />
import { addFilmIndexPart, emptyFilmIndex, FILM_INDEX_PARTS, searchFilmIndex, type FilmIndexPart } from "../film-index";

/*
 * The film list for search in the browser, off the page's thread: downloading, parsing and keying
 * ~100,000 names takes seconds of CPU on a phone, and a broad query ("the") a few dozen
 * milliseconds. Messages: in `{ id, query, limit }`, out `{ id, hits }` (hits null until the list
 * is ready) or `{ type: "ready" | "failed" }`.
 */
declare const self: DedicatedWorkerGlobalScope;

const index = emptyFilmIndex();
let ready = false;

void (async () => {
  try {
    const parts = await Promise.all(
      Array.from({ length: FILM_INDEX_PARTS }, async (_, part) => {
        const response = await fetch(`/api/catalog/films/index?part=${part}`);
        if (!response.ok) throw new Error(`Film list part ${part}: ${response.status}`);
        return (await response.json()) as FilmIndexPart;
      }),
    );
    for (const part of parts) addFilmIndexPart(index, part);
    ready = true;
    self.postMessage({ type: "ready" });
  } catch {
    self.postMessage({ type: "failed" });
  }
})();

self.onmessage = (event: MessageEvent<{ id: number; query: string; limit: number }>) => {
  const { id, query, limit } = event.data;
  self.postMessage({ id, hits: ready ? searchFilmIndex(index, query, limit) : null });
};
