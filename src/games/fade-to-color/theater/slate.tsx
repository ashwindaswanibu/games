"use client";

import { useState } from "react";
import { filmSearchResponseSchema, type FilmSearchHit } from "@/games/_movies/schemas";
import { useCatalogSearch } from "@/games/_movies/ui/use-catalog-search";
import styles from "./theater.module.css";

const byline = (film: FilmSearchHit) => [film.year, film.directors.join(" & ")].filter(Boolean).join(" · ");

/**
 * The guess line. Search the catalog, choose a film (it stays in the field), then Guess, or press
 * Enter again. Skip unreels the next level without guessing; on the last reel it becomes Give up,
 * which asks first.
 */
export function Slate(props: {
  disabled: boolean;
  excludeIds: readonly number[];
  lastReel: boolean;
  onGuess(film: FilmSearchHit): Promise<boolean>;
  onSkip(): void;
}) {
  const { disabled, excludeIds, lastReel, onGuess, onSkip } = props;
  const [chosen, setChosen] = useState<FilmSearchHit | null>(null);
  const [confirming, setConfirming] = useState(false);

  const search = useCatalogSearch({
    endpoint: "/api/catalog/films",
    responseSchema: filmSearchResponseSchema,
    excludeIds,
    clearOnSelect: false,
    disabled,
    noun: { one: "film", many: "films" },
    onSelect(hit) {
      setChosen(hit);
      search.fill(hit.title);
    },
  });

  async function guess() {
    if (!chosen || disabled) return;
    const sent = chosen;
    if (await onGuess(sent)) {
      setChosen(null);
      search.fill("");
    }
  }

  if (confirming) {
    return (
      <div className={styles.slate} role="group" aria-label="Give up?">
        <p className={styles.confirmText}>Give up and see the film?</p>
        <div className={styles.slateActions}>
          <button type="button" className={styles.quiet} onClick={() => setConfirming(false)}>
            Keep guessing
          </button>
          <button type="button" className={styles.go} disabled={disabled} onClick={onSkip}>
            Give up
          </button>
        </div>
      </div>
    );
  }

  const { results, status, open, active, excluded, listRef, listId, optionId } = search;
  return (
    <div className={styles.slate}>
      <div className={styles.field}>
        <label htmlFor={search.inputId} className={styles.srOnly}>
          Name the film
        </label>
        <input
          {...search.inputProps}
          className={styles.input}
          placeholder="Which film is this?"
          onChange={(event) => {
            setChosen(null);
            search.inputProps.onChange(event);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !open && chosen) {
              event.preventDefault();
              void guess();
              return;
            }
            search.inputProps.onKeyDown(event);
          }}
        />
        {chosen && <span className={styles.chosen}>{byline(chosen)}</span>}
        <ul ref={listRef} id={listId} role="listbox" aria-label="Films" hidden={!open} className={styles.list}>
          {status === "ready" &&
            results.map((hit, index) => {
              const isExcluded = excluded.has(hit.id);
              return (
                <li
                  key={hit.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={isExcluded || undefined}
                  className={styles.option}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => {
                    if (!isExcluded && index !== active) search.setActive(index);
                  }}
                  onClick={() => search.choose(index)}
                >
                  <span className={styles.optionTitle}>{hit.title}</span>
                  <span className={styles.optionMeta}>{isExcluded ? `Already guessed · ${byline(hit)}` : byline(hit)}</span>
                </li>
              );
            })}
          {status === "ready" && results.length === 0 && (
            <li role="presentation" className={styles.listNote}>
              No films match &ldquo;{search.query.trim()}&rdquo;.
            </li>
          )}
          {status === "loading" && (
            <li role="presentation" className={styles.listNote}>
              Searching…
            </li>
          )}
          {status === "error" && (
            <li role="presentation" className={styles.listNote}>
              {search.error}
            </li>
          )}
        </ul>
        <p className={styles.srOnly} role="status" aria-live="polite">
          {open ? search.announcement : ""}
        </p>
      </div>
      <div className={styles.slateActions}>
        <button type="button" className={styles.quiet} disabled={disabled} onClick={() => (lastReel ? setConfirming(true) : onSkip())}>
          {lastReel ? "Give up" : "Skip"}
        </button>
        <button type="button" className={styles.go} disabled={disabled || !chosen} onClick={() => void guess()}>
          Guess
        </button>
      </div>
    </div>
  );
}
