"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { LexiconGuess } from "../logic";
import { LAPTOP, lens, PHONE } from "./lens";
import styles from "./book.module.css";

/**
 * How the book is playing right now. `opening`: it riffles open into today's dictionary, seen
 * live. `closing`: it shuts on today's word (found, or given up). `still`: as it is.
 */
export type BookMode = "opening" | "closing" | "still";

/** A guess plays in two beats: the shadow falls over the ruled-out pages, then the book opens at the gap. */
const SWEEP_MS = 1000;
/** While the window is being resized the leaves jump to their places rather than trail. */
const RESIZE_SETTLE_MS = 150;
/** A dictionary bigger than this draws only every so-many-th leaf (about 240 of them). */
const MAX_LEAVES = 400;

/**
 * Today's dictionary, standing on a desk, seen from its fore-edge: boards standing proud of bone
 * paper, a leaf for every word the nine letters spell, in order, and a thumb index stepped down
 * the edge, one tab for each initial letter. The pages today's word may still be on are lit, the
 * count stamped on them; the rest fall into shadow as the gap closes. Each guess is a red silk
 * ribbon laid in at its page, its tail hanging out of the foot.
 *
 * The book falls open at the gap (`lens.ts`): each guess first lets the shadow fall over the pages
 * it ruled out while every leaf stays put, then presses those pages together and spreads the ones
 * still in play under the light. At the end it shuts on one lit leaf, which turns to face the
 * player as the dictionary page (`page.tsx`). Before the play it stands shut and uncut.
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
  /** Before the play: shut, its pages pressed together and unreadable. */
  closed?: boolean;
  /** The page has turned to face the player: the book steps back into the dark. */
  turned?: boolean;
}) {
  const { total, tabs, guesses, low, high, answer, mode, closed = false, turned = false } = props;
  // Ribbons laid in after the book first drew drop into place; the restored ones are just there.
  const [first] = useState(() => new Set(guesses.map((g) => g.word)));
  // Once over, the light narrows to the answer's page alone.
  const lo = answer !== null ? answer - 1 : low;
  const hi = answer !== null ? answer + 1 : high;

  // The gap the book is open at. It follows the real one a beat late, so the shadow can fall first;
  // a finish seen live never moves it (the book shuts where it is), a reload starts settled.
  const [shown, setShown] = useState({ low: lo, high: hi });
  const settled = shown.low === lo && shown.high === hi;
  useEffect(() => {
    if (settled || answer !== null) return;
    const wait = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : SWEEP_MS;
    const timer = setTimeout(() => setShown({ low: lo, high: hi }), wait);
    return () => clearTimeout(timer);
  }, [settled, answer, lo, hi]);

  // The count stamped on the lit pages presses in anew each time it changes in front of the player.
  const n = shown.high - shown.low - 1;
  const [firstN] = useState(n);

  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      setResizing(true);
      clearTimeout(timer);
      timer = setTimeout(() => setResizing(false), RESIZE_SETTLE_MS);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timer);
    };
  }, []);

  if (closed) {
    return (
      <div className={styles.book} data-closed aria-hidden>
        <span className={`${styles.board} ${styles.front}`} />
        <div className={styles.block}>
          <div className={styles.paper} />
        </div>
        <span className={`${styles.board} ${styles.back}`} />
        <div className={styles.desk} />
      </div>
    );
  }

  // Every piece is placed in both lenses, the laptop's and the phone's; the stylesheet picks one.
  const wide = lens(total, shown.low, shown.high, LAPTOP);
  const narrow = lens(total, shown.low, shown.high, PHONE);
  const gap = (l: typeof wide) => {
    const from = l.x(shown.low + 1);
    const width = l.x(shown.high) - from;
    return { from, width, centre: from + width / 2 };
  };
  const g = gap(wide);
  const gs = gap(narrow);
  const every = total > MAX_LEAVES ? Math.ceil(total / 240) : 1;
  const over = answer === null ? undefined : guesses.some((x) => x.side === "found") ? "won" : "lost";

  return (
    <div
      className={styles.book}
      data-mode={mode}
      data-stage={settled ? "dolly" : "sweep"}
      data-over={over}
      data-turned={turned || undefined}
      data-resizing={resizing || undefined}
      style={
        {
          "--gl": g.from,
          "--gw": g.width,
          "--gc": g.centre,
          "--sl": wide.x(lo + 1),
          "--sr": 1 - wide.x(hi),
          "--gls": gs.from,
          "--gws": gs.width,
          "--gcs": gs.centre,
          "--sls": narrow.x(lo + 1),
          "--srs": 1 - narrow.x(hi),
          "--digits": String(n).length,
        } as CSSProperties
      }
      aria-hidden
    >
      <span className={`${styles.board} ${styles.front}`} />
      <div className={styles.block}>
        <div className={styles.paper}>
          {Array.from({ length: total - 1 }, (_, k) => k + 1)
            .filter((i) => i % every === 0)
            .map((i) => (
              <i key={i} className={styles.line} style={{ "--x": wide.x(i), "--xs": narrow.x(i), "--f": i / total } as CSSProperties} />
            ))}
          <div className={styles.light} />
          <div key={n} className={styles.stamp} data-fresh={n !== firstN || undefined} data-label={g.width >= 0.15 || undefined} data-label-s={gs.width >= 0.38 || undefined}>
            <b>{n}</b>
            <small>{n === total ? "words" : n === 1 ? "word left" : "words left"}</small>
          </div>
          <div className={`${styles.shade} ${styles.left}`} />
          <div className={`${styles.shade} ${styles.right}`} />
          {answer !== null && (
            <span
              className={styles.answerLeaf}
              data-leaf
              style={{ "--ax": wide.x(answer), "--aw": wide.pitch(answer), "--axs": narrow.x(answer), "--aws": narrow.pitch(answer) } as CSSProperties}
            >
              <i />
            </span>
          )}
        </div>

        <div className={styles.tabs} style={{ "--k": tabs.length } as CSSProperties}>
          {tabs.map((tab, i) => (
            <span
              key={tab.letter}
              className={styles.tab}
              data-first={tab.at === 0 || undefined}
              style={{ "--i": i, "--x": wide.x(tab.at), "--xs": narrow.x(tab.at), "--f": tab.at / total } as CSSProperties}
            >
              {tab.letter}
            </span>
          ))}
        </div>

        {guesses.map((x) => {
          // The two ribbons that bound the gap (and the one that found the word) stand out; ribbons
          // already passed stay quiet.
          const edge = x.side === "found" ? "found" : x.page === low ? "low" : x.page === high ? "high" : undefined;
          return (
            <span
              key={x.word}
              className={styles.ribbon}
              data-side={x.side}
              data-edge={edge}
              data-fresh={!first.has(x.word) || undefined}
              style={{ "--x": wide.centre(x.page), "--xs": narrow.centre(x.page) } as CSSProperties}
            >
              <span className={styles.thread} />
              <span className={styles.tail} />
            </span>
          );
        })}

        <div className={styles.reflection} />
      </div>
      <span className={`${styles.board} ${styles.back}`} />
      <div className={styles.desk} />
    </div>
  );
}
