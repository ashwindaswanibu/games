"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { z } from "zod";
import { MOVIES_FONT_VARS } from "./fonts";
import styles from "./movies.module.css";
import { useMoviesVariant, type MoviesVariant } from "./variant";

/** Props shared by `FilmSearch` and `PersonSearch`. */
export interface CatalogSearchProps<Hit> {
  /** Called with the chosen hit. The field clears itself afterwards unless `clearOnSelect` is false. */
  onSelect(hit: Hit): void;
  /** Visible label above the field. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** Ids shown but not selectable (e.g. already guessed), with `excludedNote` as the reason. */
  excludeIds?: readonly number[];
  excludedNote?: string;
  /** Open the list above the field, for searches placed low on the screen near the keyboard. */
  placement?: "below" | "above";
  clearOnSelect?: boolean;
  autoFocus?: boolean;
  variant?: MoviesVariant;
}

interface ComboboxConfig<Hit extends { id: number }> extends CatalogSearchProps<Hit> {
  endpoint: "/api/catalog/films" | "/api/catalog/people" | "/api/catalog/filmography" | "/api/catalog/cast";
  /** Extra query parameters that narrow the search (e.g. `{ person: "12" }` for a filmography). */
  scope?: Readonly<Record<string, string>>;
  /** The "nothing matched" line; defaults to `No <many> match "<query>".` */
  emptyNote?(query: string): string;
  responseSchema: z.ZodType<{ results: Hit[] }>;
  describe(hit: Hit): { primary: string; secondary: string | null };
  /** Spoken after the hit's text, e.g. "already guessed". */
  noun: { one: string; many: string };
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 160;
const LIMIT = 8;
const CACHE_SIZE = 60;

type Status = "idle" | "loading" | "ready" | "error";

/**
 * ARIA 1.2 combobox over a catalog search route: debounced, cancels stale requests, caches recent
 * queries, and supports ↑/↓ to move, Enter to choose, Escape to close (then to clear), Tab to leave.
 */
export function CatalogCombobox<Hit extends { id: number }>(config: ComboboxConfig<Hit>) {
  const {
    endpoint,
    scope,
    emptyNote,
    responseSchema,
    describe,
    noun,
    onSelect,
    label,
    placeholder,
    disabled = false,
    excludeIds = [],
    excludedNote = "Already guessed",
    placement = "below",
    clearOnSelect = true,
    autoFocus = false,
  } = config;
  const variant = useMoviesVariant(config.variant);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Hit[]>());

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      inflight.current?.abort();
    },
    [],
  );

  const scopeKey = scope ? new URLSearchParams(scope).toString() : "";
  const excluded = new Set(excludeIds);
  const selectable = (index: number) => index >= 0 && index < results.length && !excluded.has(results[index].id);

  function show(hits: Hit[]) {
    setResults(hits);
    setStatus("ready");
    setError(null);
    setActive(hits.findIndex((h) => !excluded.has(h.id)));
  }

  async function fetchHits(q: string, key: string) {
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
      cache.current.set(key, parsed.data.results);
      if (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value!);
      show(parsed.data.results);
    } catch (err) {
      if (controller.signal.aborted) return;
      setResults([]);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Search failed.");
    }
  }

  function search(value: string) {
    clearTimeout(timer.current);
    inflight.current?.abort();
    const q = value.trim();
    // Scoped searches cache per scope, so switching actor or film never shows another list.
    const key = `${scopeKey}|${q.toLowerCase().replace(/\s+/g, " ")}`;
    if (q.length < MIN_CHARS) {
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
    setStatus("loading");
    timer.current = setTimeout(() => void fetchHits(q, key), DEBOUNCE_MS);
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
        if (!open && query.trim().length >= MIN_CHARS) {
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
          setQuery("");
          search("");
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  }

  const expanded = open && !disabled && status !== "idle";

  // A search low on the screen opens its list below the fold or under the app's bottom nav, where
  // the hits can't be seen or tapped. Bring the whole list into view whenever it opens or grows
  // (the page's scroll-padding keeps it clear of the app chrome); "nearest" never scrolls a list
  // that is already fully visible.
  useEffect(() => {
    if (expanded) listRef.current?.scrollIntoView({ block: "nearest" });
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

  return (
    <div data-variant={variant} className={`${MOVIES_FONT_VARS} ${styles.root} ${styles.search}`}>
      <label htmlFor={inputId} className={styles.searchLabel}>
        {label}
      </label>
      <div className={styles.searchField} data-disabled={disabled}>
        <svg className={styles.searchIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <circle cx="8.5" cy="8.5" r="6" />
          <path d="M13 13l5 5" strokeLinecap="square" />
        </svg>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.searchInput}
          type="text"
          inputMode="search"
          enterKeyHint="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={80}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            search(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (query.trim().length >= MIN_CHARS) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
        />
        {status === "loading" && <span className={styles.spinner} aria-hidden />}
        {query && status !== "loading" && !disabled && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear search"
            // Keep focus in the input.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("");
              search("");
              inputRef.current?.focus();
            }}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        )}
      </div>

      <ul ref={listRef} id={listId} role="listbox" aria-label={label} hidden={!expanded} data-placement={placement} className={styles.listbox}>
        {status === "ready" &&
          results.map((hit, index) => {
            const { primary, secondary } = describe(hit);
            const isExcluded = excluded.has(hit.id);
            return (
              <li
                key={hit.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                aria-disabled={isExcluded || undefined}
                className={styles.option}
                // Keep focus in the input so the list doesn't close before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => {
                  if (!isExcluded && index !== active) setActive(index);
                }}
                onClick={() => choose(index)}
              >
                <span className={styles.optionPrimary}>{primary}</span>
                {(secondary || isExcluded) && (
                  <span className={styles.optionSecondary}>{isExcluded ? `${excludedNote}${secondary ? ` · ${secondary}` : ""}` : secondary}</span>
                )}
              </li>
            );
          })}
        {status === "ready" && results.length === 0 && (
          <li role="presentation" className={styles.listNote}>
            {emptyNote ? emptyNote(query.trim()) : <>No {noun.many} match &ldquo;{query.trim()}&rdquo;.</>}
          </li>
        )}
        {status === "loading" && (
          <li role="presentation" className={styles.listNote}>
            Searching…
          </li>
        )}
        {status === "error" && (
          <li role="presentation" className={styles.listNote}>
            {error}
          </li>
        )}
      </ul>

      <p className={styles.srOnly} role="status" aria-live="polite">
        {open ? announcement : ""}
      </p>
    </div>
  );
}
