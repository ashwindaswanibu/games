import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addDays, parsePuzzleDate, type PuzzleDate } from "@/core/day";
import type { RngSeed } from "@/core/random";
import {
  clashes,
  describeExclusion,
  DIRECTOR_GAP_DAYS,
  exclusion,
  fallbackOrder,
  filmKey,
  MIN_SCORE,
  percentileAtOrBelow,
  pickFilm,
  planDays,
  REPEAT_GAP_DAYS,
  scoreFilms,
  SERIES_GAP_DAYS,
  TIERS,
  tierForDraw,
  tierOf,
  type DayAnswer,
  type FameRecord,
  type PickCandidate,
  type TierName,
} from "./picker";

/** A stand-in for `contentSeed`: a hash of the date (the real one also hashes the server's secret). */
const seedFor = (date: string): RngSeed => {
  const d = createHash("sha256").update(`picker-test\u0000${date}`).digest();
  return [d.readUInt32BE(0), d.readUInt32BE(4), d.readUInt32BE(8), d.readUInt32BE(12)];
};

const DAY0 = parsePuzzleDate("2026-10-11");
/** For the tests that pick thousands of days (the full suite runs test files in parallel). */
const SLOW = { timeout: 60_000 };
const day = (n: number): PuzzleDate => addDays(DAY0, n);
const days = (count: number, from = 0) => Array.from({ length: count }, (_, i) => day(from + i));

/** Titles that never look like one series (distinct single words), unless a test says otherwise. */
const film = (id: number, score: number, extra: Partial<PickCandidate> = {}): PickCandidate => ({
  id,
  title: `Picture${id}x`,
  year: 2000,
  directors: [`Director ${id}`],
  series: [],
  score,
  monochrome: null,
  ...extra,
});

const answer = (date: PuzzleDate, f: Pick<PickCandidate, "id" | "title" | "directors" | "series">): DayAnswer => ({
  date,
  filmId: f.id,
  title: f.title,
  directors: f.directors,
  series: f.series,
});

/**
 * A pool shaped like the real one (~130 Iconic, ~240 Well-known, ~140 Known, ~340 too obscure),
 * with directors shared by a few films each so the director rule bites.
 */
function realisticPool(): PickCandidate[] {
  const pool: PickCandidate[] = [];
  const add = (count: number, low: number, high: number) => {
    for (let i = 0; i < count; i++) {
      const id = pool.length + 1;
      pool.push(film(id, low + (i % (high - low + 1)), { directors: [`Director ${id % 300}`] }));
    }
  };
  add(130, 85, 100);
  add(240, 60, 84);
  add(140, 45, 59);
  add(340, 0, 44);
  return pool;
}

describe("tiers", () => {
  it("cuts scores at 85, 60 and 45", () => {
    expect([100, 85, 84, 60, 59, 45, 44, 0].map(tierOf)).toEqual(["iconic", "iconic", "well-known", "well-known", "known", "known", null, null]);
    expect(MIN_SCORE).toBe(45);
  });

  it("draws 25% Iconic, 55% Well-known, 20% Known", () => {
    expect(TIERS.reduce((sum, t) => sum + t.weight, 0)).toBeCloseTo(1, 10);
    expect([0, 0.2499, 0.25, 0.7999, 0.8, 0.9999].map(tierForDraw)).toEqual(["iconic", "iconic", "well-known", "well-known", "known", "known"]);
  });

  it("falls back to the nearest tier, the more popular one first", () => {
    expect(fallbackOrder("iconic")).toEqual(["iconic", "well-known", "known"]);
    expect(fallbackOrder("well-known")).toEqual(["well-known", "iconic", "known"]);
    expect(fallbackOrder("known")).toEqual(["known", "well-known", "iconic"]);
  });
});

describe("fame scores", () => {
  it("measures a percentile as the share at or below", () => {
    expect(percentileAtOrBelow([], 5)).toBe(0);
    expect(percentileAtOrBelow([1, 2, 2, 3], 0)).toBe(0);
    expect(percentileAtOrBelow([1, 2, 2, 3], 2)).toBe(75);
    expect(percentileAtOrBelow([1, 2, 2, 3], 2.5)).toBe(75);
    expect(percentileAtOrBelow([1, 2, 2, 3], 3)).toBe(100);
  });

  it("gives the best-known film 100 and tied films the same score", () => {
    const scores = scoreFilms([
      { id: 1, year: 2000, popularity: 10 },
      { id: 2, year: 2000, popularity: 20 },
      { id: 3, year: 2000, popularity: 20 },
      { id: 4, year: 2000, popularity: 40 },
    ]);
    expect(scores.get(4)).toEqual({ score: 100, overall: 100, era: 100, tier: "iconic" });
    expect(scores.get(2)!.score).toBe(scores.get(3)!.score);
    expect(scores.get(2)).toMatchObject({ overall: 75, era: 75, score: 75, tier: "well-known" });
    expect(scores.get(1)).toMatchObject({ score: 25, tier: null });
  });

  it("lifts a recent hit by 0.9 × its era percentile", () => {
    // 90 well-established older films, then a recent film that leads its (thin) era.
    const reference: FameRecord[] = Array.from({ length: 90 }, (_, i) => ({ id: i + 1, year: 1990, popularity: 50 + i }));
    reference.push({ id: 100, year: 2024, popularity: 30 }, { id: 101, year: 2023, popularity: 20 }, { id: 102, year: 2025, popularity: 10 });
    const recent = scoreFilms(reference).get(100)!;
    expect(recent.overall).toBeCloseTo((100 * 3) / 93, 1);
    expect(recent.era).toBe(100);
    expect(recent.score).toBe(90);
    expect(recent.tier).toBe("iconic");
  });

  it("counts films within 2 years either side as the era, and no further", () => {
    const reference: FameRecord[] = [
      { id: 1, year: 2000, popularity: 10 },
      { id: 2, year: 1998, popularity: 20 },
      { id: 3, year: 2002, popularity: 20 },
      { id: 4, year: 1997, popularity: 5 },
      { id: 5, year: 2003, popularity: 5 },
    ];
    // Era of 2000: ids 1–3 → 10 is the lowest of three.
    expect(scoreFilms(reference).get(1)!.era).toBeCloseTo(33.3, 1);
  });

  it("rounds the score before choosing the tier (84.6 is Iconic)", () => {
    const reference: FameRecord[] = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, year: 2000, popularity: i + 1 }));
    const s = scoreFilms(reference).get(846)!;
    expect(s.overall).toBe(84.6);
    expect(s.score).toBe(85);
    expect(s.tier).toBe("iconic");
    expect(scoreFilms(reference).get(844)!.tier).toBe("well-known");
  });

  it("leaves out films without a year or a usable popularity, without counting them", () => {
    const scores = scoreFilms([
      { id: 1, year: 2000, popularity: 10 },
      { id: 2, year: null, popularity: 99 },
      { id: 3, year: 2000, popularity: Number.NaN },
      { id: 4, year: 2000, popularity: 20 },
    ]);
    expect([...scores.keys()].sort()).toEqual([1, 4]);
    expect(scores.get(1)!.overall).toBe(50);
  });
});

describe("rules", () => {
  const dune = film(1, 90, { title: "Dune: Part Two", directors: ["Denis Villeneuve"] });
  const arrival = film(2, 80, { title: "Arrival", directors: ["  denis villeneuve "] });
  const spider = film(3, 88, { title: "Spider-Man: No Way Home", directors: ["Jon Watts"] });
  const amazing = film(4, 75, { title: "The Amazing Spider-Man 2", directors: ["Marc Webb"] });
  const anonymous = film(5, 70, { title: "Anonymous", directors: [] });

  it("refuses a film that answers another day within 365 days either side", () => {
    expect(clashes(dune, day(0), [answer(day(-364), dune)])).toEqual([{ rule: "repeat", date: day(-364), title: "Dune: Part Two" }]);
    expect(clashes(dune, day(0), [answer(day(364), dune)])).toHaveLength(1);
    expect(clashes(dune, day(0), [answer(day(-REPEAT_GAP_DAYS), dune)])).toEqual([]);
    expect(clashes(dune, day(0), [answer(day(REPEAT_GAP_DAYS), dune)])).toEqual([]);
  });

  it("takes a different repeat window when asked (barcode-levels' --allow-repeat aside)", () => {
    expect(clashes(dune, day(0), [answer(day(-400), dune)], { repeatGapDays: Infinity })).toHaveLength(1);
  });

  it("refuses a director with another answer within 30 days either side, ignoring case and spacing", () => {
    expect(clashes(arrival, day(0), [answer(day(-DIRECTOR_GAP_DAYS), dune)])).toEqual([
      { rule: "director", date: day(-30), title: "Dune: Part Two", directors: ["Denis Villeneuve"] },
    ]);
    expect(clashes(arrival, day(0), [answer(day(30), dune)])).toHaveLength(1);
    expect(clashes(arrival, day(0), [answer(day(-31), dune)])).toEqual([]);
    expect(clashes(arrival, day(0), [answer(day(31), dune)])).toEqual([]);
    expect(clashes(anonymous, day(0), [answer(day(1), { ...anonymous, id: 99, title: "Other" })])).toEqual([]);
  });

  it("refuses the same series within 30 days either side", () => {
    expect(clashes(amazing, day(0), [answer(day(-SERIES_GAP_DAYS), spider)])).toEqual([{ rule: "series", date: day(-30), title: "Spider-Man: No Way Home" }]);
    expect(clashes(amazing, day(0), [answer(day(30), spider)])).toHaveLength(1);
    expect(clashes(amazing, day(0), [answer(day(31), spider)])).toEqual([]);
    expect(clashes(film(6, 80, { title: "Dune" }), day(0), [answer(day(10), dune)])).toEqual([{ rule: "series", date: day(10), title: "Dune: Part Two" }]);
  });

  it("refuses Wikidata's series within 30 days even when the titles share no words", () => {
    const FAST = "Q1576873"; // Fast & Furious
    const fastFive = film(20, 80, { title: "Fast Five", series: [FAST] });
    const furious7 = film(21, 80, { title: "Furious 7", series: [FAST] });
    expect(clashes(furious7, day(0), [answer(day(-12), fastFive)])).toEqual([{ rule: "series", date: day(-12), title: "Fast Five" }]);
    expect(clashes(furious7, day(0), [answer(day(31), fastFive)])).toEqual([]);
    // Another series, or none: no clash.
    expect(clashes(furious7, day(0), [answer(day(3), film(22, 80, { title: "Fast Food Nation" }))])).toEqual([]);
    expect(clashes(furious7, day(0), [answer(day(3), film(23, 80, { title: "Skyfall", series: ["Q2484680"] }))])).toEqual([]);
  });

  it("ignores the answer stored on the day being picked, and lists clashes nearest first", () => {
    expect(clashes(dune, day(0), [answer(day(0), dune)])).toEqual([]);
    const found = clashes(film(7, 80, { title: "Dune", directors: ["Denis Villeneuve"] }), day(0), [answer(day(-20), arrival), answer(day(5), dune)]);
    expect(found.map((c) => [c.rule, c.date])).toEqual([
      ["director", day(5)],
      ["series", day(5)],
      ["director", day(-20)],
    ]);
  });

  it("never picks a film below 45 or known to be black and white; an unchecked film is allowed", () => {
    expect(exclusion(film(1, 44), day(0), [])).toEqual({ rule: "too-obscure", score: 44 });
    expect(exclusion(film(1, 45), day(0), [])).toBeNull();
    expect(exclusion(film(1, 90, { monochrome: true }), day(0), [])).toEqual({ rule: "black-and-white" });
    expect(exclusion(film(1, 90, { monochrome: null }), day(0), [])).toBeNull();
    expect(exclusion(film(1, 90, { monochrome: false }), day(0), [])).toBeNull();
  });

  it("explains each exclusion in words", () => {
    expect(describeExclusion({ rule: "too-obscure", score: 30 })).toBe("scores 30, below 45");
    expect(describeExclusion({ rule: "black-and-white" })).toBe("black and white");
    expect(describeExclusion({ rule: "repeat", date: day(0), title: "Dune" })).toBe("already the answer on 2026-10-11");
    expect(describeExclusion({ rule: "director", date: day(0), title: "Dune", directors: ["Denis Villeneuve"] })).toBe("Denis Villeneuve directed Dune (2026-10-11)");
    expect(describeExclusion({ rule: "series", date: day(0), title: "Dune" })).toBe("same series as Dune (2026-10-11)");
  });
});

describe("picking a day's film", () => {
  const pool = realisticPool();

  it("is deterministic, whatever the order of the inputs", () => {
    const answers = [answer(day(-3), pool[0]!), answer(day(-10), pool[200]!)];
    const first = pickFilm(day(0), pool, answers, seedFor(day(0)));
    expect(pickFilm(day(0), pool, answers, seedFor(day(0)))).toEqual(first);
    expect(pickFilm(day(0), [...pool].reverse(), [...answers].reverse(), seedFor(day(0)))).toEqual(first);
  });

  it("depends on the day's seed", () => {
    const films = new Set(days(60).map((d) => pickFilm(d, pool, [], seedFor(d)).film!.id));
    expect(films.size).toBeGreaterThan(50);
  });

  it("takes the film from the drawn tier and only ever an eligible one", () => {
    const answers = days(40, -40).map((d, i) => answer(d, pool[i * 3]!));
    for (const d of days(100)) {
      const pick = pickFilm(d, pool, answers, seedFor(d));
      expect(pick.tier).toBe(pick.drawn);
      expect(tierOf(pick.film!.score)).toBe(pick.tier);
      expect(exclusion(pick.film!, d, answers)).toBeNull();
      expect(pick.why).toMatch(/draw, 1 of \d+ eligible$/);
    }
  });

  it("falls back to the nearest tier when the drawn one is exhausted", () => {
    const onlyKnown = pool.filter((f) => tierOf(f.score) === "known");
    const onlyIconic = pool.filter((f) => tierOf(f.score) === "iconic");
    const drawsWellKnown = days(200).find((d) => pickFilm(d, pool, [], seedFor(d)).drawn === "well-known")!;
    const mixed = pickFilm(drawsWellKnown, [...onlyKnown, ...onlyIconic], [], seedFor(drawsWellKnown));
    expect(mixed.tier).toBe("iconic");
    expect(mixed.why).toMatch(/^Well-known draw, none eligible → Iconic \(fallback\), 1 of 130 eligible$/);
    const known = pickFilm(drawsWellKnown, onlyKnown, [], seedFor(drawsWellKnown));
    expect(known.tier).toBe("known");
    expect(known.eligible).toEqual({ iconic: 0, "well-known": 0, known: 140 });
  });

  it("gives no film, rather than breaking a rule, when every tier is exhausted", () => {
    const tiny = [film(1, 90), film(2, 70)];
    const pick = pickFilm(day(0), tiny, [answer(day(-1), tiny[0]!), answer(day(-2), tiny[1]!)], seedFor(day(0)));
    expect(pick.film).toBeNull();
    expect(pick.tier).toBeNull();
    expect(pick.why).toMatch(/no eligible film in any tier/);
    expect(pickFilm(day(0), [], [], seedFor(day(0))).film).toBeNull();
  });

  it("only changes a day's pick to a film that joins the pool", SLOW, () => {
    // Five films a tier, so the newcomer wins a fair share of Iconic days.
    const small = [...Array.from({ length: 5 }, (_, i) => film(i + 1, 90)), ...Array.from({ length: 5 }, (_, i) => film(i + 6, 70)), ...Array.from({ length: 5 }, (_, i) => film(i + 11, 50))];
    const newcomer = film(9999, 90);
    let changed = 0;
    for (const d of days(300)) {
      const before = pickFilm(d, small, [], seedFor(d)).film!.id;
      const after = pickFilm(d, [...small, newcomer], [], seedFor(d)).film!.id;
      if (after !== before) {
        changed++;
        expect(after).toBe(9999);
      }
      // Removing a film that wasn't picked never changes the pick either.
      const other = small.find((f) => f.id !== before)!;
      expect(pickFilm(d, small.filter((f) => f !== other), [], seedFor(d)).film!.id).toBe(before);
    }
    expect(changed).toBeGreaterThan(3);
  });

  it("draws the tiers 25 / 55 / 20 over many days", SLOW, () => {
    const counts: Record<TierName, number> = { iconic: 0, "well-known": 0, known: 0 };
    const n = 6000;
    for (const d of days(n)) counts[pickFilm(d, pool, [], seedFor(d)).drawn]++;
    expect(counts.iconic / n).toBeGreaterThan(0.23);
    expect(counts.iconic / n).toBeLessThan(0.27);
    expect(counts["well-known"] / n).toBeGreaterThan(0.53);
    expect(counts["well-known"] / n).toBeLessThan(0.57);
    expect(counts.known / n).toBeGreaterThan(0.18);
    expect(counts.known / n).toBeLessThan(0.22);
  });

  it("chooses evenly within a tier", SLOW, () => {
    const ten = Array.from({ length: 10 }, (_, i) => film(i + 1, 90));
    const counts = new Map<number, number>();
    const n = 5000;
    for (const d of days(n)) {
      const id = pickFilm(d, ten, [], seedFor(d)).film!.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // Each film ~500 times; a chi-square of 10 bins stays far below 40 for a fair choice.
    const chi = [...counts.values()].reduce((sum, c) => sum + (c - n / 10) ** 2 / (n / 10), 0);
    expect(counts.size).toBe(10);
    expect(chi).toBeLessThan(40);
  });

  it("keys films independently of one another", () => {
    const seed = seedFor(day(0));
    const keys = Array.from({ length: 1000 }, (_, i) => filmKey(seed, i + 1));
    expect(new Set(keys).size).toBe(1000);
    expect(keys.every((k) => k >= 0 && k < 1)).toBe(true);
    const mean = keys.reduce((a, b) => a + b, 0) / keys.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});

describe("planning days", () => {
  const pool = realisticPool();

  it("keeps stored days as they are and counts them for the rules", () => {
    const stored = pool[0]!;
    const storedNeighbour = film(5000, 90, { title: "Dune: Part Two", directors: ["Denis Villeneuve"] });
    const villeneuve = film(5001, 90, { title: "Arrival", directors: ["Denis Villeneuve"] });
    const dune = film(5002, 90, { title: "Dune", directors: ["Someone Else"] });
    const candidates = [...pool, villeneuve, dune];
    const answers = [answer(day(5), stored), answer(day(-5), storedNeighbour)];
    const plan = planDays(days(60), candidates, answers, seedFor);
    expect(plan[5]).toEqual({ date: day(5), kind: "stored", answer: answers[0] });
    const picked = plan.flatMap((p) => (p.kind === "picked" ? [p.pick.film.id] : []));
    expect(picked).toHaveLength(59);
    expect(picked).not.toContain(stored.id);
    // Arrival and Dune can come only once the Dune: Part Two day is 31 days away.
    plan.forEach((p, i) => {
      if (p.kind === "picked" && (p.pick.film.id === villeneuve.id || p.pick.film.id === dune.id)) expect(i + 5).toBeGreaterThan(30);
    });
  });

  it("obeys every rule across a year, within itself and against stored days", SLOW, () => {
    const stored = [answer(day(-3), pool[1]!), answer(day(400), pool[2]!)];
    const plan = planDays(days(366), pool, stored, seedFor);
    const all = [...stored, ...plan.flatMap((p) => (p.kind === "picked" ? [answer(p.date, p.pick.film)] : []))];
    expect(plan.every((p) => p.kind === "picked")).toBe(true);
    for (const a of all) {
      const f = pool.find((x) => x.id === a.filmId)!;
      expect(clashes(f, a.date, all)).toEqual([]);
    }
    // The mix holds over a year: rarely a fallback, shares near the targets.
    const share = (name: TierName) => plan.filter((p) => p.kind === "picked" && p.pick.tier === name).length / plan.length;
    expect(share("iconic")).toBeGreaterThan(0.19);
    expect(share("iconic")).toBeLessThan(0.31);
    expect(share("well-known")).toBeGreaterThan(0.49);
    expect(share("well-known")).toBeLessThan(0.61);
    expect(share("known")).toBeGreaterThan(0.14);
    expect(share("known")).toBeLessThan(0.26);
  });

  it("reproduces itself: planning a later stretch after storing the first gives the same days", () => {
    const whole = planDays(days(40), pool, [], seedFor);
    const firstHalf = whole.slice(0, 20).flatMap((p) => (p.kind === "picked" ? [answer(p.date, p.pick.film)] : []));
    expect(firstHalf).toHaveLength(20);
    const secondHalf = planDays(days(20, 20), pool, firstHalf, seedFor);
    expect(secondHalf).toEqual(whole.slice(20));
  });

  it("leaves a day without a film when the pool runs out, and says so", () => {
    const tiny = [film(1, 90), film(2, 70), film(3, 50)];
    const plan = planDays(days(5), tiny, [], seedFor);
    expect(plan.map((p) => p.kind)).toEqual(["picked", "picked", "picked", "none", "none"]);
    expect(new Set(plan.flatMap((p) => (p.kind === "picked" ? [p.pick.film.id] : []))).size).toBe(3);
  });

  it("needs the dates in order, each once", () => {
    expect(() => planDays([day(1), day(0)], pool, [], seedFor)).toThrow(/in order/);
    expect(() => planDays([day(1), day(1)], pool, [], seedFor)).toThrow(/in order/);
  });
});
