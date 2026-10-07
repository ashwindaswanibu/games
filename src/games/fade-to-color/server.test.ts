import { describe, expect, it } from "vitest";
import { FILM_NOT_FOUND } from "@/games/_movies/server";
import { advancePlay } from "@/server/move-pipeline";
import { createFakeGameServices, film } from "@/server/game-services.fake";
import { fadeToColor, LEVEL_COUNT, MAX_GUESSES, type Puzzle, type Solution, type State } from "./logic";
import { fadeToColorServer } from "./server";

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
  options: [
    { id: 1, title: "Heat", year: 1995 },
    { id: 2, title: "Collateral", year: 2004 },
    { id: 3, title: "Drive", year: 2011 },
    { id: 4, title: "Thief", year: 1981 },
  ],
};
const ctx = (filmId: number) => ({
  move: { type: "guess" as const, filmId },
  puzzle,
  solution,
  state: fadeToColor.initialState(puzzle),
});

describe("fadeToColorServer.resolveMove", () => {
  it("attaches the guessed film's catalog title and year to the move, and nothing more", async () => {
    const services = createFakeGameServices({ films: [heat, collateral] });
    const result = await fadeToColorServer.resolveMove(ctx(1), services);
    expect(result).toEqual({
      ok: true,
      move: {
        type: "guess",
        film: { id: 1, title: "Heat", year: 1995 },
      },
    });
    expect(services.calls).toEqual(["films.get(1)"]);
    expect(fadeToColor.resolvedMoveSchema!.safeParse((result as { move: unknown }).move).success).toBe(true);
  });

  it("rejects an id that isn't in the catalog without using a turn", async () => {
    const result = await fadeToColorServer.resolveMove(ctx(99), createFakeGameServices({ films: [heat] }));
    expect(result).toEqual({ ok: false, error: FILM_NOT_FOUND });
  });

  it("passes a skip through without a lookup", async () => {
    const services = createFakeGameServices({ films: [heat] });
    const result = await fadeToColorServer.resolveMove(
      {
        move: { type: "skip" },
        puzzle,
        solution,
        state: fadeToColor.initialState(puzzle),
      },
      services,
    );
    expect(result).toEqual({ ok: true, move: { type: "skip" } });
    expect(services.calls).toEqual([]);
  });

  it("passes a final pick through without a lookup (applyMove checks it against the options)", async () => {
    const services = createFakeGameServices({ films: [heat] });
    const result = await fadeToColorServer.resolveMove({ move: { type: "pick", filmId: 3 }, puzzle, solution, state: fadeToColor.initialState(puzzle) }, services);
    expect(result).toEqual({ ok: true, move: { type: "pick", filmId: 3 } });
    expect(services.calls).toEqual([]);
  });

  it("is registered for this game", () => {
    expect(fadeToColorServer.gameId).toBe(fadeToColor.id);
  });
});

describe("the full move pipeline", () => {
  const base = {
    game: fadeToColor,
    server: fadeToColorServer,
    puzzle,
    solution,
    elapsedMs: 0,
  };

  it("records a wrong guess from the catalog's facts, with no clues, and unlocks level 2", async () => {
    const step = await advancePlay({
      ...base,
      services: createFakeGameServices({ films: [heat, collateral] }),
      state: fadeToColor.initialState(puzzle),
      move: { type: "guess", filmId: 1 },
    });
    expect(step.ok && step.outcome).toBe("in_progress");
    if (!step.ok) throw new Error(step.error);
    expect((step.state as State).turns).toEqual([{ film: { id: 1, title: "Heat", year: 1995 }, correct: false }]);
    expect((step.state as State).unlocked).toEqual([levels[1]]);
  });

  it("refuses a skip on the last level: guess or take the four", async () => {
    const nineSkips: State = {
      turns: Array.from({ length: MAX_GUESSES - 1 }, () => ({ skipped: true as const })),
      unlocked: levels.slice(1),
      options: [],
      pick: null,
    };
    const step = await advancePlay({
      ...base,
      services: createFakeGameServices({ films: [heat, collateral] }),
      state: nineSkips,
      move: { type: "skip" },
    });
    expect(step).toMatchObject({ ok: false, error: "On the last reel, guess or take the four." });
  });

  it("opens the final pick on a wrong last guess, then scores a right pick", async () => {
    const nineSkips: State = {
      turns: Array.from({ length: MAX_GUESSES - 1 }, () => ({ skipped: true as const })),
      unlocked: levels.slice(1),
      options: [],
      pick: null,
    };
    const services = createFakeGameServices({ films: [heat, collateral] });
    const missed = await advancePlay({ ...base, services, state: nineSkips, move: { type: "guess", filmId: 1 } });
    if (!missed.ok) throw new Error(missed.error);
    expect(missed.outcome).toBe("in_progress");
    expect((missed.state as State).options).toEqual(solution.options);
    const picked = await advancePlay({ ...base, services, state: missed.state, move: { type: "pick", filmId: 2 } });
    expect(picked).toMatchObject({ ok: true, outcome: "won", result: { score: 5, label: "Pick 10/10", shareGrid: `${"⬛".repeat(9)}🟥🟡` } });
  });

  it("finishes and scores a correct guess", async () => {
    const step = await advancePlay({
      ...base,
      services: createFakeGameServices({ films: [heat, collateral] }),
      state: fadeToColor.initialState(puzzle),
      move: { type: "guess", filmId: 2 },
    });
    expect(step).toMatchObject({
      ok: true,
      outcome: "won",
      result: { score: 100, label: "1/10", shareGrid: "🟩" },
    });
  });
});
