"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { IMDB_ATTRIBUTION } from "../attribution";
import { MOVIES_FONT_VARS } from "./fonts";
import styles from "./movies.module.css";
import { MoviesVariantProvider, useMoviesVariant, type MoviesVariant } from "./variant";

export interface MoviesStageProps {
  /** The game's name, set as the film title. */
  title: string;
  /** Small caps after "Movies", e.g. "Reel 2 of 4". */
  kicker?: string;
  /**
   * `ochre` (default) for the Movies world; `neutral` for color games: a neutral-gray stage so the
   * surround doesn't bias color perception. Every kit component inside inherits it.
   */
  variant?: MoviesVariant;
  /** A film-leader countdown in the slate, e.g. guesses left. */
  countdown?: { value: number; label: string };
  /** Marks the puzzle as a development fixture (procedural stand-in images). */
  devFixture?: boolean;
  /** Extra controls on the slate's right, e.g. a help button. */
  slateAside?: ReactNode;
  /**
   * A one-line slate for play in progress, so the puzzle and its controls fit a phone screen. The
   * full title card is for the finished board.
   */
  compact?: boolean;
  children: ReactNode;
}

/**
 * The frame every Movies game board sits in: an ochre title slate (cut-paper edge, grain,
 * perforations, the game's name in film-title type) over an ink "screen" lit by a cyan projector
 * beam, with the catalog's data credit (IMDb) in fine print at the foot. The `neutral` variant
 * swaps all of it for a colorist's gray.
 */
export function MoviesStage({
  title,
  kicker,
  variant = "ochre",
  countdown,
  devFixture,
  slateAside,
  compact = false,
  children,
}: MoviesStageProps) {
  const titleId = useId();
  return (
    <MoviesVariantProvider value={variant}>
      <section aria-labelledby={titleId} data-variant={variant} className={`${MOVIES_FONT_VARS} ${styles.root} ${styles.stage}`}>
        <header className={styles.slate} data-compact={compact}>
          <div className={styles.slateText}>
            <p className={styles.kicker}>
              <span>Movies{kicker ? ` · ${kicker}` : ""}</span>
              {devFixture && (
                <span className={styles.fixtureTag} title="Placeholder puzzle with generated images, for development">
                  Dev fixture
                </span>
              )}
            </p>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
          </div>
          {(countdown || slateAside) && (
            <div className={styles.slateAside}>
              {slateAside}
              {countdown && <FilmLeader value={countdown.value} label={countdown.label} />}
            </div>
          )}
        </header>
        <div className={styles.screen}>{children}</div>
        <p className={styles.colophon}>{IMDB_ATTRIBUTION}</p>
      </section>
    </MoviesVariantProvider>
  );
}

/** A film-leader countdown mark: crosshair, rings, a sweeping hand and a big numeral. */
export function FilmLeader({ value, label }: { value: number; label: string }) {
  return (
    <span className={styles.leader} role="img" aria-label={`${value} ${label}`}>
      <i className={styles.leaderSweep} aria-hidden />
      <i className={styles.leaderCross} aria-hidden />
      {/* Keyed so the numeral rises in again whenever it changes. */}
      <b key={value} className={styles.leaderValue} aria-hidden>
        {value}
      </b>
    </span>
  );
}

/**
 * Opens its content with an iris (a circle growing from the center) whenever `revealKey` changes,
 * e.g. when a new frame is unlocked. No animation on first render or with reduced motion, and no
 * overlay: the content itself is clipped while the iris opens, then left untouched.
 */
export function IrisReveal({
  revealKey,
  children,
  className = "",
}: {
  revealKey: string | number;
  children: ReactNode;
  className?: string;
}) {
  const [initialKey] = useState(revealKey);
  return (
    <div key={revealKey} className={`${revealKey === initialKey ? "" : styles.iris} ${className}`}>
      {children}
    </div>
  );
}

export interface MoviesButtonProps extends Omit<ComponentProps<"button">, "className"> {
  /** `primary`: the one main action (ochre, or white on the neutral stage). */
  kind?: "primary" | "secondary" | "quiet";
  /** Full width. */
  block?: boolean;
  variant?: MoviesVariant;
}

/** Movies-world button: 48px tall, uppercase tracking, square cut. */
export function MoviesButton({ kind = "secondary", block = false, variant, type = "button", ...props }: MoviesButtonProps) {
  const resolved = useMoviesVariant(variant);
  return (
    <button
      type={type}
      data-kind={kind}
      data-block={block}
      data-variant={resolved}
      className={`${MOVIES_FONT_VARS} ${styles.root} ${styles.button}`}
      {...props}
    />
  );
}
