import { describe, expect, it } from "vitest";
import {
  ARRIVED_KEY,
  choosePlan,
  dayFraction,
  dayLine,
  entrance,
  entranceScript,
  fieldHeight,
  fieldLayout,
  fieldMetrics,
  fieldPlan,
  HOLD,
  isMobileAgent,
  LAPTOP,
  longestLine,
  PHONE,
  PLATE,
  printLines,
  rightSeamAt,
  rowClip,
  rowCut,
  SCALE_DEPTH,
  seamAt,
  SHOWN_KEY,
  spans,
  spineAngle,
  stripMiddle,
  tileTargets,
  viewportCookie,
  viewportFor,
  type HomeShown,
  type WindowSize,
} from "./model";

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
    expect(dayLine(tiles("unplayed", "playing", "unplayed"), 0, 300, "05:00:00", false)).toBe("3 to play");
    expect(dayLine(tiles("finished", "playing", "unplayed"), 80, 300, "05:00:00", false)).toBe("2 to play · 80 points");
    expect(dayLine(tiles("finished", "finished", "finished"), 250, 300, "01:34:12", false)).toBe("All played · 250 of 300 · Next day in 01:34:12");
    expect(dayLine(tiles("finished", "playing", "unplayed"), 80, 300, "05:00:00", true)).toBe("2 to play");
    expect(dayLine(tiles("finished", "finished", "finished"), 230, 300, "05:00:00", true)).toBe("All played · 05:00:00");
  });

  it("measures a title's longest line, on one line or balanced over two", () => {
    expect(longestLine("Dune: Part Two", 1)).toBe(14);
    expect(longestLine("Dune: Part Two", 2)).toBe(8);
    expect(longestLine("Anora", 2)).toBe(5);
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

describe("finished games", () => {
  const lean = 0.083;

  it("runs a strip's centre line parallel to its seams, halfway across", () => {
    const box = { x: [180, 312] as [number, number], y: [0, 844] as [number, number], row: 0, col: 1, cols: 5 };
    for (const y of [0, 422, 844]) expect(stripMiddle(box, lean, y) - seamAt(box, lean, y)).toBeCloseTo(66);
    expect(stripMiddle(box, lean, 422)).toBeCloseTo(246);
    // Beside the screen's edge it stays halfway between that straight edge and the seam.
    const last = { ...box, x: [1308, 1440] as [number, number], col: 4 };
    for (const y of [0, 844]) expect(stripMiddle(last, lean, y)).toBeCloseTo((seamAt(last, lean, y) + 1440) / 2);
  });

  it("sets every poster's title on one baseline across its row, its lines under it shared too", () => {
    for (const [width, height] of [
      [1440, 844],
      [1280, 664],
    ]) {
      const metrics = fieldMetrics(width);
      const plan = choosePlan(groups(["movies", "movies", "words"]), { width, height }, metrics);
      const boxes = fieldLayout({ width, height, plan, collapse: [1, 1, 1], print: 1, open: null, metrics });
      const lines = boxes.slice(0, 3).map((b) => printLines(b, false, 0));
      expect(new Set(lines.map((l) => JSON.stringify(l))).size).toBe(1);
      const { base, note, line, scale } = lines[0]!;
      // Room above for two lines of a 64px title and the game's object; the stack under it in order, on the field.
      expect(base).toBeGreaterThanOrEqual(height * 0.6);
      expect(base < note && note < line && line < scale).toBe(true);
      expect(scale + SCALE_DEPTH).toBeLessThanOrEqual(height);
    }
  });

  it("keeps a phone poster's lines clear of its row's cuts", () => {
    const metrics = fieldMetrics(390);
    const plan = choosePlan(groups(["movies", "movies", "words"]), { width: 390, height: 788 }, metrics);
    const height = fieldHeight(788, plan, metrics);
    const boxes = fieldLayout({ width: 390, height, plan, collapse: [1, 1, 1], print: 1, open: null, metrics });
    const cut = (metrics.lean * 390) / 2;
    for (const b of boxes.slice(0, 3)) {
      const { base, scale } = printLines(b, true, cut);
      // Friends' names stay above the bottom cut where it rises highest (the screen's right edge)...
      expect(scale + SCALE_DEPTH).toBeLessThanOrEqual(rowCut(b.y[1], metrics.lean, 390, 390));
      // ...and a title and its object keep 80px under the top cut where it falls lowest (the left edge).
      expect(base - rowCut(b.y[0], metrics.lean, 390, 0)).toBeGreaterThanOrEqual(80);
    }
  });
});

describe("the first frame", () => {
  it("lays the field out for the window the cookie last said, or a phone's or a laptop's", () => {
    expect(viewportFor("390x664", false)).toEqual({ width: 390, height: 664 });
    expect(viewportFor("2560x1307", true)).toEqual({ width: 2560, height: 1307 });
    expect(viewportFor(viewportCookie({ width: 1512, height: 823 }).split(";")[0]!.split("=")[1], true)).toEqual({ width: 1512, height: 823 });
    for (const garbled of [undefined, "", "390", "390x", "0x844", "390x844x2", "99999x844", "390X844", " 390x844", "abc"]) {
      expect(viewportFor(garbled, true)).toEqual(PHONE);
      expect(viewportFor(garbled, false)).toEqual(LAPTOP);
    }
  });

  it("writes a year-long cookie for the whole site", () => {
    expect(viewportCookie({ width: 390, height: 844 })).toBe("vw=390x844; Path=/; Max-Age=31536000; SameSite=Lax");
  });

  it("tells a phone by its client hint or its user agent, and not a tablet or a laptop", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const android = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    const tablet = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    const firefox = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    expect([iphone, android, firefox].map((ua) => isMobileAgent(null, ua))).toEqual([true, true, true]);
    expect(isMobileAgent("?1", tablet)).toBe(true);
    expect([tablet, mac].map((ua) => isMobileAgent("?0", ua))).toEqual([false, false]);
    expect(isMobileAgent(null, null)).toBe(false);
  });

  const date = "2026-10-13";
  const tiles = [
    { id: "film", state: "finished" as const },
    { id: "thread", state: "unplayed" as const },
    { id: "book", state: "playing" as const },
  ];

  it("arrives on the day's first visit, and only then", () => {
    expect(entrance(tiles, date, { arrived: null, shown: null }, false)).toEqual({ kind: "arrival" });
    expect(entrance(tiles, date, { arrived: "2026-10-12", shown: null }, false)).toEqual({ kind: "arrival" });
    expect(entrance(tiles, date, { arrived: date, shown: null }, false)).toEqual({ kind: "still" });
  });

  it("shrinks a game this tab showed unfinished today into its strip, before any arrival", () => {
    const shown = (states: Record<string, string>, day = date): HomeShown => ({ date: day, states });
    expect(entrance(tiles, date, { arrived: date, shown: shown({ film: "playing", thread: "unplayed" }) }, false)).toEqual({ kind: "back", index: 0 });
    expect(entrance(tiles, date, { arrived: null, shown: shown({ film: "unplayed" }) }, false)).toEqual({ kind: "back", index: 0 });
    // Already finished when this tab last showed it, unknown to this tab, or shown another day: no.
    expect(entrance(tiles, date, { arrived: date, shown: shown({ film: "finished" }) }, false)).toEqual({ kind: "still" });
    expect(entrance(tiles, date, { arrived: date, shown: shown({ thread: "unplayed" }) }, false)).toEqual({ kind: "still" });
    expect(entrance(tiles, date, { arrived: date, shown: shown({ film: "playing" }, "2026-10-12") }, false)).toEqual({ kind: "still" });
  });

  it("is simply there with reduced motion", () => {
    expect(entrance(tiles, date, { arrived: null, shown: { date, states: { film: "playing" } } }, true)).toEqual({ kind: "still" });
  });

  /** Runs the page's script against a browser's memory and window: whether it held the field. */
  function holds(script: string, env: { local: Record<string, string> | "blocked"; session: Record<string, string> | "blocked"; reduced: boolean; window: WindowSize }): boolean {
    const set = new Map<string, string>();
    const browser = {};
    for (const [name, data] of [["localStorage", env.local], ["sessionStorage", env.session]] as const) {
      Object.defineProperty(browser, name, {
        get() {
          // As a browser that refuses site data does.
          if (data === "blocked") throw new Error("SecurityError");
          return { getItem: (key: string) => data[key] ?? null };
        },
      });
    }
    const root = { setAttribute: (name: string, value: string) => set.set(name, value) };
    const matchMedia = (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" && env.reduced });
    new Function("window", "document", "matchMedia", "innerWidth", "innerHeight", script)(browser, { currentScript: { parentNode: root } }, matchMedia, env.window.width, env.window.height);
    return set.has(HOLD);
  }

  it("holds the field in the page's script exactly when it will move as it comes on, or was laid out for another window", () => {
    const script = entranceScript(tiles, date, PHONE);
    const arrivals = [null, date, "2026-10-12"];
    const shows: (HomeShown | null)[] = [null, { date, states: { film: "playing", thread: "unplayed" } }, { date, states: { film: "finished" } }, { date: "2026-10-12", states: { film: "playing" } }, { date, states: { thread: "unplayed" } }];
    let cases = 0;
    for (const arrived of arrivals) {
      for (const shown of shows) {
        for (const reduced of [false, true]) {
          const local: Record<string, string> = arrived === null ? {} : { [ARRIVED_KEY]: JSON.stringify(arrived) };
          const session: Record<string, string> = shown === null ? {} : { [SHOWN_KEY]: JSON.stringify(shown) };
          const moves = entrance(tiles, date, { arrived, shown }, reduced).kind !== "still";
          expect(holds(script, { local, session, reduced, window: PHONE })).toBe(moves);
          expect(holds(script, { local, session, reduced, window: { width: 390, height: 664 } })).toBe(true);
          cases++;
        }
      }
    }
    expect(cases).toBe(30);
    // Storage the browser refuses reads as nothing remembered, as the field reads it: the day arrives.
    expect(holds(script, { local: "blocked", session: "blocked", reduced: false, window: PHONE })).toBe(true);
    expect(holds(script, { local: "blocked", session: "blocked", reduced: true, window: PHONE })).toBe(false);
  });

  it("keeps every value inside its script", () => {
    const script = entranceScript([{ id: "</script><script>alert(1)</script>", state: "finished" }], date, LAPTOP);
    expect(script).not.toContain("</script>");
    expect(script).toContain('"1440x900"');
  });
});
