import { describe, expect, it } from "vitest";
import { FILM_NOT_FOUND } from "@/games/_movies/server";
import { advancePlay } from "@/server/move-pipeline";
import { createFakeGameServices, film } from "@/server/game-services.fake";
import { colorBarcode, type Puzzle, type Solution, type State } from "./logic";
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

const puzzle: Puzzle = {
  fixture: true,
  maxGuesses: 6,
  stripes: Array.from({ length: 24 }, () => "#336699"),
};
const solution: Solution = {
  answer: {
    id: 2,
    title: "Collateral",
    year: 2004,
    genres: ["thriller"],
    directors: ["Michael Mann"],
  },
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

  it("passes a give-up through without a lookup", async () => {
    const services = createFakeGameServices({ films: [heat] });
    const result = await colorBarcodeServer.resolveMove(
      {
        move: { type: "give-up" },
        puzzle,
        solution,
        state: colorBarcode.initialState(puzzle),
      },
      services,
    );
    expect(result).toEqual({ ok: true, move: { type: "give-up" } });
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

  it("turns a wrong guess into clues from trusted facts", async () => {
    const step = await advancePlay({
      ...base,
      services: createFakeGameServices({ films: [heat, collateral] }),
      state: colorBarcode.initialState(puzzle),
      move: { type: "guess", filmId: 1 },
    });
    expect(step.ok && step.outcome).toBe("in_progress");
    if (!step.ok) throw new Error(step.error);
    expect((step.state as State).guesses[0]).toMatchObject({
      film: { id: 1, title: "Heat", year: 1995 },
      correct: false,
      clues: [
        { kind: "year", direction: "later" },
        { kind: "decade", match: "different" },
        { kind: "genres", shared: ["thriller"] },
        { kind: "director", match: "same" },
      ],
    });
  });

  it("finishes a give-up as lost, for no points", async () => {
    const step = await advancePlay({
      ...base,
      services: createFakeGameServices({ films: [heat, collateral] }),
      state: colorBarcode.initialState(puzzle),
      move: { type: "give-up" },
    });
    expect(step).toMatchObject({
      ok: true,
      outcome: "lost",
      result: { score: 0, label: "X/6" },
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
      result: { score: 100, label: "1/6", shareGrid: "🟩" },
    });
  });
});
