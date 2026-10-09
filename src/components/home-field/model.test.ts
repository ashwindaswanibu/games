import { describe, expect, it } from "vitest";
import { dayFraction, fieldLayout, fieldMetrics, fieldRows, spans, tileTargets } from "./model";

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

  it("grows the opened piece over the whole length", () => {
    const out = spans({ length: 1200, collapse: [0, 0, 0], print: 0, open: { index: 1, amount: 1 }, strip: 76, overshoot: 50 });
    expect(out[1]).toEqual([-50, 1250]);
    expect(width(out[0]!)).toBe(0);
    expect(width(out[2]!)).toBe(0);
  });
});

describe("fieldRows", () => {
  const tiles = (groups: string[]) => groups.map((group) => ({ group }));

  it("puts a category's games in one row when they fit", () => {
    expect(fieldRows(tiles(["movies", "movies", "movies"]), 4)).toEqual([[0, 1, 2]]);
  });

  it("starts a row for each category", () => {
    expect(fieldRows(tiles(["movies", "movies", "words", "words"]), 4)).toEqual([[0, 1], [2, 3]]);
  });

  it("wraps a big category into even rows", () => {
    expect(fieldRows(tiles(Array(6).fill("movies")), 4)).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(fieldRows(tiles(Array(7).fill("movies")), 4)).toEqual([[0, 1, 2, 3], [4, 5, 6]]);
    expect(fieldRows(tiles(Array(3).fill("movies")), 2)).toEqual([[0, 1], [2]]);
  });
});

describe("fieldLayout", () => {
  const metrics = { strip: 76, band: 72, lean: 0.083 };

  it("is one row across the field for today's three games", () => {
    const boxes = fieldLayout({ width: 1440, height: 840, rows: [[0, 1, 2]], collapse: [0, 0, 0], print: 0, open: null, metrics });
    expect(boxes.map((b) => b.y)).toEqual([[0, 840], [0, 840], [0, 840]]);
    expect(boxes.map((b) => width(b.x))).toEqual([480, 480, 480]);
  });

  it("gives rows height by their games still to play, and a finished row a band", () => {
    const rows = [[0, 1, 2], [3, 4, 5, 6]];
    const playing = fieldLayout({ width: 1440, height: 700, rows, collapse: [0, 0, 0, 0, 0, 0, 0], print: 0, open: null, metrics });
    expect(width(playing[0]!.y)).toBeCloseTo(300);
    expect(width(playing[3]!.y)).toBeCloseTo(400);
    const firstRowDone = fieldLayout({ width: 1440, height: 700, rows, collapse: [1, 1, 1, 0, 0, 0, 0], print: 0, open: null, metrics });
    expect(width(firstRowDone[0]!.y)).toBeCloseTo(72);
    expect(width(firstRowDone[3]!.y)).toBeCloseTo(628);
  });

  it("grows an opened tile over the whole field", () => {
    const boxes = fieldLayout({ width: 1440, height: 700, rows: [[0, 1], [2, 3]], collapse: [0, 0, 0, 0], print: 0, open: { index: 3, amount: 1 }, metrics });
    expect(boxes[3]!.x[0]).toBeLessThan(0);
    expect(boxes[3]!.x[1]).toBeGreaterThan(1440);
    expect(boxes[3]!.y[0]).toBeLessThan(0);
    expect(boxes[3]!.y[1]).toBeGreaterThan(700);
  });
});

describe("tileTargets and fieldMetrics", () => {
  it("collapses finished games and opens the print when all are done", () => {
    expect(tileTargets([{ state: "finished" }, { state: "playing" }])).toEqual({ collapse: [1, 0], print: 0 });
    expect(tileTargets([{ state: "finished" }, { state: "finished" }])).toEqual({ collapse: [1, 1], print: 1 });
  });

  it("holds two games a row on a phone and four on a laptop", () => {
    expect(fieldMetrics(390).perRow).toBe(2);
    expect(fieldMetrics(1440).perRow).toBe(4);
  });

  it("measures the New York day", () => {
    expect(dayFraction(Date.parse("2026-10-08T16:00:00Z"), "2026-10-08T04:00:00Z", "2026-10-09T04:00:00Z")).toBeCloseTo(0.5);
  });
});
