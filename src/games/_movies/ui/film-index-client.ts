"use client";

import type { FilmSearchHit } from "../schemas";

/*
 * The page's side of film search in the browser (`film-index.worker.ts`). One worker per page,
 * started by the first film search box; until its list is ready (or if it fails) searches return
 * null and the caller asks the server, as before.
 */

let worker: Worker | null = null;
let failed = false;
let nextId = 0;
const waiting = new Map<number, (hits: FilmSearchHit[] | null) => void>();

/** Starts downloading the film list in the background (once per page). */
export function startFilmIndex(): void {
  if (worker || failed || typeof Worker === "undefined") return;
  try {
    worker = new Worker(new URL("./film-index.worker.ts", import.meta.url), { type: "module" });
  } catch {
    failed = true;
    return;
  }
  worker.onmessage = (event: MessageEvent<{ id?: number; hits?: FilmSearchHit[] | null; type?: string }>) => {
    const { id, hits, type } = event.data;
    if (type === "failed") failed = true;
    if (id === undefined) return;
    waiting.get(id)?.(hits ?? null);
    waiting.delete(id);
  };
  worker.onerror = () => {
    failed = true;
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
  };
}

/** The best `limit` films for `query` from the list in the browser, or null if it isn't ready. */
export function searchFilmsLocally(query: string, limit: number): Promise<FilmSearchHit[] | null> {
  if (!worker || failed) return Promise.resolve(null);
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker!.postMessage({ id, query, limit });
  });
}
