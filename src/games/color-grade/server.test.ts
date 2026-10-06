import { describe, expect, it } from "vitest";
import { FILM_NOT_FOUND } from "@/games/_movies/server";
import { createFakeGameServices, film } from "@/server/game-services.fake";
import { colorGrade, type Puzzle, type Solution } from "./logic";
import { colorGradeServer } from "./server";

const asset = (n: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, width: 1280, height: 720 });
const puzzle: Puzzle = {
  fixture: true,
  palette: ["#101820", "#d07a2c", "#efe4cf", "#2b7a6c", "#8c1c24"].map((hex, i) => ({ hex, share: [0.4, 0.25, 0.15, 0.12, 0.08][i] })),
};
const solution: Solution = {
  answer: { id: 1, title: "Heat", year: 1995, genres: ["Crime"], directors: ["Michael Mann"] },
  neutral: asset(1),
  graded: asset(2),
  blurred: asset(3),
  still: asset(4),
};

const services = createFakeGameServices({
  films: [film({ id: 2, title: "Collateral", year: 2004, genres: ["Crime", "Thriller"], directors: ["Michael Mann"], popularity: 50, tmdbId: 1538 })],
});

const resolve = (move: unknown) =>
  colorGradeServer.resolveMove({ move, puzzle, solution, state: colorGrade.initialState(puzzle) }, services);

describe("colorGradeServer.resolveMove", () => {
  it("attaches the guessed film's catalog facts, in the resolved-move shape", async () => {
    const result = await resolve({ type: "guess", filmId: 2 });
    expect(result).toEqual({
      ok: true,
      move: { type: "guess", film: { id: 2, title: "Collateral", year: 2004, genres: ["Crime", "Thriller"], directors: ["Michael Mann"] } },
    });
    if (result.ok) expect(colorGrade.resolvedMoveSchema?.safeParse(result.move).success).toBe(true);
  });

  it("passes skips through without a lookup", async () => {
    const before = services.calls.length;
    expect(await resolve({ type: "skip" })).toEqual({ ok: true, move: { type: "skip" } });
    expect(services.calls.length).toBe(before);
  });

  it("rejects a film that isn't in the catalog without using a try", async () => {
    expect(await resolve({ type: "guess", filmId: 999 })).toEqual({ ok: false, error: FILM_NOT_FOUND });
  });
});
