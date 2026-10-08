"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { z } from "zod";
import { CATALOG_MIN_QUERY_KEY, catalogSearchKey } from "../search-key";
import { searchFilmsLocally, startFilmIndex } from "./film-index-client";

export type CatalogEndpoint = "/api/catalog/films" | "/api/catalog/people" | "/api/catalog/filmography" | "/api/catalog/cast";

export interface CatalogSearchConfig<Hit extends { id: number }> {
  endpoint: CatalogEndpoint;
  /** Extra query parameters that narrow the search (e.g. `{ person: "12" }` for a filmography). */
  scope?: Readonly<Record<string, string>>;
  responseSchema: z.ZodType<{ results: Hit[] }>;
  /** Called with the chosen hit. The query clears itself afterwards unless `clearOnSelect` is false. */
  onSelect(hit: Hit): void;
  /** Ids shown but not selectable (e.g. already guessed). */
  excludeIds?: readonly number[];
  clearOnSelect?: boolean;
  disabled?: boolean;
  /** The "nothing matched" line; defaults to `No <many> match`. */
  emptyNote?(query: string): string;
  noun: { one: string; many: string };
}

/** Only queries the server accepts (see `catalogQuerySchema`): "e." is too short once normalized. */
const searchable = (value: string) => catalogSearchKey(value).length >= CATALOG_MIN_QUERY_KEY;
const DEBOUNCE_MS = 160;
const LIMIT = 8;
const CACHE_SIZE = 60;
/** Typo-tolerant matches (the server's) start at 4 characters, as in SQL `search_films`. */
const TYPO_MIN_KEY = 4;

export type CatalogSearchStatus = "idle" | "loading" | "ready" | "error";

/**
 * The behaviour of an ARIA 1.2 combobox over a catalog search route, without any look: debounced,
 * cancels stale requests, caches recent queries, and supports ↑/↓ to move, Enter to choose, Escape
 * to close (then to clear), Tab to leave. `CatalogCombobox` is the kit's rendering of it; a game
 * with its own look renders it itself.
 *
 * Film search (`/api/catalog/films`, unscoped) runs in the browser once the film list has arrived
 * (`film-index-client.ts`): every keystroke answers at once, and the server is asked only for typo
 * matches when the list comes up short, which go after the real ones, as on the server.
 */
export function useCatalogSearch<Hit extends { id: number }>(config: CatalogSearchConfig<Hit>) {
  const { endpoint, scope, responseSchema, onSelect, excludeIds = [], clearOnSelect = true, disabled = false, emptyNote, noun } = config;
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [status, setStatus] = useState<CatalogSearchStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  /** The dropdown that opens and closes: the list of hits and, under it, IMDb's credit. */
  const popupRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Hit[]>());
  /** Counts searches, so a local answer to an older one is dropped. */
  const latest = useRef(0);
  const local = endpoint === "/api/catalog/films" && !scope;

  useEffect(() => {
    if (local) startFilmIndex();
    return () => {
      clearTimeout(timer.current);
      inflight.current?.abort();
    };
  }, [local]);

  const scopeKey = scope ? new URLSearchParams(scope).toString() : "";
  const excluded = new Set(excludeIds);
  const selectable = (index: number) => index >= 0 && index < results.length && !excluded.has(results[index].id);

  function show(hits: Hit[]) {
    setResults(hits);
    setStatus("ready");
    setError(null);
    setActive(hits.findIndex((h) => !excluded.has(h.id)));
  }

  /** The server's hits for `q`; with `first`, the local hits, which stay first (the server adds its typo matches). */
  async function fetchHits(q: string, key: string, first?: Hit[]) {
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const url = `${endpoint}?${new URLSearchParams({ ...scope, q, limit: String(LIMIT) })}`;
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (response.status === 401) throw new Error("You're signed out. Refresh the page to sign in again.");
      if (response.status === 429) throw new Error("That's a lot of searching. Wait a few seconds, then try again.");
      if (!response.ok) throw new Error("Search isn't available right now. Try again in a moment.");
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Search returned something unexpected. Try again.");
      if (controller.signal.aborted) return;
      const ids = new Set(first?.map((hit) => hit.id));
      const hits = first ? [...first, ...parsed.data.results.filter((hit) => !ids.has(hit.id))].slice(0, LIMIT) : parsed.data.results;
      remember(key, hits);
      show(hits);
    } catch (err) {
      if (controller.signal.aborted) return;
      // The local hits are still right; only the extra typo matches are missing.
      if (first) return;
      setResults([]);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Search failed.");
    }
  }

  function remember(key: string, hits: Hit[]) {
    cache.current.set(key, hits);
    if (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value!);
  }

  function search(value: string) {
    const ticket = ++latest.current;
    clearTimeout(timer.current);
    inflight.current?.abort();
    const q = value.trim();
    // Scoped searches cache per scope, so switching actor or film never shows another list.
    const key = `${scopeKey}|${q.toLowerCase().replace(/\s+/g, " ")}`;
    if (!searchable(q)) {
      setResults([]);
      setStatus("idle");
      setOpen(false);
      return;
    }
    setOpen(true);
    const cached = cache.current.get(key);
    if (cached) {
      show(cached);
      return;
    }
    if (local) {
      void searchFilmsLocally(q, LIMIT).then((found) => {
        if (ticket !== latest.current) return;
        const parsed = found === null ? null : responseSchema.safeParse({ results: found });
        if (!parsed?.success) {
          setStatus("loading");
          timer.current = setTimeout(() => void fetchHits(q, key), DEBOUNCE_MS);
          return;
        }
        const hits = parsed.data.results;
        show(hits);
        if (hits.length < LIMIT && catalogSearchKey(q).length >= TYPO_MIN_KEY) timer.current = setTimeout(() => void fetchHits(q, key, hits), DEBOUNCE_MS);
        else remember(key, hits);
      });
      return;
    }
    setStatus("loading");
    timer.current = setTimeout(() => void fetchHits(q, key), DEBOUNCE_MS);
  }

  /** The player typed: update the text and search for it. */
  function change(value: string) {
    setQuery(value);
    search(value);
  }

  /** Empties the field and the list. */
  function clear() {
    setQuery("");
    search("");
  }

  /**
   * Shows `value` in the field without searching for it, e.g. the title of the hit just chosen
   * when `clearOnSelect` is false.
   */
  function fill(value: string) {
    latest.current++;
    clearTimeout(timer.current);
    inflight.current?.abort();
    setQuery(value);
    setResults([]);
    setStatus("idle");
    setOpen(false);
  }

  function choose(index: number) {
    if (!selectable(index)) return;
    onSelect(results[index]);
    setOpen(false);
    if (clearOnSelect) {
      setQuery("");
      setResults([]);
      setStatus("idle");
    }
    inputRef.current?.focus();
  }

  /** Moves the active option, skipping excluded ones and wrapping around. */
  function step(delta: 1 | -1) {
    const n = results.length;
    let index = active;
    for (let tries = 0; tries < n; tries++) {
      index = index < 0 ? (delta === 1 ? 0 : n - 1) : (index + delta + n) % n;
      if (selectable(index)) {
        setActive(index);
        document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
        return;
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!open && searchable(query)) {
          setOpen(true);
          return;
        }
        step(event.key === "ArrowDown" ? 1 : -1);
        return;
      case "Enter":
        // Never submit a surrounding form from the search box.
        event.preventDefault();
        if (open) choose(active);
        return;
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
        } else if (query) {
          event.preventDefault();
          clear();
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  }

  const expanded = open && !disabled && status !== "idle";

  // A search low on the screen opens its list below the fold or under the app's chrome, where
  // the hits can't be seen or tapped. Bring the whole dropdown (hits and credit) into view whenever
  // it opens or grows; "nearest" never scrolls one that is already fully visible.
  useEffect(() => {
    if (expanded) popupRef.current?.scrollIntoView({ block: "nearest" });
  }, [expanded, status, results.length]);

  const activeId = expanded && selectable(active) ? optionId(active) : undefined;
  const announcement =
    status === "loading"
      ? "Searching"
      : status === "error"
        ? (error ?? "")
        : status === "ready"
          ? results.length === 0
            ? emptyNote
              ? emptyNote(query.trim())
              : `No ${noun.many} match`
            : `${results.length} ${results.length === 1 ? noun.one : noun.many}, use up and down to choose`
          : "";

  /** Spread onto the `<input>`: the combobox role, its ARIA wiring and its handlers. */
  const inputProps = {
    ref: inputRef,
    id: inputId,
    type: "text",
    inputMode: "search",
    enterKeyHint: "search",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": expanded,
    "aria-controls": listId,
    "aria-activedescendant": activeId,
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "none",
    spellCheck: false,
    maxLength: 80,
    disabled,
    value: query,
    onChange: (event: { target: { value: string } }) => change(event.target.value),
    onKeyDown,
    onFocus: () => {
      if (searchable(query)) setOpen(true);
    },
    onBlur: () => setOpen(false),
  } as const;

  return {
    inputId,
    listId,
    optionId,
    inputRef,
    popupRef,
    inputProps,
    query,
    results,
    status,
    error,
    open: expanded,
    active,
    setActive,
    excluded,
    selectable,
    announcement,
    change,
    clear,
    fill,
    choose,
  };
}
