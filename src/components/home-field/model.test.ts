import { describe, expect, it } from "vitest";
import { choosePlan, dayFraction, fieldHeight, fieldLayout, fieldMetrics, fieldPlan, spans, tileTargets } from "./model";

const groups = (ids: string[]) => ids.map((group) => ({ group }));

const width = (s: [number, number]) => s[1] - s[0];

describe("spans", () => {
  it("shares the length equally among games still to play", () => {
    const out = spans({ length: 1200, collapse: [0, 0, 0], print: 0, open: null, strip: 76, overshoot: 0 });
    expect(out.map(width)).toEqual([400, 400, 400]);
    expect(out[0]![0]).toBe(0);
    expect(out[2]![1]).toBe(1200);
  });

  it("collapses a finished game into a strip and gives its share to the rest", () => {
    const out = spans({ length: 1200, collapse: [1, 0, 0], print: 0, open: null, strip: 76, overshoot: 0 });
    expect(out.map(width)).toEqual([76, 562, 562]);
  });

  it("evens everything out for the day's print", () => {
    const out = spans({ length: 1200, collapse: [1, 1, 1], print: 1, open: null, strip: 76, overshoot: 0 });
    expect(out.map(width)).toEqual([400, 400, 400]);
  });

  it("never leaves a gap when everything is finished but the print hasn't opened", () => {
    const out = spans({ length: 1200, collapse: [1, 1, 1], print: 0, open: null, strip: 76, overshoot: 0 });
    expect(out[2]![1]).toBeCloseTo(1200);
  });

  it("shares by weight, keeps fixed pieces a strip and evens the rest by weight for the print", () => {
    const playing = spans({ length: 1200, collapse: [0, 0], weight: [3, 1], print: 0, open: null, strip: 76, overshoot: 0 });
    expect(playing.map(width)).toEqual([900, 300]);
    const fixed = spans({ length: 1000, collapse: [0, 0, 0], fixed: [true, false, false], print: 0, open: null, strip: 100, overshoot: 0 });
    expect(fixed.map(width)).toEqual([100, 450, 450]);
    const printed = spans({ length: 1000, collapse: [0, 1, 1], fixed: [true, false, false], weight: [1, 1, 3], print: 1, open: null, strip: 100, overshoot: 0 });
    expect(printed.map(width)).toEqual([100, 225, 675]);
  });

  it("grows the opened piece over the whole length", () => {
    const out = spans({ length: 1200, collapse: [0, 0, 0], print: 0, open: { index: 1, amount: 1 }, strip: 76, overshoot: 50 });
    expect(out[1]).toEqual([-50, 1250]);
    expect(width(out[0]!)).toBe(0);
    expect(width(out[2]!)).toBe(0);
  });
});

describe("fieldPlan", () => {
  const tiles = (groups: string[]) => groups.map((group) => ({ group }));

  it("leads each category with its plate, which takes the slots its games leave", () => {
    // Today: three Movies games and Lexicon. Plates are numbered after the tiles: 4 is Movies, 5 Words.
    const plan = fieldPlan(tiles(["movies", "movies", "movies", "words"]), 4);
    expect(plan.categories).toEqual(["movies", "words"]);
    expect(plan.rows).toEqual([[4, 0, 1, 2], [5, 3]]);
    expect(plan.slots).toEqual([1, 1, 1, 1, 1, 3]);
    expect(plan.bands).toEqual([false, false]);
  });

  it("lets small categories share a row", () => {
    const plan = fieldPlan(tiles(["movies", "movies", "movies", "words", "words", "geography", "chess"]), 4);
    expect(plan.rows).toEqual([[7, 0, 1, 2], [8, 3, 4], [9, 5, 10, 6]]);
    expect(plan.slots.slice(7)).toEqual([1, 2, 1, 1]);
  });

  it("gives every row the same number of game-sized slots", () => {
    for (const groups of [["a"], ["a", "a", "b"], ["a", "b", "b", "b", "b", "b", "c"], ["a", "a", "a", "a", "a", "a"]]) {
      for (const perRow of [2, 4]) {
        const plan = fieldPlan(tiles(groups), perRow);
        plan.rows.forEach((row, r) => {
          if (!plan.bands[r]) expect(row.reduce((n, i) => n + plan.slots[i]!, 0)).toBe(perRow);
        });
        expect(plan.rows.flat().sort((x, y) => x - y)).toEqual(Array.from({ length: groups.length + plan.categories.length }, (_, i) => i));
      }
    }
  });

  it("wraps a big category, its plate in the first row", () => {
    // On a phone (two a row): three Movies games.
    expect(fieldPlan(tiles(["movies", "movies", "movies"]), 2).rows).toEqual([[3, 0], [1, 2]]);
    // Five on a laptop.
    expect(fieldPlan(tiles(Array(5).fill("movies")), 4).rows).toEqual([[5, 0], [1, 2, 3, 4]]);
  });

  it("makes the plate a band above games that fill their rows", () => {
    const plan = fieldPlan(tiles(["words", "words", "movies"]), 2);
    expect(plan.rows).toEqual([[3], [0, 1], [4, 2]]);
    expect(plan.bands).toEqual([true, false, false]);
  });
});

describe("fieldLayout", () => {
  const metrics = { strip: 76, band: 72, lean: 0.083 };
  const plan = (groups: string[], perRow = 4) => fieldPlan(groups.map((group) => ({ group })), perRow);

  it("makes every game the same size, whatever its category", () => {
    const boxes = fieldLayout({ width: 1440, height: 840, plan: plan(["movies", "movies", "movies", "words"]), collapse: [0, 0, 0, 0], print: 0, open: null, metrics });
    for (const box of boxes.slice(0, 4)) {
      expect(width(box.x)).toBeCloseTo(360);
      expect(width(box.y)).toBeCloseTo(420);
    }
    // The Words plate fills the rest of its row.
    expect(width(boxes[5]!.x)).toBeCloseTo(1080);
  });

  it("makes a finished row a band, its plate with it, and gives the others the height", () => {
    const boxes = fieldLayout({ width: 1440, height: 700, plan: plan(["movies", "movies", "words"]), collapse: [1, 1, 0], print: 0, open: null, metrics });
    expect(width(boxes[0]!.y)).toBeCloseTo(72);
    expect(width(boxes[2]!.y)).toBeCloseTo(628);
    // The band is shared by slots: the plate's two, half; each game a quarter.
    expect(width(boxes[3]!.x)).toBeCloseTo(720);
    expect(width(boxes[0]!.x)).toBeCloseTo(360);
  });

  it("keeps a plate band its height, even in the day's print", () => {
    const p = plan(["words", "words", "movies"], 2);
    const boxes = fieldLayout({ width: 390, height: 772, plan: p, collapse: [1, 1, 1], print: 1, open: null, metrics });
    expect(width(boxes[3]!.y)).toBeCloseTo(72);
    expect(width(boxes[0]!.y)).toBeCloseTo(350);
    expect(width(boxes[2]!.y)).toBeCloseTo(350);
  });

  it("grows an opened tile over the whole field", () => {
    const boxes = fieldLayout({ width: 1440, height: 700, plan: plan(["a", "a", "b", "b"]), collapse: [0, 0, 0, 0], print: 0, open: { index: 3, amount: 1 }, metrics });
    expect(boxes[3]!.x[0]).toBeLessThan(0);
    expect(boxes[3]!.x[1]).toBeGreaterThan(1440);
    expect(boxes[3]!.y[0]).toBeLessThan(0);
    expect(boxes[3]!.y[1]).toBeGreaterThan(700);
  });

  it("grows the field past the screen rather than squeeze rows", () => {
    expect(fieldHeight(756, { bands: [false, false] }, { band: 72, minRow: 220 })).toBe(756);
    expect(fieldHeight(756, { bands: [true, false, false, false, false] }, { band: 72, minRow: 220 })).toBe(952);
  });
});

describe("tileTargets and fieldMetrics", () => {
  it("collapses finished games and opens the print when all are done", () => {
    expect(tileTargets([{ state: "finished" }, { state: "playing" }])).toEqual({ collapse: [1, 0], print: 0 });
    expect(tileTargets([{ state: "finished" }, { state: "finished" }])).toEqual({ collapse: [1, 1], print: 1 });
  });

  it("holds two games a row on a phone", () => {
    const plan = choosePlan(groups(["movies", "movies", "words"]), { width: 390, height: 780 }, fieldMetrics(390));
    expect(plan.rows).toEqual([[3], [0, 1], [4, 2]]);
    expect(plan.bands).toEqual([true, false, false]);
  });

  it("chooses the row length that leaves plates least to fill", () => {
    const laptop = { width: 1440, height: 844 };
    // Two Movies games and Lexicon: one row of five.
    expect(choosePlan(groups(["movies", "movies", "words"]), laptop, fieldMetrics(1440)).rows).toEqual([[3, 0, 1, 4, 2]]);
    // Three and one: rows of four.
    expect(choosePlan(groups(["movies", "movies", "movies", "words"]), laptop, fieldMetrics(1440)).rows).toEqual([[4, 0, 1, 2], [5, 3]]);
  });

  it("prefers rows that fit the screen", () => {
    const plan = choosePlan(groups(["movies", "movies", "movies", "words", "words", "geography", "geography"]), { width: 1440, height: 844 }, fieldMetrics(1440));
    expect(plan.rows).toHaveLength(3);
    expect(plan.rows[0]).toHaveLength(4);
  });

  it("measures the New York day", () => {
    expect(dayFraction(Date.parse("2026-10-08T16:00:00Z"), "2026-10-08T04:00:00Z", "2026-10-09T04:00:00Z")).toBeCloseTo(0.5);
  });
});
