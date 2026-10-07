"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { GameClock } from "./game-clock";
import { dialRim, dialSector } from "./geometry";

/** Twelve hour ticks; every third longer and heavier. */
const TICKS = Array.from({ length: 12 }, (_, i) => i);

/** The dial's face, drawn for a fraction of the day gone. Shared by the hero and the opening. */
export function DialFace({ gone, rimSeed, hand = true }: { gone: number; rimSeed: string; hand?: boolean }) {
  const rim = useMemo(() => dialRim(rimSeed), [rimSeed]);
  const sector = dialSector(gone, rim);
  return (
    <>
      <circle r="48.5" fill="none" stroke="var(--ink)" strokeWidth="1.6" opacity="0.4" data-dial-ring="" />
      {sector && (
        <g data-dial-paper="">
          <path d={sector} fill="var(--plate)" transform="translate(2 2.6)" />
          <path d={sector} fill="var(--ochre)" />
        </g>
      )}
      <g stroke="var(--ink)" opacity="0.4">
        {TICKS.map((i) => (
          <line key={i} x1="0" y1="-47" x2="0" y2={i % 3 ? -43 : -39.5} strokeWidth={i % 3 ? 1 : 1.8} transform={`rotate(${i * 30})`} />
        ))}
      </g>
      {hand && (
        <line x1="0" y1="2" x2="0" y2="-54" stroke="var(--glint)" strokeWidth="2.4" transform={`rotate(${(gone * 360).toFixed(2)})`} data-dial-hand="" />
      )}
      <circle r="3.4" fill="var(--sheet-ink)" />
    </>
  );
}

/**
 * The clock: a standalone cut disc. Its ochre paper is what is left of today (full at midnight, a
 * sliver at 11 pm); the glint hand is now. Redrawn once a minute (a path swap, never animated).
 * At night the paper is the room's lamp. Decorative: the countdown carries the time in words.
 */
export function Dial({ clock, initialGone, rimSeed, className, style }: { clock: GameClock; initialGone: number; rimSeed: string; className?: string; style?: CSSProperties }) {
  const [gone, setGone] = useState(initialGone);
  useEffect(() => {
    let minute = -1;
    return clock.subscribe((reading) => {
      const m = Math.floor(reading.now / 60_000);
      if (m === minute) return;
      minute = m;
      setGone(reading.gone);
    });
  }, [clock]);
  return (
    <svg className={className} style={style} viewBox="-50 -50 100 100" aria-hidden="true" focusable="false" data-dial="">
      <DialFace gone={gone} rimSeed={rimSeed} />
    </svg>
  );
}
