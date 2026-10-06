"use client";

import { useEffect, useRef, useState } from "react";
import { describeClue, spokenGuess } from "../clue-text";
import type { Clue, FilmGuess } from "../schemas";
import { MOVIES_FONT_VARS } from "./fonts";
import styles from "./movies.module.css";
import { useMoviesVariant, type MoviesVariant } from "./variant";

export interface ClueChipsProps {
  clues: readonly Clue[];
  /** Accessible name for the list, e.g. "Clues from Heat". */
  label?: string;
  variant?: MoviesVariant;
}

/** Clue chips: arrow and shape glyphs plus words, with color only as reinforcement. */
export function ClueChips({ clues, label = "Clues", variant }: ClueChipsProps) {
  const resolved = useMoviesVariant(variant);
  if (clues.length === 0) return null;
  return (
    <ul aria-label={label} data-variant={resolved} className={`${MOVIES_FONT_VARS} ${styles.root} ${styles.clues}`}>
      {clues.map((clue) => {
        const chip = describeClue(clue);
        return (
          <li key={clue.kind} className={styles.chip} data-tone={chip.tone}>
            <span className={styles.chipGlyph} aria-hidden>
              {chip.glyph}
            </span>
            {chip.fullText === chip.text ? (
              chip.text
            ) : (
              <>
                <span aria-hidden>{chip.text}</span>
                <span className={styles.srOnly} data-sr-only>
                  {chip.fullText}
                </span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One row of a guess log: a guess with its clues, or a skipped turn. */
export type GuessLogEntry = FilmGuess | { skipped: true };

export interface GuessLogProps {
  entries: readonly GuessLogEntry[];
  /** Shown when there are no entries yet. */
  emptyText?: string;
  label?: string;
  /** The play ended with the player giving up: a final skip reads "Gave up" rather than "Skipped". */
  gaveUp?: boolean;
  variant?: MoviesVariant;
}

/** Numbered guesses, newest last, each with its verdict and clues. */
export function GuessLog({ entries, emptyText = "No guesses yet.", label = "Your guesses", gaveUp = false, variant }: GuessLogProps) {
  const resolved = useMoviesVariant(variant);
  return (
    <div data-variant={resolved} className={`${MOVIES_FONT_VARS} ${styles.root}`}>
      {entries.length === 0 ? (
        <p className={styles.logEmpty}>{emptyText}</p>
      ) : (
        <ol aria-label={label} className={styles.log}>
          {entries.map((entry, index) => {
            if ("skipped" in entry) {
              const quit = gaveUp && index === entries.length - 1;
              return (
                <li key={index} className={styles.entry}>
                  <span className={styles.entryNo} aria-hidden>
                    {index + 1}
                  </span>
                  <span className={styles.entryTitle}>{quit ? "Gave up" : "Skipped"}</span>
                  <span className={styles.entryVerdict}>
                    <span aria-hidden>{quit ? "⚑" : "»"}</span> {quit ? "Out" : "Skip"}
                  </span>
                </li>
              );
            }
            return (
              <li key={index} className={styles.entry} data-correct={entry.correct}>
                <span className={styles.entryNo} aria-hidden>
                  {index + 1}
                </span>
                <span className={styles.entryTitle}>
                  {entry.film.title}
                  {entry.film.year !== null && <span className={styles.entryYear}>{entry.film.year}</span>}
                </span>
                <span className={styles.entryVerdict}>
                  <span aria-hidden>{entry.correct ? "✓" : "✕"}</span> {entry.correct ? "Got it" : "Miss"}
                </span>
                {entry.clues.length > 0 && (
                  <div className={styles.entryClues}>
                    <ClueChips clues={entry.clues} label={`Clues from ${entry.film.title}`} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export interface LastGuessProps {
  /** The whole guess log; the newest entry is shown. Nothing renders before the first move. */
  entries: readonly GuessLogEntry[];
  variant?: MoviesVariant;
}

/**
 * The verdict and clues of the newest move, for the controls block right under the search, so a
 * miss is answered where the player is looking. The full `GuessLog` stays below as history.
 *
 * After each new move (not on load) it brings itself into view if it isn't already: on a phone
 * the earned image and the search can leave it under the bottom navigation otherwise. The page's
 * `scroll-padding` keeps it clear of the app's fixed header and nav.
 */
export function LastGuess({ entries, variant }: LastGuessProps) {
  const resolved = useMoviesVariant(variant);
  const ref = useRef<HTMLElement>(null);
  const [initialCount] = useState(entries.length);
  const count = entries.length;
  useEffect(() => {
    if (count <= initialCount || !ref.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [count, initialCount]);

  const entry = entries.at(-1);
  if (!entry) return null;
  return (
    <section ref={ref} aria-label="Your last guess" data-variant={resolved} className={`${MOVIES_FONT_VARS} ${styles.root} ${styles.lastGuess}`}>
      {"skipped" in entry ? (
        <p className={styles.lastGuessTitle}>
          <span className={styles.lastGuessGlyph} aria-hidden>
            »
          </span>
          Skipped
        </p>
      ) : (
        <>
          <p className={styles.lastGuessTitle} data-correct={entry.correct}>
            <span className={styles.lastGuessGlyph} aria-hidden>
              {entry.correct ? "✓" : "✕"}
            </span>
            {entry.correct ? "" : "Not "}
            {entry.film.title}
            {entry.film.year !== null && <span className={styles.entryYear}>({entry.film.year})</span>}
          </p>
          <ClueChips clues={entry.clues} label="Clues from your last guess" />
        </>
      )}
    </section>
  );
}

/**
 * A visually hidden live region. Pass a message derived from the play state: it is read out when
 * it changes after a move, not on the first render.
 */
export function LiveStatus({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className={styles.srOnly}>
      {message}
    </p>
  );
}

/** What a screen reader hears after a guess-game move: the verdict, the clues, then what's left. */
export function guessAnnouncement(entries: readonly GuessLogEntry[], after: string): string {
  const last = entries.at(-1);
  if (!last) return "";
  return [spokenGuess(last), after].filter(Boolean).join(" ");
}
