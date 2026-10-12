import type { FilmRef, PersonRef } from "@/games/_movies/schemas";
import type { DegreesLink, DegreesPuzzle } from "../schema";

/*
 * The board's thread, as data (see `board.tsx`): the start actor at one end, the end actor at the
 * other, a knot per person between. At par the thread is taut; every link over par is slack, and
 * the thread sags with it. Pure; tested.
 */

export type KnotKind = "start" | "tied" | "open" | "ahead" | "end";
export type SegmentKind = "tied" | "open" | "ahead";

export interface ThreadKnot {
  /** Stable while the knot means the same thing: a new tie gets a new key (and draws in). */
  key: string;
  kind: KnotKind;
  /** Who is tied here; null for a knot still to tie. */
  person: PersonRef | null;
  /** The next-link hint's co-star, shown faintly on the open knot. */
  ghost: PersonRef | null;
  /** Before the play: what will stand here, written faintly on the unlit thread. */
  note?: string;
}

export interface ThreadSegment {
  key: string;
  kind: SegmentKind;
  /** The film this stretch passes through: tied, or chosen for the link being made (`draft`). */
  film: FilmRef | null;
  draft: boolean;
  /** A hint's film, shown faintly where it goes (the next link, or the way in to the end). */
  ghost: FilmRef | null;
  /** Before the play: what will ride here, written faintly on the unlit thread. */
  note?: string;
}

export interface Thread {
  knots: ThreadKnot[];
  /** `segments[i]` runs from `knots[i]` to `knots[i + 1]`. */
  segments: ThreadSegment[];
  /** Links over par: how far the thread sags. */
  slack: number;
  reached: boolean;
}

/**
 * The thread for a chain. While `open` (playing, end not reached) it runs on past the last person:
 * the stretch being made, then a knot for each link still needed to make par, then the end actor;
 * past par, the stretch being made leads straight to the end actor.
 */
export function threadOf(
  puzzle: Pick<DegreesPuzzle, "start" | "end" | "par">,
  links: readonly DegreesLink[],
  options: { open: boolean; draft?: FilmRef | null; next?: { film: FilmRef; person: PersonRef } | null; wayIn?: FilmRef | null } = { open: false },
): Thread {
  const knots: ThreadKnot[] = [{ key: "start", kind: "start", person: puzzle.start, ghost: null }];
  const segments: ThreadSegment[] = [];
  links.forEach((link, i) => {
    const key = `${i}:${link.film.id}:${link.person.id}`;
    const end = link.person.id === puzzle.end.id;
    segments.push({ key, kind: "tied", film: link.film, draft: false, ghost: null });
    // The end actor's knot stays the same knot as it's reached: its name and face stay put while the light runs to them.
    knots.push({ key: end ? "end" : key, kind: end ? "end" : "tied", person: link.person, ghost: null });
  });
  const reached = links.at(-1)?.person.id === puzzle.end.id;

  if (!reached && options.open) {
    const draft = options.draft ?? null;
    const next = options.next ?? null;
    const wayIn = options.wayIn && !links.some((l) => l.film.id === options.wayIn!.id) ? options.wayIn : null;
    // Knots after the last person, the end actor's included.
    const ahead = Math.max(1, puzzle.par - links.length);
    const nextToEnd = next !== null && next.person.id === puzzle.end.id;
    const at = links.length;
    segments.push({ key: `open${at}`, kind: "open", film: draft, draft: draft !== null, ghost: draft ? null : (next?.film ?? (ahead === 1 ? wayIn : null)) });
    for (let k = 1; k < ahead; k++) {
      knots.push({ key: `ahead${at + k}`, kind: k === 1 ? "open" : "ahead", person: null, ghost: k === 1 && next && !nextToEnd ? next.person : null });
      segments.push({ key: `ahead${at + k}`, kind: "ahead", film: null, draft: false, ghost: k === ahead - 1 ? wayIn : null });
    }
    knots.push({ key: "end", kind: "end", person: puzzle.end, ghost: null });
  } else if (!reached) {
    knots.push({ key: "end", kind: "end", person: puzzle.end, ghost: null });
    segments.push({ key: `ahead${links.length}`, kind: "ahead", film: null, draft: false, ghost: null });
  }

  return { knots, segments, slack: Math.max(0, segments.length - puzzle.par), reached };
}

export interface Point {
  x: number;
  y: number;
}

export interface ThreadGeometry {
  vertical: boolean;
  /** Each knot's centre, in the board's pixels. */
  points: Point[];
  /** The board's height: fixed across, growing with the chain down a phone. */
  height: number;
  /** Room between neighbouring knots along the thread. */
  spacing: number;
}

/** Below this width the thread runs down the screen instead of across it. */
export const VERTICAL_BELOW = 720;

/**
 * Where each knot sits. Across a wide screen, the knots share the width and the thread sags down by
 * its slack; down a narrow one, they're spaced evenly from the top and it bows out to the right.
 * Either way the sag is a parabola through the knots, deepest in the middle.
 */
export function threadGeometry(count: number, slack: number, box: { width: number; height: number }): ThreadGeometry {
  const n = Math.max(2, count);
  const bow = (i: number) => {
    const u = i / (n - 1);
    return 4 * u * (1 - u);
  };
  if (box.width < VERTICAL_BELOW) {
    const spacing = 76;
    // Room above the first pin and below the last for the two ends' title bands.
    const top = 150;
    const sag = Math.min(64, slack * 18);
    const points = Array.from({ length: n }, (_, i) => ({ x: 28 + sag * bow(i), y: top + i * spacing }));
    return { vertical: true, points, height: top + (n - 1) * spacing + 150, spacing };
  }
  const pad = Math.max(28, Math.min(96, box.width * 0.065));
  const spacing = (box.width - 2 * pad) / (n - 1);
  // The ends' names stand above the line; the knots' names and the sag hang below it.
  const line = box.height * 0.52;
  // The lowest knot's face (12px under it, up to min(184, 0.8 × spacing) across, see `--cd`) and
  // its name's two lines under that stay on the board, clear of the end titles below it.
  const hang = 12 + Math.min(184, spacing * 0.8) * 0.7 + 2 * 26;
  const sag = Math.min(box.height * 0.26, slack * 24, Math.max(0, box.height - line - hang));
  const points = Array.from({ length: n }, (_, i) => ({ x: pad + i * spacing, y: line + sag * bow(i) }));
  return { vertical: false, points, height: box.height, spacing };
}

/** A straight stretch between two knots, as CSS draws it: from `a`, `length` long, turned `angle` degrees. */
export function stretch(a: Point, b: Point): { x: number; y: number; length: number; angle: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { x: a.x, y: a.y, length: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * An end actor's name set as a title card, on two lines: split at the space that keeps the longer
 * line shortest (the earlier space on a tie). A single word stays one line.
 */
export function twoLines(name: string): [string] | [string, string] {
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2) return [name];
  let best: [string, string] = [words[0]!, words.slice(1).join(" ")];
  for (let i = 2; i < words.length; i++) {
    const split: [string, string] = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    if (Math.max(split[0].length, split[1].length) < Math.max(best[0].length, best[1].length)) best = split;
  }
  return best;
}

/**
 * The type size of an end actor's title card across a board `width` wide: large, but never so wide
 * that the two ends' longest lines would meet in the middle. In pixels.
 */
export function endNameSize(name: string, width: number): number {
  const longest = Math.max(...twoLines(name).map((line) => line.length));
  return Math.round(Math.max(40, Math.min(88, width * 0.061, (0.38 * width) / (0.47 * longest))));
}

/** The light's wait for the last stretch to draw in, and the shortest and longest it takes to run the thread (ms). */
const LIGHT_AFTER_MS = 700;
const LIGHT_RUN_MS = { min: 700, max: 1100 };

/**
 * When the light that runs the thread on a win reaches each part of it, in ms from the moment the
 * end is reached: it waits for the last stretch to draw in, then runs at one speed from the start
 * pin to the end ring. `lengths[i]` is stretch i's length; knot i is reached at the start of
 * stretch i (the last knot at the end of the run), a stretch's film as the light passes its middle.
 */
export function lightTimes(lengths: readonly number[]): { segments: { at: number; for: number }[]; films: number[]; knots: number[] } {
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const run = Math.min(LIGHT_RUN_MS.max, Math.max(LIGHT_RUN_MS.min, total / 1.4));
  const at = (distance: number) => Math.round(LIGHT_AFTER_MS + (total > 0 ? (run * distance) / total : 0));
  const before = lengths.map((_, i) => lengths.slice(0, i).reduce((sum, length) => sum + length, 0));
  return {
    segments: lengths.map((length, i) => ({ at: at(before[i]!), for: Math.round(total > 0 ? (run * length) / total : 0) })),
    films: lengths.map((length, i) => at(before[i]! + length / 2)),
    knots: [...before, total].map(at),
  };
}
