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
  ghost: string | null;
}

export interface ThreadSegment {
  key: string;
  kind: SegmentKind;
  /** The film this stretch passes through: tied, or chosen for the link being made (`draft`). */
  film: FilmRef | null;
  draft: boolean;
  /** A hint's film, shown faintly where it goes (the next link, or the way in to the end). */
  ghost: FilmRef | null;
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
    segments.push({ key, kind: "tied", film: link.film, draft: false, ghost: null });
    knots.push({ key, kind: link.person.id === puzzle.end.id ? "end" : "tied", person: link.person, ghost: null });
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
      knots.push({ key: `ahead${at + k}`, kind: k === 1 ? "open" : "ahead", person: null, ghost: k === 1 && next && !nextToEnd ? next.person.name : null });
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
    const spacing = 66;
    const top = 30;
    const sag = Math.min(64, slack * 18);
    const points = Array.from({ length: n }, (_, i) => ({ x: 20 + sag * bow(i), y: top + i * spacing }));
    return { vertical: true, points, height: top + (n - 1) * spacing + 44, spacing };
  }
  const pad = Math.max(28, Math.min(96, box.width * 0.065));
  const spacing = (box.width - 2 * pad) / (n - 1);
  // The ends' names stand above the line; the knots' names and the sag hang below it.
  const line = box.height * 0.52;
  const sag = Math.min(box.height * 0.26, slack * 24);
  const points = Array.from({ length: n }, (_, i) => ({ x: pad + i * spacing, y: line + sag * bow(i) }));
  return { vertical: false, points, height: box.height, spacing };
}

/** A straight stretch between two knots, as CSS draws it: from `a`, `length` long, turned `angle` degrees. */
export function stretch(a: Point, b: Point): { x: number; y: number; length: number; angle: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { x: a.x, y: a.y, length: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}
