"use client";

import type { CSSProperties } from "react";
import { LEVEL_COUNT } from "../logic";
import styles from "./theater.module.css";
import { PRINT_RUN_STEP_MS } from "./timing";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The ten reels as a contact strip: a small print of each one the player has seen, unexposed film
 * for the rest. Choosing a print puts that reel back on screen.
 *
 * Once the film is stopped (`closed`), the reels never seen are shut in their cans: leader black.
 * `closing` shuts them in front of the player, right to left (the stop, seen live).
 *
 * `run` is the win's print run: the reels the player didn't need develop in order, one every
 * `PRINT_RUN_STEP_MS` from print `run.from`, under a playhead (the white ring of the print on
 * screen, drawn apart so it can jump print to print; the win's timeline moves it).
 */
export function ContactStrip(props: {
  /** Prints for the reels the player can see, in order (undefined while one is developing). */
  thumbs: readonly (string | undefined)[];
  /** The reel on screen. */
  showing: number | null;
  /** The reel being played (the newest one), or null once the film is over. */
  current: number | null;
  /** The film was stopped: the unseen reels stay in the can. */
  closed?: boolean;
  /** Shut them now, one after another. */
  closing?: boolean;
  /** The print run: prints from index `from` on develop in order. */
  run?: { from: number } | null;
  onPick(index: number): void;
}) {
  const { thumbs, showing, current, closed = false, closing = false, run = null, onPick } = props;
  return (
    <ol className={styles.contact} aria-label="Reels" data-closing={(closed && closing) || undefined} data-run={run ? "" : undefined}>
      {Array.from({ length: LEVEL_COUNT }, (_, i) => {
        const available = i < thumbs.length;
        const state = !available ? (closed ? "closed" : "locked") : i === current ? "current" : "seen";
        const develop = run && i >= run.from ? { "--develop-at": `${(i - run.from + 1) * PRINT_RUN_STEP_MS}ms` } : null;
        return (
          <li key={i} style={develop as CSSProperties | undefined}>
            <button
              type="button"
              className={styles.print}
              data-state={state}
              data-showing={i === showing || undefined}
              disabled={!available}
              aria-current={i === showing ? "true" : undefined}
              aria-label={
                available ? `Reel ${i + 1}${i === showing ? ", on screen" : ""}` : closed ? `Reel ${i + 1}, left in the can` : `Reel ${i + 1}, not yet unreeled`
              }
              // The last reel shuts first.
              style={{ "--shut": LEVEL_COUNT - 1 - i } as CSSProperties}
              onClick={() => onPick(i)}
            >
              <span className={styles.printImage} style={thumbs[i] ? { backgroundImage: `url(${thumbs[i]})` } : undefined} />
              <span className={styles.printNumber}>{pad(i + 1)}</span>
            </button>
          </li>
        );
      })}
      {run && <li className={styles.playhead} aria-hidden data-win="playhead" />}
    </ol>
  );
}
