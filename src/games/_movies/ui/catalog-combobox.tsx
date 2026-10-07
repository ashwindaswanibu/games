"use client";

import { useLayoutEffect } from "react";
import { IMDB_ATTRIBUTION } from "../attribution";
import { MOVIES_FONT_VARS } from "./fonts";
import styles from "./movies.module.css";
import { useCatalogSearch, type CatalogSearchConfig } from "./use-catalog-search";
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

interface ComboboxConfig<Hit extends { id: number }> extends CatalogSearchProps<Hit>, Omit<CatalogSearchConfig<Hit>, keyof CatalogSearchProps<Hit>> {
  /** `note`: an optional quiet extra line, e.g. the other title a film matched by. */
  describe(hit: Hit): { primary: string; secondary: string | null; note?: string | null };
}

/** The kit's look for `useCatalogSearch`: a labelled field with a dropdown of hits. */
export function CatalogCombobox<Hit extends { id: number }>(config: ComboboxConfig<Hit>) {
  const { emptyNote, describe, noun, label, placeholder, disabled = false, excludedNote = "Already guessed", placement = "below", autoFocus = false } = config;
  const variant = useMoviesVariant(config.variant);
  const search = useCatalogSearch(config);
  const { query, results, status, error, open: expanded, active, excluded, inputRef, popupRef, listId, optionId } = search;

  // Keep the whole dropdown (hits and the IMDb credit) on screen: below the field when it fits
  // above the app's bottom nav, otherwise above it if there's more room there, and never taller
  // than the room it has. Set on the element directly, so measuring causes no extra render.
  useLayoutEffect(() => {
    const popup = popupRef.current;
    const field = inputRef.current?.getBoundingClientRect();
    if (!expanded || !popup || !field) return;
    const navTop = document.querySelector('[data-app-chrome="bottom-nav"]')?.getBoundingClientRect().top ?? window.innerHeight;
    const below = navTop - field.bottom - 14;
    const above = field.top - 14;
    const wanted = popup.scrollHeight;
    const up = placement === "above" || (wanted > below && above > below);
    popup.dataset.placement = up ? "above" : "below";
    const cap = Math.min(window.innerHeight * 0.5, 344);
    popup.style.maxHeight = `${Math.floor(Math.max(160, Math.min(cap, up ? above : below)))}px`;
  }, [expanded, status, results.length, placement, popupRef, inputRef]);

  return (
    <div data-variant={variant} className={`${MOVIES_FONT_VARS} ${styles.root} ${styles.search}`}>
      <label htmlFor={search.inputId} className={styles.searchLabel}>
        {label}
      </label>
      <div className={styles.searchField} data-disabled={disabled}>
        <svg className={styles.searchIcon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <circle cx="8.5" cy="8.5" r="6" />
          <path d="M13 13l5 5" strokeLinecap="square" />
        </svg>
        <input {...search.inputProps} className={styles.searchInput} placeholder={placeholder} autoFocus={autoFocus} />
        {status === "loading" && <span className={styles.spinner} aria-hidden />}
        {query && status !== "loading" && !disabled && (
          <button
            type="button"
            className={styles.clear}
            aria-label="Clear search"
            // Keep focus in the input.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              search.clear();
              inputRef.current?.focus();
            }}
          >
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        )}
      </div>

      {/* The hits scroll; IMDb's credit sits under them, outside the scrolling list, so it shows
          whatever the list's height or scroll position. */}
      <div ref={popupRef} hidden={!expanded} className={styles.dropdown}>
        <ul id={listId} role="listbox" aria-label={label} className={styles.listbox}>
          {status === "ready" &&
            results.map((hit, index) => {
              const { primary, secondary, note } = describe(hit);
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
                    if (!isExcluded && index !== active) search.setActive(index);
                  }}
                  onClick={() => search.choose(index)}
                >
                  <span className={styles.optionPrimary}>{primary}</span>
                  {note && <span className={styles.optionNote}>{note}</span>}
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
        {status === "ready" && results.length > 0 && (
          // IMDb's required credit wherever its data is shown. Hidden from assistive tech here (it
          // isn't part of the list); the board's foot carries the same line for everyone. A press on
          // it keeps focus in the field, so the list stays open.
          <p aria-hidden className={styles.listCredit} onMouseDown={(event) => event.preventDefault()}>
            {IMDB_ATTRIBUTION}
          </p>
        )}
      </div>

      <p className={styles.srOnly} role="status" aria-live="polite">
        {expanded ? search.announcement : ""}
      </p>
    </div>
  );
}
