"use client";

import { useState, type CSSProperties } from "react";
import styles from "./screen.module.css";

/**
 * The running head over the book: the gap's two bounds set as a dictionary sets its guide words,
 * large in the corners. AFTER the closest guess before today's word on the left, BEFORE the closest
 * after it on the right. Until a side has a bound, its corner holds the book's first (or last)
 * initial, faint. A bound that changes develops in place as its ribbon lays in; the bounds already
 * there when the head first drew are just there. Before the play the corners are empty, holding
 * their room so the book never moves.
 */
export function RunningHead(props: {
  lowWord: string | null;
  highWord: string | null;
  /** The book's first and last initials (null before the play). */
  first: string | null;
  last: string | null;
  /** The gap in words, for screen readers (null when there's no gap to tell). */
  describe: string | null;
}) {
  const { lowWord, highWord, first, last, describe } = props;
  const [present] = useState(() => new Set([lowWord, highWord]));
  return (
    <div className={styles.head}>
      <Corner side="after" word={lowWord} initial={first} fresh={lowWord !== null && !present.has(lowWord)} />
      <Corner side="before" word={highWord} initial={last} fresh={highWord !== null && !present.has(highWord)} />
      {describe && <p className={styles.srOnly}>{describe}</p>}
    </div>
  );
}

function Corner({ side, word, initial, fresh }: { side: "after" | "before"; word: string | null; initial: string | null; fresh: boolean }) {
  return (
    <div className={styles.corner} data-side={side} aria-hidden>
      <span className={styles.cornerKicker} data-empty={word === null || undefined}>
        {side === "after" ? "After" : "Before"}
      </span>
      {word !== null ? (
        <span key={word} className={styles.guide} data-fresh={fresh || undefined} style={{ "--len": word.length } as CSSProperties}>
          {word}
        </span>
      ) : (
        <span className={styles.initial}>{initial ?? " "}</span>
      )}
    </div>
  );
}
