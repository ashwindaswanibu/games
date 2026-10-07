import { cueAt } from "@/core/daylight";
import type { HomeCue, HomeView } from "@/core/home-view";
import { composeHome } from "./composition";
import type { HomeProps } from "./home";
import { parseQa } from "./qa";

/** The ground of each cue, for the browser's bars (`themeColor`). */
export const CUE_GROUND: Readonly<Record<HomeCue, string>> = {
  morning: "#f2e9d3",
  afternoon: "#eee1ca",
  night: "#110e0b",
};

/** The server's clock at render (a function, so pages stay free of impure calls in render). */
export function renderedAt(): number {
  return Date.now();
}

/**
 * Everything the client root needs besides the view, computed on the server: the day's
 * composition, the light at render time, and (development only) the review hooks.
 */
export function homeProps(
  view: HomeView,
  params: Record<string, string | string[] | undefined>,
  opts: { realNow: number; sceneAt?: number },
): Omit<HomeProps, "className"> {
  const qa = parseQa(params, view.clock, opts.realNow);
  // A fixture is set at a scene time; `qa_t` moves any page to another.
  const offsetMs = qa && qa.offsetMs !== 0 ? qa.offsetMs : opts.sceneAt !== undefined ? opts.sceneAt - opts.realNow : 0;
  const initialNow = opts.realNow + offsetMs;
  const qaFull = qa || offsetMs !== 0 ? { ...(qa ?? emptyQa()), offsetMs } : null;
  return {
    view,
    comp: composeHome(view),
    initialCue: qaFull?.cue ?? cueAt(initialNow, view.clock),
    initialNow,
    qa: qaFull,
  };
}

function emptyQa(): NonNullable<HomeProps["qa"]> {
  return { offsetMs: 0, cue: null, opening: null, setIn: null, setInAt: null, fin: false, frames: false, cueChange: false };
}
