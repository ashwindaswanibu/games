import { describe, expect, it } from "vitest";
import { stretch, threadGeometry, threadOf, VERTICAL_BELOW } from "./thread";

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
    expect(hinted.knots[1]!.ghost).toBe("Robert De Niro");
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

  it("draws a stretch as a length and a turn", () => {
    expect(stretch({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({ x: 0, y: 0, length: 5, angle: (Math.atan2(4, 3) * 180) / Math.PI });
  });
});
