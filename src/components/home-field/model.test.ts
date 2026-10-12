import { describe, expect, it } from "vitest";
import { choosePlan, dayFraction, dayLine, fieldHeight, fieldLayout, fieldMetrics, fieldPlan, PLATE, rightSeamAt, rowClip, seamAt, spans, spineAngle, tileTargets } from "./model";

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

  it("lets small categories share a row, each plate in half a slot", () => {
    const plan = fieldPlan(tiles(["movies", "movies", "movies", "words", "words", "geography", "chess"]), 4);
    expect(plan.rows).toEqual([[7, 0, 1, 2], [8, 3, 4, 9, 5], [10, 6]]);
    expect(plan.slots.slice(7)).toEqual([1, PLATE, PLATE, 3]);
  });

  it("fits two categories' plates beside their games when half slots allow", () => {
    // Today: two Movies games and Lexicon, rows of four: one row, the plates half a game each.
    const plan = fieldPlan(tiles(["movies", "movies", "words"]), 4);
    expect(plan.rows).toEqual([[3, 0, 1, 4, 2]]);
    expect(plan.slots).toEqual([1, 1, 1, PLATE, PLATE]);
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
    // Rows of three: [Movies plate (its half slot and the half left), game, game], [Words plate, game].
    const boxes = fieldLayout({ width: 1440, height: 700, plan: plan(["movies", "movies", "words"], 3), collapse: [1, 1, 0], print: 0, open: null, metrics });
    expect(width(boxes[0]!.y)).toBeCloseTo(72);
    expect(width(boxes[2]!.y)).toBeCloseTo(628);
    // The band is shared by slots: the plate's one and each game's one, a third each.
    expect(width(boxes[3]!.x)).toBeCloseTo(480);
    expect(width(boxes[0]!.x)).toBeCloseTo(480);
    // Below it, the Words plate takes the two slots its game leaves.
    expect(width(boxes[4]!.x)).toBeCloseTo(960);
  });

  it("gives today's games a quarter more width on a laptop: 180/360/360/180/360", () => {
    const p = choosePlan(groups(["movies", "movies", "words"]), { width: 1440, height: 844 }, fieldMetrics(1440));
    const boxes = fieldLayout({ width: 1440, height: 844, plan: p, collapse: [0, 0, 0], print: 0, open: null, metrics });
    expect(p.rows[0]!.map((i) => Math.round(width(boxes[i]!.x)))).toEqual([180, 360, 360, 180, 360]);
    // Every game the same width, whatever its category.
    expect(new Set(boxes.slice(0, 3).map((b) => Math.round(width(b.x)))).size).toBe(1);
    // A 1280 screen: rows of four still, so 160/320.
    const small = choosePlan(groups(["movies", "movies", "words"]), { width: 1280, height: 744 }, fieldMetrics(1280));
    const narrow = fieldLayout({ width: 1280, height: 744, plan: small, collapse: [0, 0, 0], print: 0, open: null, metrics });
    expect(small.rows[0]!.map((i) => Math.round(width(narrow[i]!.x)))).toEqual([160, 320, 320, 160, 320]);
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

  it("holds one game a row on a phone, each category's plate a band above its games", () => {
    const plan = choosePlan(groups(["movies", "movies", "words"]), { width: 390, height: 788 }, fieldMetrics(390));
    expect(plan.rows).toEqual([[3], [0], [1], [4], [2]]);
    expect(plan.bands).toEqual([true, false, false, true, false]);
  });

  it("fills a phone exactly: two 64px bands and three 220px rows under the header", () => {
    const metrics = fieldMetrics(390);
    const plan = choosePlan(groups(["movies", "movies", "words"]), { width: 390, height: 788 }, metrics);
    const height = fieldHeight(844 - 56, plan, metrics);
    expect(height).toBe(788);
    const boxes = fieldLayout({ width: 390, height, plan, collapse: [0, 0, 0], print: 0, open: null, metrics });
    expect(boxes.slice(0, 3).map((b) => width(b.y))).toEqual([220, 220, 220]);
    expect(boxes.slice(3).map((b) => width(b.y))).toEqual([64, 64]);
    expect(boxes.every((b) => b.x[0] === 0 && b.x[1] === 390)).toBe(true);
  });

  it("scrolls a phone with more than four games, keeping rows 220px", () => {
    const metrics = fieldMetrics(390);
    const plan = choosePlan(groups(["movies", "movies", "words", "geography", "geography"]), { width: 390, height: 788 }, metrics);
    const height = fieldHeight(788, plan, metrics);
    expect(height).toBe(3 * 64 + 5 * 220);
    const boxes = fieldLayout({ width: 390, height, plan, collapse: [0, 0, 0, 0, 0], print: 0, open: null, metrics });
    expect(boxes.slice(0, 5).map((b) => Math.round(width(b.y)))).toEqual([220, 220, 220, 220, 220]);
  });

  it("chooses the row length that leaves plates least to fill", () => {
    const laptop = { width: 1440, height: 844 };
    // Two Movies games and Lexicon: one row of four slots (each plate half a slot).
    expect(choosePlan(groups(["movies", "movies", "words"]), laptop, fieldMetrics(1440)).rows).toEqual([[3, 0, 1, 4, 2]]);
    // Three and one: one row of five slots.
    expect(choosePlan(groups(["movies", "movies", "movies", "words"]), laptop, fieldMetrics(1440)).rows).toEqual([[4, 0, 1, 2, 5, 3]]);
    // Seven in four categories: two rows of five.
    expect(choosePlan(groups(["movies", "movies", "movies", "words", "words", "geography", "geography"]), laptop, fieldMetrics(1440)).rows).toEqual([
      [7, 0, 1, 2],
      [8, 3, 4, 9, 5, 6],
    ]);
  });

  it("prefers rows that fit the screen", () => {
    // Rows of four would leave plates less to fill, but need four rows (a band and three) where 844px holds three.
    const groupsOf = groups(["movies", "words", "words", "words", "words", "geography"]);
    const metrics = fieldMetrics(1440);
    const plan = choosePlan(groupsOf, { width: 1440, height: 844 }, metrics);
    expect(plan.rows).toEqual([[6, 0], [7, 1, 2, 3, 4], [8, 5]]);
    expect(fieldHeight(0, plan, metrics)).toBeLessThanOrEqual(844);
    expect(fieldHeight(0, fieldPlan(groupsOf, 4), metrics)).toBeGreaterThan(844);
  });

  it("says what's left, then the points, then the countdown", () => {
    const tiles = (...states: ("unplayed" | "playing" | "finished")[]) => states.map((state) => ({ state }));
    expect(dayLine(tiles("unplayed", "playing", "unplayed"), 0, "05:00:00", false)).toBe("3 to play");
    expect(dayLine(tiles("finished", "playing", "unplayed"), 80, "05:00:00", false)).toBe("2 to play · 80 points");
    expect(dayLine(tiles("finished", "finished", "finished"), 230, "05:00:00", false)).toBe("All played · 230 · Next day in 05:00:00");
    expect(dayLine(tiles("finished", "playing", "unplayed"), 80, "05:00:00", true)).toBe("2 to play");
    expect(dayLine(tiles("finished", "finished", "finished"), 230, "05:00:00", true)).toBe("All played · 05:00:00");
  });

  it("measures the New York day", () => {
    expect(dayFraction(Date.parse("2026-10-08T16:00:00Z"), "2026-10-08T04:00:00Z", "2026-10-09T04:00:00Z")).toBeCloseTo(0.5);
  });
});

describe("seams and cuts", () => {
  const lean = 0.083;

  it("stands a plate's name parallel to its seam", () => {
    // A quarter turn back, less the seams' lean: about -85.26°.
    expect(spineAngle(lean)).toBeCloseTo(-85.256, 2);
    const box = { x: [180, 540] as [number, number], y: [0, 844] as [number, number], row: 0, col: 1, cols: 5 };
    // Both seams of a piece lean alike: its width holds at every height.
    for (const y of [0, 300, 844]) expect(rightSeamAt(box, lean, y) - seamAt(box, lean, y)).toBeCloseTo(360);
    // The last piece's right edge is the screen's.
    expect(rightSeamAt({ ...box, col: 4 }, lean, 0)).toBe(540);
  });

  it("cuts a phone's rows along one shared line", () => {
    const metrics = fieldMetrics(390);
    const plan = choosePlan(groups(["movies", "movies", "words"]), { width: 390, height: 788 }, metrics);
    const boxes = fieldLayout({ width: 390, height: 788, plan, collapse: [0, 0, 0], print: 0, open: null, metrics });
    const points = (clip: string) => [...clip.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    const rows = plan.rows.map((row, r) => points(rowClip(boxes[row[0]!]!, metrics.lean, 390, r === 0, r === plan.rows.length - 1)));
    // A cut's line through its two points, at x.
    const at = (a: readonly [number, number], b: readonly [number, number], x: number) => a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    for (let r = 0; r + 1 < rows.length; r++) {
      const [, , br, bl] = rows[r]!;
      const [tl, tr] = rows[r + 1]!;
      for (const x of [0, 390]) expect(at(bl!, br!, x)).toBeCloseTo(at(tl!, tr!, x));
      // It rises 32px across the screen, low on the left.
      expect(at(bl!, br!, 0) - at(bl!, br!, 390)).toBeCloseTo(lean * 390);
    }
    // The field's first top and last bottom are straight.
    expect(rows[0]![0]![1]).toBe(rows[0]![1]![1]);
    expect(rows.at(-1)![2]![1]).toBe(rows.at(-1)![3]![1]);
  });
});
