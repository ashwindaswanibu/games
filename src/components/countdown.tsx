"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function format(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Ticks down to `target` (ISO instant), then refreshes the page so the new day's puzzles load. */
export function Countdown({ target }: { target: string }) {
  const router = useRouter();
  const targetMs = Date.parse(target);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= targetMs) {
        clearInterval(id);
        router.refresh();
      }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [targetMs, router]);

  // Render nothing time-dependent on the server to avoid a hydration mismatch.
  return <span className="tabular-nums">{now === null ? "–:––:––" : format(targetMs - now)}</span>;
}
