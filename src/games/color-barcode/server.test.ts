import { describe, expect, it } from "vitest";
import { FILM_NOT_FOUND } from "@/games/_movies/server";
import { advancePlay } from "@/server/move-pipeline";
import { createFakeGameServices, film } from "@/server/game-services.fake";
import { colorBarcode, LEVEL_COUNT, MAX_GUESSES, type Puzzle, type Solution, type State } from "./logic";
import { colorBarcodeServer } from "./server";

const heat = film({
  id: 1,
  title: "Heat",
  year: 1995,
  genres: ["crime film", "thriller"],
  directors: ["Michael Mann"],
});
const collateral = film({
  id: 2,
  title: "Collateral",
  year: 2004,
  genres: ["thriller"],
  directors: ["Michael Mann"],
});

const level = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, width: 2400, height: 800, average: "#336699", dominant: "#224466" });
const levels = Array.from({ length: LEVEL_COUNT }, (_, i) => level(i + 1));
const puzzle: Puzzle = {
  fixture: true,
  maxGuesses: MAX_GUESSES,
  first: levels[0]!,
  look: { saturation: 0.3, monochrome: false },
};
const solution: Solution = {
  answer: {
    id: 2,
    title: "Collateral",
    year: 2004,
    genres: ["thriller"],
    directors: ["Michael Mann"],
  },
  levels,
  pace: "normal",
  credit: null,
};
const ctx = (filmId: number) => ({
  move: { type: "guess" as const, filmId },
  puzzle,
  solution,
  state: colorBarcode.initialState(puzzle),
});

describe("colorBarcodeServer.resolveMove", () => {
  it("attaches the guessed film's catalog facts to the move", async () => {
    const services = createFakeGameServices({ films: [heat, collateral] });
    const result = await colorBarcodeServer.resolveMove(ctx(1), services);
    expect(result).toEqual({
      ok: true,
      move: {
        type: "guess",
        film: {
          id: 1,
          title: "Heat",
          year: 1995,
          genres: ["crime film", "thriller"],
          directors: ["Michael Mann"],
        },
      },
    });
    expect(services.calls).toEqual(["films.get(1)"]);
    expect(colorBarcode.resolvedMoveSchema!.safeParse((result as { move: unknown }).move).success).toBe(true);
  });

  it("rejects an id that isn't in the catalog without using a turn", async () => {
    const result = await colorBarcodeServer.resolveMove(ctx(99), createFakeGameServices({ films: [heat] }));
    expect(result).toEqual({ ok: false, error: FILM_NOT_FOUND });
  });

  it("passes a skip through without a lookup", async () => {
    const services = createFakeGameServices({ films: [heat] });
    const result = await colorBarcodeServer.resolveMove(
      {
        move: { type: "skip" },
        puzzle,
        solution,
        state: colorBarcode.initialState(puzzle),
      },
      services,
    );
    expect(result).toEqual({ ok: true, move: { type: "skip" } });
    expect(services.calls).toEqual([]);
  });

  it("is registered for this game", () => {
    expect(colorBarcodeServer.gameId).toBe(colorBarcode.id);
  });
});

describe("the full move pipeline", () => {
  const base = {
    game: colorBarcode,
    server: colorBarcodeServer,
    puzzle,
    solution,
    elapsedMs: 0,
  };

  it("turns a wrong guess into clues from trusted facts, and unlocks level 2", async () => {
    const step = await advancePlay({
      ...base,
      services: createFakeGameServices({ films: [heat, collateral] }),
      state: colorBarcode.initialState(puzzle),
      move: { type: "guess", filmId: 1 },
    });
    expect(step.ok && step.outcome).toBe("in_progress");
    if (!step.ok) throw new Error(step.error);
    expect((step.state as State).turns[0]).toMatchObject({
      film: { id: 1, title: "Heat", year: 1995 },
      correct: false,
      clues: [
        { kind: "year", direction: "later" },
        { kind: "genres", shared: ["thriller"] },
        { kind: "director", match: "same" },
      ],
    });
    expect((step.state as State).unlocked).toEqual([levels[1]]);
  });

  it("finishes a skip on the last level as lost, for no points", async () => {
    const nineSkips: State = { turns: Array.from({ length: MAX_GUESSES - 1 }, () => ({ skipped: true as const })), unlocked: levels.slice(1) };
    const step = await advancePlay({
      ...base,
      services: createFakeGameServices({ films: [heat, collateral] }),
      state: nineSkips,
      move: { type: "skip" },
    });
    expect(step).toMatchObject({
      ok: true,
      outcome: "lost",
      result: { score: 0, label: "X/10", shareGrid: "⬛".repeat(10) },
    });
  });

  it("finishes and scores a correct guess", async () => {
    const step = await advancePlay({
      ...base,
      services: createFakeGameServices({ films: [heat, collateral] }),
      state: colorBarcode.initialState(puzzle),
      move: { type: "guess", filmId: 2 },
    });
    expect(step).toMatchObject({
      ok: true,
      outcome: "won",
      result: { score: 100, label: "1/10", shareGrid: "🟩" },
    });
  });
});
