import { describe, expect, it } from "vitest";
import { FILM_NOT_FOUND } from "@/games/_movies/server";
import { createFakeGameServices, film } from "@/server/game-services.fake";
import { advancePlay, parseMove } from "@/server/move-pipeline";
import { frameByFrame, type Puzzle, type Solution, type State } from "./logic";
import { frameByFrameServer } from "./server";

const ref = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, width: 1280, height: 720 });
const puzzle: Puzzle = { fixture: true, first: ref(1) };
const solution: Solution = {
  answer: { id: 2, title: "Collateral", year: 2004, genres: ["Crime", "Thriller"], directors: ["Michael Mann"] },
  later: [ref(2), ref(3), ref(4), ref(5), ref(6)],
};
const empty: State = { turns: [], unlocked: [] };

const services = () =>
  createFakeGameServices({
    films: [
      film({ id: 1, title: "Heat", year: 1995, genres: ["Crime", "Drama"], directors: ["Michael Mann"] }),
      film({ id: 2, title: "Collateral", year: 2004, genres: ["Crime", "Thriller"], directors: ["Michael Mann"] }),
    ],
  });

const resolve = (move: unknown, fake = services()) =>
  frameByFrameServer.resolveMove({ move, puzzle, solution, state: empty }, fake);

describe("frame-by-frame resolveMove", () => {
  it("looks up the guessed film's facts", async () => {
    const fake = services();
    await expect(resolve({ type: "guess", filmId: 1 }, fake)).resolves.toEqual({
      ok: true,
      move: { type: "guess", film: { id: 1, title: "Heat", year: 1995, genres: ["Crime", "Drama"], directors: ["Michael Mann"] } },
    });
    expect(fake.calls).toEqual(["films.get(1)"]);
  });

  it("passes skips through without a lookup", async () => {
    const fake = services();
    await expect(resolve({ type: "skip" }, fake)).resolves.toEqual({ ok: true, move: { type: "skip" } });
    expect(fake.calls).toEqual([]);
  });

  it("rejects films that aren't in the catalog without using a turn", async () => {
    await expect(resolve({ type: "guess", filmId: 99 })).resolves.toEqual({ ok: false, error: FILM_NOT_FOUND });
  });
});

describe("frame-by-frame through the move pipeline", () => {
  const base = { game: frameByFrame, server: frameByFrameServer, puzzle, solution, elapsedMs: 0 };

  it("turns a wrong guess into clues and the next frame", async () => {
    const step = await advancePlay({ ...base, services: services(), state: empty, move: { type: "guess", filmId: 1 } });
    expect(step).toMatchObject({ ok: true, outcome: "in_progress", result: null });
    if (!step.ok) throw new Error("expected ok");
    expect(step.state).toEqual({
      turns: [
        {
          film: { id: 1, title: "Heat", year: 1995 },
          correct: false,
          clues: [
            { kind: "year", guessYear: 1995, direction: "later" },
            { kind: "genres", shared: ["Crime"], match: "some" },
            { kind: "director", shared: ["Michael Mann"], match: "same" },
          ],
        },
      ],
      unlocked: [ref(2)],
    });
  });

  it("scores a first-frame win", async () => {
    const step = await advancePlay({ ...base, services: services(), state: empty, move: { type: "guess", filmId: 2 } });
    expect(step).toMatchObject({ ok: true, outcome: "won", result: { score: 100, label: "1/6", shareGrid: "🟩⬜⬜⬜⬜⬜" } });
  });

  it("refuses malformed moves before they reach the resolver", () => {
    for (const move of [{ type: "guess", filmId: "2" }, { type: "guess" }, { type: "guess", filmId: 0 }, { type: "skip", filmId: 2 }, { type: "give-up" }, null]) {
      expect(parseMove(frameByFrame, move)).toEqual({ ok: false });
    }
    expect(parseMove(frameByFrame, { type: "guess", filmId: 2 })).toEqual({ ok: true, move: { type: "guess", filmId: 2 } });
  });
});
