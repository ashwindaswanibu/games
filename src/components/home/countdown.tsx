"use client";

import { useEffect, useState } from "react";
import { countdownLabel, type ClockReading, type GameClock } from "./game-clock";
import styles from "./title.module.css";

const LAST_HOUR_MS = 60 * 60 * 1000;

/**
 * "NEW PUZZLES IN · 10:34:46 · MIDNIGHT · NEW YORK". Digits sit in fixed cells (tabular, they never
 * jostle); the colons are ink at .40. The server renders dashes (it can't know the reader's second).
 * In the last hour the digits and the city line turn vermilion; nothing else changes. Screen
 * readers get one sentence, updated once a minute, never the ticking digits.
 */
export function Countdown({ clock, onZero }: { clock: GameClock; onZero?: () => void }) {
  const [reading, setReading] = useState<ClockReading | null>(null);
  const [label, setLabel] = useState("New puzzles at midnight, New York time");

  useEffect(() => {
    let minute = -1;
    let fired = false;
    return clock.subscribe((r) => {
      setReading(r);
      const m = r.hours * 60 + r.minutes;
      if (m !== minute) {
        minute = m;
        setLabel(countdownLabel(r));
      }
      if (r.rolledOver && !fired) {
        fired = true;
        onZero?.();
      }
    });
  }, [clock, onZero]);

  const digits = reading ? reading.digits : null;
  const lastHour = reading !== null && reading.remainingMs < LAST_HOUR_MS;
  const cell = (i: number) => (
    <span className={styles.d} data-digit={i}>
      {digits ? digits[i] : "–"}
    </span>
  );

  return (
    <div className={styles.countGroup} data-last-hour={lastHour ? "" : undefined}>
      <span className={styles.lbl} aria-hidden="true" data-op="count-label">
        New puzzles in
      </span>
      <span className={styles.count} aria-hidden="true" data-op="count">
        {cell(0)}
        {cell(1)}
        <span className={styles.c}>:</span>
        {cell(2)}
        {cell(3)}
        <span className={styles.c}>:</span>
        {cell(4)}
        {cell(5)}
      </span>
      <span className={`${styles.lbl} ${styles.city}`} aria-hidden="true" data-op="count-city">
        Midnight · New York
      </span>
      <span role="timer" className={styles.srOnly}>
        {label}
      </span>
    </div>
  );
}
