"use client";

import { useState, type CSSProperties } from "react";
import type { LexiconGuess } from "../logic";
import styles from "./screen.module.css";

/**
 * How the book is playing right now. `opening`: today's dictionary lights up page by page, seen
 * live. `closing`: the gap shuts on today's word (found, or given up). `still`: as it is.
 */
export type BookMode = "opening" | "closing" | "still";

/**
 * Today's dictionary, seen from its fore-edge: one page for every word the nine letters spell, in
 * order, and a thumb index cut into the top for each initial letter. The pages today's word may
 * still be on are lit; the rest fall into shadow as the gap closes. Each guess is a red silk
 * ribbon laid in at its page, the word lettered up it. At the end the book shuts on one page.
 */
export function Book(props: {
  total: number;
  tabs: readonly { letter: string; at: number }[];
  guesses: readonly LexiconGuess[];
  /** The lit pages run from `low + 1` to `high - 1`. */
  low: number;
  high: number;
  /** Today's word's page, once the play is over. */
  answer: number | null;
  mode: BookMode;
}) {
  const { total, tabs, guesses, low, high, answer, mode } = props;
  // Ribbons laid in after the book first drew drop into place; the restored ones are just there.
  const [first] = useState(() => new Set(guesses.map((g) => g.word)));
  const at = (page: number) => `${((page + 0.5) / total) * 100}%`;
  // Once over, the light narrows to the answer's page alone.
  const lo = answer !== null ? answer - 1 : low;
  const hi = answer !== null ? answer + 1 : high;

  return (
    <div
      className={styles.book}
      data-mode={mode}
      data-over={answer !== null || undefined}
      style={{ "--pages": total, "--left": (lo + 1) / total, "--right": (total - hi) / total } as CSSProperties}
      aria-hidden
    >
      <div className={styles.tabs}>
        {tabs.map((tab, i) => {
          // A letter with only a few pages: its tab is a notch without a letter on a narrow screen.
          const size = (tabs[i + 1]?.at ?? total) - tab.at;
          return (
            <span key={tab.letter} className={styles.tab} data-small={size / total < 0.04 || undefined} style={{ left: `${(tab.at / total) * 100}%`, "--i": i } as CSSProperties}>
              {tab.letter}
            </span>
          );
        })}
      </div>
      <div className={styles.edge}>
        <div className={styles.pages} />
        <div className={styles.light} />
        <div className={`${styles.shade} ${styles.shadeLeft}`} />
        <div className={`${styles.shade} ${styles.shadeRight}`} />
        {answer !== null && <span className={styles.answerPage} data-found={guesses.some((g) => g.side === "found") || undefined} style={{ left: at(answer) }} />}
      </div>
      {guesses.map((g) => {
        // The two ribbons that bound the gap carry their words, set outward so they never meet;
        // the one that found the word carries it too. Ribbons already passed stay quiet.
        const edge = g.side === "found" ? "found" : g.page === low ? "low" : g.page === high ? "high" : undefined;
        return (
          <span key={g.word} className={styles.ribbon} data-side={g.side} data-edge={edge} data-fresh={!first.has(g.word) || undefined} style={{ left: at(g.page) }} title={g.word}>
            <span className={styles.silk} />
            {edge && <span className={styles.ribbonWord}>{g.word}</span>}
          </span>
        );
      })}
    </div>
  );
}
