"use client";

import { useEffect, useRef, useState } from "react";
import { filmSearchResponseSchema, type FilmSearchHit } from "@/games/_movies/schemas";
import { useCatalogSearch } from "@/games/_movies/ui/use-catalog-search";
import { Letters } from "./letters";
import styles from "./theater.module.css";

const byline = (film: FilmSearchHit) => [film.year, film.directors.join(" & ")].filter(Boolean).join(" · ");

/** What the confirm asks before the film is stopped (the guess line then fades out with it). */
export function stopQuestion(reel: number, worth: number, lastReel: boolean): string {
  return lastReel
    ? `Take the four? One pick, worth ${worth}. A wrong guess on this reel brings them up too.`
    : `Stop the film on reel ${reel}? Four titles, one pick, worth ${worth}. The rest stays in the can.`;
}

/**
 * The guess line. Search the catalog, choose a film (it stays in the field), then Guess, or press
 * Enter again. Skip unreels the next level without guessing (not on the last reel).
 *
 * At the left of the actions, set apart, the quiet way out: "The four · 35", the stake for stopping
 * the film on this reel. It asks first (the confirm takes the guess line's place; Escape or the
 * quiet button backs out and keeps what was typed). The stake ticks over once per reel, when the
 * new reel has settled on screen (`stakeReady`), and the control waits until then.
 */
export function Slate(props: {
  disabled: boolean;
  excludeIds: readonly number[];
  /** The reel being played (1–10). */
  reel: number;
  lastReel: boolean;
  /** What a right pick from the four is worth on this reel. */
  stake: number;
  /** The reel has settled on screen, so the stake shown is this reel's. */
  stakeReady: boolean;
  onGuess(film: FilmSearchHit): Promise<boolean>;
  onSkip(): void;
  onStop(): void;
}) {
  const { disabled, excludeIds, reel, lastReel, stake, stakeReady, onGuess, onSkip, onStop } = props;
  const [chosen, setChosen] = useState<FilmSearchHit | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fourButton = useRef<HTMLButtonElement>(null);
  const backOutFocus = useRef(false);

  // The stake on show: the settled reel's. It ticks (old dims out, new develops in) when it changes.
  const [shown, setShown] = useState({ value: stake, prev: null as number | null, tick: 0 });
  if (stakeReady && shown.value !== stake) setShown({ value: stake, prev: shown.value, tick: shown.tick + 1 });

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

  // A choice holds only while the field still shows it: clearing or editing the text (Escape, ×,
  // typing) drops it, however the field was changed.
  const picked = chosen && search.query === chosen.title ? chosen : null;

  async function guess() {
    if (!picked || disabled) return;
    const sent = picked;
    if (await onGuess(sent)) {
      setChosen(null);
      search.fill("");
    }
  }

  // Escape backs out of the confirm, as the quiet button does (not once the stop is on its way).
  useEffect(() => {
    if (!confirming || disabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      backOutFocus.current = true;
      setConfirming(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, disabled]);

  // Back on the guess line, focus returns to the control the confirm came from.
  useEffect(() => {
    if (confirming || !backOutFocus.current) return;
    backOutFocus.current = false;
    fourButton.current?.focus();
  }, [confirming]);

  function backOut() {
    backOutFocus.current = true;
    setConfirming(false);
  }

  if (confirming) {
    return (
      // Its own key, so it mounts fresh and the safe answer takes focus.
      <div key="confirm" className={styles.slate} role="group" aria-label={lastReel ? "Take the four?" : "Stop the film?"}>
        <p className={styles.confirmText}>{stopQuestion(reel, stake, lastReel)}</p>
        <div className={styles.slateActions}>
          {/* The safe answer takes focus: stopping can't be undone. */}
          <button type="button" className={styles.quiet} disabled={disabled} onClick={backOut} autoFocus>
            {lastReel ? "Keep guessing" : "Keep watching"}
          </button>
          <button type="button" className={styles.go} disabled={disabled} onClick={onStop}>
            {lastReel ? "Take the four" : "Stop the film"}
          </button>
        </div>
      </div>
    );
  }

  const { results, status, open, active, excluded, listRef, listId, optionId } = search;
  return (
    <div key="line" className={styles.slate}>
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
            if (event.key === "Enter" && !open && picked) {
              event.preventDefault();
              void guess();
              return;
            }
            search.inputProps.onKeyDown(event);
          }}
        />
        {picked && <span className={styles.chosen}>{byline(picked)}</span>}
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
        <button
          ref={fourButton}
          type="button"
          className={styles.fourControl}
          disabled={disabled || !stakeReady}
          onClick={() => setConfirming(true)}
          aria-label={lastReel ? `Take the four: one pick, worth ${shown.value}` : `The four: stop the film here, one pick worth ${shown.value}`}
        >
          <span aria-hidden>
            <span className={styles.fourThe}>The </span>Four<span className={styles.fourDot}>·</span>
          </span>
          <span className={styles.stake} aria-hidden>
            {shown.prev !== null && (
              <span key={`out-${shown.tick}`} className={styles.stakeOut}>
                {shown.prev}
              </span>
            )}
            <span key={`in-${shown.tick}`} className={shown.tick > 0 ? styles.stakeIn : undefined}>
              {shown.value}
            </span>
          </span>
        </button>
        {!lastReel && (
          <button type="button" className={styles.quiet} disabled={disabled} onClick={onSkip}>
            Skip
          </button>
        )}
        <button type="button" className={styles.go} disabled={disabled || !picked} onClick={() => void guess()}>
          Guess
        </button>
      </div>
    </div>
  );
}

/**
 * The guess line going out as the film stops, in place of the slate and laid out exactly as it
 * was: the confirm's question (or, after a miss on the last reel, the title that missed) fades
 * letter by letter, left to right, like the wordmark's "Fade to", and the actions go with it.
 * For looking at only.
 */
export function FadingSlate(props: { reel: number; worth: number; lastReel: boolean; missed: string | null }) {
  const { reel, worth, lastReel, missed } = props;
  return (
    <div className={`${styles.slate} ${styles.fadingSlate}`} aria-hidden>
      {missed !== null ? (
        <div className={styles.field}>
          <Letters text={missed} className={styles.input} />
        </div>
      ) : (
        <p className={styles.confirmText}>
          <Letters text={stopQuestion(reel, worth, lastReel)} />
        </p>
      )}
      <div className={styles.slateActions}>
        {missed !== null ? (
          <>
            <span className={styles.fourControl}>
              <span className={styles.fourThe}>The </span>Four<span className={styles.fourDot}>·</span>
              <span className={styles.stake}>{worth}</span>
            </span>
            <span className={styles.go}>Guess</span>
          </>
        ) : (
          <>
            <span className={styles.quiet}>{lastReel ? "Keep guessing" : "Keep watching"}</span>
            <span className={styles.go}>{lastReel ? "Take the four" : "Stop the film"}</span>
          </>
        )}
      </div>
    </div>
  );
}
