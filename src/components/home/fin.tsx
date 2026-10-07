"use client";

import { useEffect } from "react";
import type { HomeDay } from "@/core/home-view";
import type { CutWord } from "./geometry";

/** M4, FIN (built in the motion pass). */
export function Fin({ onEnd, hold }: { day: HomeDay; fin: CutWord; reduced: boolean; hold: boolean; onEnd: () => void }) {
  useEffect(() => {
    if (!hold) onEnd();
  }, [hold, onEnd]);
  return null;
}
