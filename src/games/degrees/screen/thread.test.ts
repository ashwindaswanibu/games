import { describe, expect, it } from "vitest";
import { endNameSize, lightTimes, stretch, threadGeometry, threadOf, twoLines, VERTICAL_BELOW } from "./thread";

const pacino = { id: 1, name: "Al Pacino" };
const deNiro = { id: 2, name: "Robert De Niro" };
const foster = { id: 3, name: "Jodie Foster" };
const hopkins = { id: 4, name: "Anthony Hopkins" };
const keitel = { id: 5, name: "Harvey Keitel" };
const heat = { id: 10, title: "Heat", year: 1995 };
const taxi = { id: 11, title: "Taxi Driver", year: 1976 };
const lambs = { id: 12, title: "The Silence of the Lambs", year: 1991 };
const puzzle = { start: pacino, end: hopkins, par: 3 };

const kinds = (t: ReturnType<typeof threadOf>) => ({ knots: t.knots.map((k) => k.kind), segments: t.segments.map((s) => s.kind) });

describe("threadOf", () => {
  it("lays out par before the first link: the stretch being made, knots to tie, the end", () => {
    const t = threadOf(puzzle, [], { open: true });
    expect(kinds(t)).toEqual({ knots: ["start", "open", "ahead", "end"], segments: ["open", "ahead", "ahead"] });
    expect(t.slack).toBe(0);
    expect(t.reached).toBe(false);
  });

  it("ties links in, and past par leads the stretch being made straight to the end with slack", () => {
    const two = threadOf(puzzle, [{ film: heat, person: deNiro }, { film: taxi, person: foster }], { open: true });
    expect(kinds(two)).toEqual({ knots: ["start", "tied", "tied", "end"], segments: ["tied", "tied", "open"] });
    const four = threadOf(puzzle, [{ film: heat, person: deNiro }, { film: taxi, person: foster }, { film: heat, person: keitel }], { open: true });
    expect(kinds(four)).toEqual({ knots: ["start", "tied", "tied", "tied", "end"], segments: ["tied", "tied", "tied", "open"] });
    expect(four.slack).toBe(1);
  });

  it("puts the chosen film on the stretch being made, and hints where they go", () => {
    const drafted = threadOf(puzzle, [], { open: true, draft: heat, wayIn: lambs });
    expect(drafted.segments[0]).toMatchObject({ kind: "open", film: heat, draft: true, ghost: null });
    expect(drafted.segments[2]!.ghost).toEqual(lambs);

    const hinted = threadOf(puzzle, [], { open: true, next: { film: heat, person: deNiro } });
    expect(hinted.segments[0]!.ghost).toEqual(heat);
    expect(hinted.knots[1]!.ghost).toEqual(deNiro);
  });

  it("shows the way in on the stretch being made when it leads to the end, and drops it once used", () => {
    const last = threadOf(puzzle, [{ film: heat, person: deNiro }, { film: taxi, person: foster }], { open: true, wayIn: lambs });
    expect(last.segments[2]!.ghost).toEqual(lambs);
    const used = threadOf({ ...puzzle, par: 2 }, [{ film: lambs, person: foster }], { open: true, wayIn: lambs });
    expect(used.segments.every((s) => s.ghost === null)).toBe(true);
  });

  it("keys each tie by what it ties, so a different link in the same place is a new knot", () => {
    const a = threadOf(puzzle, [{ film: heat, person: deNiro }], { open: true });
    const b = threadOf(puzzle, [{ film: heat, person: keitel }], { open: true });
    expect(a.segments[0]!.key).not.toBe(b.segments[0]!.key);
    expect(a.knots.at(-1)!.key).toBe("end");
  });

  it("ends at the end actor once reached", () => {
    const t = threadOf(puzzle, [{ film: heat, person: deNiro }, { film: taxi, person: foster }, { film: lambs, person: hopkins }], { open: true });
    expect(kinds(t)).toEqual({ knots: ["start", "tied", "tied", "end"], segments: ["tied", "tied", "tied"] });
    expect(t.reached).toBe(true);
    expect(t.knots.at(-1)!.person).toEqual(hopkins);
  });

  it("keeps the end actor's knot as the same knot once it's reached", () => {
    const open = threadOf(puzzle, [{ film: heat, person: deNiro }, { film: taxi, person: foster }], { open: true });
    const reached = threadOf(puzzle, [{ film: heat, person: deNiro }, { film: taxi, person: foster }, { film: lambs, person: hopkins }], { open: true });
    expect(open.knots.at(-1)!.key).toBe("end");
    expect(reached.knots.at(-1)!.key).toBe("end");
    expect(reached.segments.at(-1)!.key).not.toBe(open.segments.at(-1)!.key);
  });
});

describe("threadGeometry", () => {
  it("runs across a wide screen, taut at par and sagging in the middle with slack", () => {
    const taut = threadGeometry(4, 0, { width: 1200, height: 300 });
    expect(taut.vertical).toBe(false);
    expect(new Set(taut.points.map((p) => p.y)).size).toBe(1);
    expect(taut.points[0]!.x).toBeLessThan(taut.points[3]!.x);
    const slack = threadGeometry(5, 2, { width: 1200, height: 300 });
    expect(slack.points[2]!.y).toBeGreaterThan(slack.points[0]!.y);
    expect(slack.points[0]!.y).toBe(slack.points[4]!.y);
  });

  it("runs down a phone, growing with the chain", () => {
    const g = threadGeometry(4, 0, { width: VERTICAL_BELOW - 1, height: 0 });
    expect(g.vertical).toBe(true);
    expect(g.points[1]!.y - g.points[0]!.y).toBe(g.spacing);
    expect(threadGeometry(6, 0, { width: 390, height: 0 }).height).toBeGreaterThan(g.height);
  });

  it("leaves room down a phone for the ends' title bands above the first pin and below the last", () => {
    const g = threadGeometry(4, 0, { width: 390, height: 0 });
    expect(g.points[0]!.y).toBe(150);
    expect(g.spacing).toBe(76);
    expect(g.height).toBe(150 + 3 * 76 + 150);
  });

  it("draws a stretch as a length and a turn", () => {
    expect(stretch({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({ x: 0, y: 0, length: 5, angle: (Math.atan2(4, 3) * 180) / Math.PI });
  });
});

describe("twoLines", () => {
  it("splits a name where the longer line is shortest, the earlier place on a tie", () => {
    expect(twoLines("Sandra Bullock")).toEqual(["Sandra", "Bullock"]);
    expect(twoLines("Louis de Funès")).toEqual(["Louis", "de Funès"]);
    expect(twoLines("Philip Seymour Hoffman")).toEqual(["Philip Seymour", "Hoffman"]);
  });

  it("keeps a single word on one line", () => {
    expect(twoLines("Zendaya")).toEqual(["Zendaya"]);
  });
});

describe("endNameSize", () => {
  it("sets the ends large across a laptop's board, smaller for long names, never under 40px", () => {
    expect(endNameSize("Sandra Bullock", 1320)).toBe(81);
    expect(endNameSize("Louis de Funès", 1320)).toBe(81);
    expect(endNameSize("Maximilian Schellenberger", 1000)).toBeLessThan(61);
    expect(endNameSize("Maximilian Schellenberger", 300)).toBe(40);
  });
});

describe("lightTimes", () => {
  it("runs the light at one speed from the start pin to the end ring, after the last stretch draws", () => {
    const t = lightTimes([300, 600, 300]);
    expect(t.knots[0]).toBe(700);
    expect(t.segments.map((s) => s.at)).toEqual([700, 700 + 214, 700 + 643]);
    expect(t.segments[1]!.for).toBeCloseTo(2 * t.segments[0]!.for, -1);
    expect(t.knots.at(-1)).toBe(700 + 857);
    expect(t.films[1]).toBe(700 + 429);
  });

  it("takes between 0.7s and 1.1s to run, however long the thread", () => {
    expect(lightTimes([100, 100]).knots.at(-1)).toBe(700 + 700);
    expect(lightTimes([2000, 2000]).knots.at(-1)).toBe(700 + 1100);
  });
});
