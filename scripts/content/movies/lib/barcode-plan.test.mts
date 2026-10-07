import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addDays, parsePuzzleDate, type PuzzleDate } from "@/core/day";
import type { RngSeed } from "@/core/random";
import { pickFilm, planDays } from "@/games/fade-to-color/picker";
import { FilmRefusedError, type BarcodeDayOptions, type BarcodeDayResult } from "./barcode-day.mjs";
import { formatPlan, MAX_REFUSALS_PER_DAY, pickAndRenderDay, summarizePlan } from "./barcode-plan.mjs";
import { buildPickerInputs, type CatalogFilm } from "./film-picker.mjs";
import type { ContentDb } from "./pipeline.mjs";

const seedFor = (date: string): RngSeed => {
  const d = createHash("sha256").update(`plan-test\u0000${date}`).digest();
  return [d.readUInt32BE(0), d.readUInt32BE(4), d.readUInt32BE(8), d.readUInt32BE(12)];
};
const DAY0 = parsePuzzleDate("2026-10-11");
const day = (n: number): PuzzleDate => addDays(DAY0, n);

// Sixty films with galleries (popularity 1…60, so pool scores run evenly from 2 to 100), each by
// its own director.
const films: CatalogFilm[] = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, title: `Picture${i + 1}x`, year: 2000, directors: [`Director ${i + 1}`], popularity: i + 1 }));
const directory = films.map((f) => ({ title: f.title, year: 2000, tags: [], url: `https://movie-screencaps.com/picture${f.id}x-2000/` }));
const inputs = buildPickerInputs(films, directory, () => undefined);
const db = {} as ContentDb;

/** A renderer that refuses the films in `refuse` (by id) and stores everything else. */
function fakeRender(refuse: Map<number, FilmRefusedError | Error>, calls: number[]) {
  return async (_db: ContentDb, options: BarcodeDayOptions): Promise<BarcodeDayResult> => {
    calls.push(options.filmId);
    const error = refuse.get(options.filmId);
    if (error) throw error;
    const f = films[options.filmId - 1]!;
    return { date: options.date, film: { id: f.id, title: f.title, year: f.year }, galleryUrl: options.galleryUrl!, stored: true, replaced: null };
  };
}

describe("picking and rendering a day", () => {
  const quiet = () => {};

  it("renders the picked film from its gallery", async () => {
    const calls: number[] = [];
    const expected = pickFilm(day(0), inputs.candidates, [], seedFor(day(0))).film!;
    const done = await pickAndRenderDay(db, inputs, day(0), { answers: [], excluded: new Set(), settings: {}, log: quiet, seedFor, render: fakeRender(new Map(), calls) });
    expect(done.pick.film.id).toBe(expected.id);
    expect(done.result.galleryUrl).toBe(`https://movie-screencaps.com/picture${expected.id}x-2000/`);
    expect(done.refused).toEqual([]);
    expect(calls).toEqual([expected.id]);
  });

  it("picks again without a film the renderer finds black and white or too short", async () => {
    const first = pickFilm(day(0), inputs.candidates, [], seedFor(day(0))).film!;
    const second = pickFilm(day(0), inputs.candidates.filter((c) => c.id !== first.id), [], seedFor(day(0))).film!;
    const refuse = new Map<number, Error>([
      [first.id, new FilmRefusedError("black-and-white", "grey")],
      [second.id, new FilmRefusedError("too-short", "640 caps")],
    ]);
    const calls: number[] = [];
    const excluded = new Set<number>();
    const done = await pickAndRenderDay(db, inputs, day(0), { answers: [], excluded, settings: {}, log: quiet, seedFor, render: fakeRender(refuse, calls) });
    expect(calls.slice(0, 2)).toEqual([first.id, second.id]);
    expect(done.refused.map((r) => [r.film.id, r.rule])).toEqual([
      [first.id, "black-and-white"],
      [second.id, "too-short"],
    ]);
    expect(excluded).toEqual(new Set([first.id, second.id]));
    expect(done.pick.film.id).not.toBe(first.id);
    expect(done.pick.film.id).not.toBe(second.id);
  });

  it("stops on any other refusal or failure, rather than picking around it", async () => {
    const first = pickFilm(day(0), inputs.candidates, [], seedFor(day(0))).film!;
    for (const error of [new FilmRefusedError("director", "same director"), new Error("network down")]) {
      const run = pickAndRenderDay(db, inputs, day(0), { answers: [], excluded: new Set(), settings: {}, log: quiet, seedFor, render: fakeRender(new Map([[first.id, error]]), []) });
      await expect(run).rejects.toBe(error);
    }
  });

  it("gives up on a day after too many refusals in a row", async () => {
    const greyAll = new Map(inputs.candidates.map((c) => [c.id, new FilmRefusedError("black-and-white", "grey")]));
    const calls: number[] = [];
    const run = pickAndRenderDay(db, inputs, day(0), { answers: [], excluded: new Set(), settings: {}, log: quiet, seedFor, render: fakeRender(greyAll, calls) });
    await expect(run).rejects.toThrow(/films in a row were refused/);
    expect(calls).toHaveLength(MAX_REFUSALS_PER_DAY + 1);
  });
});

describe("printing a plan", () => {
  it("shows stored days as kept, picked days with tier, score and why, and days without a film", () => {
    const stored = { date: day(1), filmId: 60, title: "Picture60x", directors: ["Director 60"] };
    const tiny = inputs.candidates.filter((c) => c.id >= 58);
    const plan = planDays([day(0), day(1), day(2), day(3)], tiny, [stored], seedFor);
    const lines = formatPlan(plan, inputs);
    expect(lines[0]).toMatch(/^date\s+film\s+year\s+tier\s+score\s+why$/);
    expect(lines[2]).toMatch(/^2026-10-12  Picture60x\s+2000  Iconic\s+100  stored puzzle, kept as it is$/);
    expect(lines[1]).toMatch(/^2026-10-11  Picture5[89]x\s+2000  Iconic\s+9[78]  .+ draw.+1 of \d eligible$/);
    expect(lines[4]).toMatch(/^2026-10-14  \(no film\).+no eligible film in any tier$/);

    const summary = summarizePlan(plan, { ...inputs, answers: [stored], catalogSize: 60, directory: { entries: 60, fetchedAt: new Date("2026-10-07T00:00:00Z"), fromCache: true } });
    expect(summary.find((l) => l.startsWith("pool:"))).toMatch(/60 catalog films with a gallery/);
    expect(summary.find((l) => l.startsWith("tiers:"))).toMatch(/^tiers: Iconic 2 \(100%, target 25%\)/);
    expect(summary.find((l) => l.startsWith("no film:"))).toBe("no film: 1 day (every tier exhausted under the rules)");
    expect(summary.find((l) => l.startsWith("closest repeat:"))).toBe("closest repeat: none");
  });
});
