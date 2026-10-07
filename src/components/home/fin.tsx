"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { HomeDay } from "@/core/home-view";
import { CutLetters } from "./bucket-art";
import { formatEndOf } from "./format";
import type { CutWord } from "./geometry";
import { S16, steps, Timeline } from "./timeline";
import styles from "./moments.module.css";

const HOLD = 2500;
const STILL = 1000;

/**
 * M4 · FIN (spec §8.5), only if the page is open at New York midnight: the dial's last sliver is
 * cut, then a hard cut to the end title. FIN in the cut alphabet on a vermilion plate, the date,
 * tomorrow's line; a hold; then the page asks for the new day (whose opening plays next).
 */
export function Fin({ day, fin, plate, reduced, hold, onEnd }: { day: HomeDay; fin: CutWord; plate: string; reduced: boolean; hold: boolean; onEnd: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onEndRef = useRef(onEnd);
  useLayoutEffect(() => {
    onEndRef.current = onEnd;
  });

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (hold) return;
    if (reduced) {
      const t = setTimeout(() => onEndRef.current(), STILL);
      return () => clearTimeout(t);
    }
    const T = new Timeline();
    const q = (sel: string) => root.querySelector<HTMLElement>(sel);
    // The dial's last sliver goes on the frame before the cut.
    T.show(root, S16);
    root.querySelectorAll("[data-letter]").forEach((letter, i) => {
      const at = S16 + i * S16;
      T.show(letter, at);
      T.key(letter.firstElementChild, [
        [at, { transform: "scale(1.12)", easing: steps(2) }],
        [at + 140, { transform: "scale(1)" }],
      ]);
    });
    T.show(q("[data-fin-plate]"), S16 + 250);
    T.show(q("[data-fin-when]"), S16 + 500);
    T.show(q("[data-fin-next]"), S16 + 750);
    T.extendTo(HOLD);
    let live = true;
    void T.play().then(() => {
      if (live) onEndRef.current();
    });
    return () => {
      live = false;
      T.cancel();
    };
  }, [hold, reduced]);

  return (
    <div ref={ref} className={styles.fin} role="status" aria-live="polite" data-fin="" style={{ "--cut": plate } as CSSProperties}>
      <div className={styles.finIn}>
        <svg className={styles.finDial} viewBox="-50 -50 100 100" aria-hidden="true">
          <circle r="48.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.5 3" opacity="0.5" />
        </svg>
        <div className={styles.finWord} aria-hidden="true">
          <span className={styles.finPlate} data-fin-plate="" />
          <CutLetters word={fin} />
        </div>
        <span className={styles.srOnly}>Fin.</span>
        <p className={styles.finWhen} data-fin-when="">
          {formatEndOf(day)}
        </p>
        <p className={styles.finNext} data-fin-next="">
          {day.nextWeekday}&apos;s puzzles are ready.
        </p>
      </div>
    </div>
  );
}
