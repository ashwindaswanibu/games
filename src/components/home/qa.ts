import type { HomeClock, HomeCue } from "@/core/home-view";
import type { HomeQa } from "./home";

/**
 * The home's review hooks (spec §13.2), parsed from the page's search params. Development only:
 * in a production build this always returns null, so no hook can change what players see.
 *
 *   ?qa_t=HH:MM           pretend it is HH:MM in New York (the cue, dial, countdown follow)
 *   ?qa_cue=night         force a cue
 *   ?qa_opening=play      play the opening; a number freezes it at that millisecond
 *   ?qa_setin=<id>        play that game's set-in; &qa_st=<ms> freezes it
 *   ?qa_fin=1             the FIN card
 *   ?qa_frames=1          log frame deltas while a moment plays
 *   ?qa_cue_change=1      crossfade to the next cue 1.5 s after load
 */
export function parseQa(params: Record<string, string | string[] | undefined>, clock: Pick<HomeClock, "dayStartsAt">, realNow: number): HomeQa | null {
  if (process.env.NODE_ENV === "production") return null;
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" ? v : undefined;
  };
  const keys = Object.keys(params).filter((k) => k.startsWith("qa_"));
  if (keys.length === 0) return null;

  let offsetMs = 0;
  const t = one("qa_t")?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (t) {
    const at = Date.parse(clock.dayStartsAt) + ((Number(t[1]) * 60 + Number(t[2])) * 60 + Number(t[3] ?? 0)) * 1000;
    offsetMs = at - realNow;
  }
  const cue = one("qa_cue");
  const opening = one("qa_opening");
  const st = one("qa_st");
  return {
    offsetMs,
    cue: cue === "morning" || cue === "afternoon" || cue === "night" ? (cue as HomeCue) : null,
    opening: opening === undefined ? null : /^\d+$/.test(opening) ? Number(opening) : "play",
    setIn: one("qa_setin") ?? null,
    setInAt: st && /^\d+$/.test(st) ? Number(st) : null,
    fin: one("qa_fin") === "1",
    frames: one("qa_frames") === "1",
    cueChange: one("qa_cue_change") === "1",
  };
}
