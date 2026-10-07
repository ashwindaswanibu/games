"use client";

import { useEffect, useMemo } from "react";
import type { HomeClock } from "@/core/home-view";

/** Correct the device clock only when it is clearly wrong (network latency is noise below this). */
const SKEW_THRESHOLD_MS = 30_000;
/** Ticks land just after the second turns, so the digits flip on the beat of the real clock. */
const TICK_LATE_MS = 15;

export interface ClockReading {
  /** Skew-corrected now (epoch ms). */
  now: number;
  remainingMs: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** "HHMMSS", the six digits on the countdown. */
  digits: string;
  /** Fraction of the game day already gone, 0–1 (DST-safe: 23 h and 25 h days). */
  gone: number;
  /** The next game day has begun. */
  rolledOver: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Skew is measured the first time a view is seen, which is right after the server built it. A view
 * restored later from the router cache (back/forward) reuses that measurement instead of mistaking
 * its age for a wrong device clock.
 */
const skewByView = new Map<string, number>();
const SKEW_MEMORY = 8;

function measuredSkew(generatedAt: string): number {
  const known = skewByView.get(generatedAt);
  if (known !== undefined) return known;
  const raw = Date.parse(generatedAt) - Date.now();
  const skew = Math.abs(raw) > SKEW_THRESHOLD_MS ? raw : 0;
  skewByView.set(generatedAt, skew);
  if (skewByView.size > SKEW_MEMORY) skewByView.delete(skewByView.keys().next().value as string);
  return skew;
}

/** A reading of the game day at `now` (pure; used for the first render and by the clock). */
export function readClock(clock: Pick<HomeClock, "dayStartsAt" | "rollsOverAt">, now: number): ClockReading {
  const start = Date.parse(clock.dayStartsAt);
  const end = Date.parse(clock.rollsOverAt);
  const remainingMs = Math.max(0, end - now);
  const total = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const length = Math.max(1, end - start);
  return {
    now,
    remainingMs,
    hours,
    minutes,
    seconds,
    digits: `${pad2(Math.min(99, hours))}${pad2(minutes)}${pad2(seconds)}`,
    gone: Math.min(1, Math.max(0, (now - start) / length)),
    rolledOver: remainingMs <= 0,
  };
}

/**
 * The game-day clock for one view: counts down to `rollsOverAt` and measures the day's elapsed
 * fraction from `dayStartsAt`. The device clock is corrected once, against the server's
 * `generatedAt`, when it is more than 30 s off. Subscribers are called once per second, aligned to
 * the second, and not at all while the page is hidden.
 *
 * `offsetMs` (QA only) shifts the whole clock, so a page can pretend to be at any New York time.
 */
export class GameClock {
  private readonly clock: Pick<HomeClock, "dayStartsAt" | "rollsOverAt">;
  private readonly generatedAt: string;
  private readonly offsetMs: number;
  private skew = 0;
  private readonly listeners = new Set<(reading: ClockReading) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(clock: Pick<HomeClock, "dayStartsAt" | "rollsOverAt">, generatedAt: string, offsetMs = 0) {
    this.clock = clock;
    this.generatedAt = generatedAt;
    this.offsetMs = offsetMs;
  }

  /** Skew-corrected now (epoch ms). */
  now(): number {
    return Date.now() + this.skew + this.offsetMs;
  }

  read(): ClockReading {
    return readClock(this.clock, this.now());
  }

  subscribe(listener: (reading: ClockReading) => void): () => void {
    this.listeners.add(listener);
    if (this.running) listener(this.read());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts ticking (client only). Measures skew once. Pauses while the document is hidden. */
  run(): () => void {
    if (this.running) return () => this.halt();
    this.running = true;
    this.skew = measuredSkew(this.generatedAt);
    const tick = () => {
      clearTimeout(this.timer);
      if (!this.running || document.hidden) return;
      const reading = this.read();
      for (const listener of this.listeners) listener(reading);
      this.timer = setTimeout(tick, 1000 - (reading.now % 1000) + TICK_LATE_MS);
    };
    const onVisibility = () => {
      if (!document.hidden) tick();
      else clearTimeout(this.timer);
    };
    document.addEventListener("visibilitychange", onVisibility);
    tick();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      this.halt();
    };
  }

  private halt(): void {
    this.running = false;
    clearTimeout(this.timer);
  }
}

/** "New puzzles in 10 hours 34 minutes": the countdown's accessible name, updated once a minute. */
export function countdownLabel(reading: Pick<ClockReading, "hours" | "minutes" | "rolledOver">): string {
  if (reading.rolledOver) return "New puzzles are out";
  const h = reading.hours === 1 ? "1 hour" : `${reading.hours} hours`;
  const m = reading.minutes === 1 ? "1 minute" : `${reading.minutes} minutes`;
  return reading.hours > 0 ? `New puzzles in ${h} ${m}` : `New puzzles in ${m}`;
}

/** The view's clock, ticking while mounted. A new view (new day) gets a new clock. */
export function useGameClock(clock: Pick<HomeClock, "dayStartsAt" | "rollsOverAt">, generatedAt: string, offsetMs = 0): GameClock {
  const { dayStartsAt, rollsOverAt } = clock;
  const gameClock = useMemo(
    () => new GameClock({ dayStartsAt, rollsOverAt }, generatedAt, offsetMs),
    [dayStartsAt, rollsOverAt, generatedAt, offsetMs],
  );
  useEffect(() => gameClock.run(), [gameClock]);
  return gameClock;
}
