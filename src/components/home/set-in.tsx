"use client";

import { useEffect } from "react";
import type { HomeGame } from "@/core/home-view";

/** M2, the set-in (built in the motion pass). */
export function SetIn({ game, onEnd }: { game: HomeGame; cut: string; freezeAt: number | null; frames: boolean; onEnd: (sentence: string) => void }) {
  useEffect(() => {
    onEnd(game.name);
  }, [game, onEnd]);
  return null;
}
