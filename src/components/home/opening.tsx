"use client";

import { useEffect } from "react";
import type { HomeView } from "@/core/home-view";
import type { HomeComposition } from "./composition";

/** M1, the opening titles (built in the motion pass). */
export function Opening({ onEnd }: { view: HomeView; comp: HomeComposition; now: number; freezeAt: number | null; frames: boolean; onEnd: () => void }) {
  useEffect(() => {
    onEnd();
  }, [onEnd]);
  return null;
}
