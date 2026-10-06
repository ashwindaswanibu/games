import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineGame } from "@/core/game";
import { attemptsScore } from "@/core/scoring";
import { defineGameServer } from "./game-server";
import { createFakeGameServices, film } from "./game-services.fake";
import { advancePlay, GameConfigurationError, parseMove } from "./move-pipeline";

/**
 * A tiny "name the film" game: the browser sends a film id, the server resolves it to the film's
 * title and year, and the pure logic compares it with the answer.
 */
const puzzleSchema = z.object({ maxGuesses: z.number().int().positive() });
const solutionSchema = z.object({ answerId: z.number().int() });
const moveSchema = z.object({ filmId: z.number().int().positive() });
const resolvedSchema = z.object({ filmId: z.number().int().positive(), title: z.string(), year: z.number().int().nullable() });

type Puzzle = z.infer<typeof puzzleSchema>;
type Solution = z.infer<typeof solutionSchema>;
type Move = z.infer<typeof moveSchema>;
type Resolved = z.infer<typeof resolvedSchema>;
interface State {
  guesses: { title: string; correct: boolean }[];
}

const nameTheFilm = defineGame<Puzzle, Solution, State, Move, never, Resolved>({
  id: "name-the-film",
  name: "Name the Film",
  tagline: "",
  rules: [],
  accent: "#000",
  emoji: "🎬",
  bucket: "movies",
  availability: "testing",
  puzzleSchema,
  solutionSchema,
  moveSchema,
  resolvedMoveSchema: resolvedSchema,
  initialState: () => ({ guesses: [] }),
  applyMove({ solution, state, move }) {
    if (state.guesses.some((g) => g.title === move.title)) return { ok: false, error: `Already guessed ${move.title}.` };
    return { ok: true, state: { guesses: [...state.guesses, { title: move.title, correct: move.filmId === solution.answerId }] } };
  },
  outcome({ puzzle, state }) {
    if (state.guesses.at(-1)?.correct) return "won";
    return state.guesses.length >= puzzle.maxGuesses ? "lost" : "in_progress";
  },
  score: ({ puzzle, state, outcome }) => ({
    score: attemptsScore(state.guesses.length, puzzle.maxGuesses, outcome === "won"),
    label: `${state.guesses.length}/${puzzle.maxGuesses}`,
  }),
  shareGrid: ({ state }) => state.guesses.map((g) => (g.correct ? "🟩" : "⬛")).join(""),
});

const server = defineGameServer(nameTheFilm, {
  async resolveMove({ move }, services) {
    const found = (await services.films.get([move.filmId])).get(move.filmId);
    if (!found) return { ok: false, error: "We couldn't find that film." };
    return { ok: true, move: { filmId: found.id, title: found.title, year: found.year } };
  },
});

const services = () =>
  createFakeGameServices({
    films: [film({ id: 1, title: "Heat", year: 1995 }), film({ id: 2, title: "Collateral", year: 2004 })],
  });

const base = {
  game: nameTheFilm,
  server,
  puzzle: { maxGuesses: 2 },
  solution: { answerId: 2 },
  state: { guesses: [] } as State,
  elapsedMs: 0,
};

describe("parseMove", () => {
  it("validates untrusted input with the game's moveSchema", () => {
    expect(parseMove(nameTheFilm, { filmId: 1 })).toEqual({ ok: true, move: { filmId: 1 } });
    expect(parseMove(nameTheFilm, { filmId: "1" })).toEqual({ ok: false });
    expect(parseMove(nameTheFilm, null)).toEqual({ ok: false });
  });
});

describe("advancePlay", () => {
  it("resolves the move on the server and hands the resolved move to the pure logic", async () => {
    const fake = services();
    const step = await advancePlay({ ...base, services: fake, move: { filmId: 1 } });
    expect(step).toEqual({ ok: true, state: { guesses: [{ title: "Heat", correct: false }] }, outcome: "in_progress", result: null });
    expect(fake.calls).toEqual(["films.get(1)"]);
  });

  it("passes the move, puzzle, solution and state to the resolver", async () => {
    const resolveMove = vi.fn(async () => ({ ok: true as const, move: { filmId: 2, title: "Collateral", year: 2004 } }));
    const spy = defineGameServer(nameTheFilm, { resolveMove });
    const state = { guesses: [{ title: "Heat", correct: false }] };
    await advancePlay({ ...base, server: spy, services: services(), state, move: { filmId: 2 } });
    expect(resolveMove).toHaveBeenCalledWith({ move: { filmId: 2 }, puzzle: base.puzzle, solution: base.solution, state }, expect.anything());
  });

  it("rejects without touching the logic when the resolver says no", async () => {
    const applyMove = vi.spyOn(nameTheFilm, "applyMove");
    const step = await advancePlay({ ...base, services: services(), move: { filmId: 99 } });
    expect(step).toEqual({ ok: false, error: "We couldn't find that film." });
    expect(applyMove).not.toHaveBeenCalled();
    applyMove.mockRestore();
  });

  it("surfaces the game's own rejections", async () => {
    const state = { guesses: [{ title: "Heat", correct: false }] };
    const step = await advancePlay({ ...base, services: services(), state, move: { filmId: 1 } });
    expect(step).toEqual({ ok: false, error: "Already guessed Heat." });
  });

  it("scores, labels and builds the share grid when the play finishes", async () => {
    const state = { guesses: [{ title: "Heat", correct: false }] };
    const step = await advancePlay({ ...base, services: services(), state, move: { filmId: 2 } });
    expect(step).toEqual({
      ok: true,
      outcome: "won",
      state: { guesses: [state.guesses[0], { title: "Collateral", correct: true }] },
      result: { score: 40, label: "2/2", shareGrid: "⬛🟩" },
    });
  });

  it("fails loudly when a resolver returns a move that breaks resolvedMoveSchema", async () => {
    const broken = defineGameServer(nameTheFilm, {
      resolveMove: async () => ({ ok: true, move: { filmId: 1, title: 42 } as never }),
    });
    await expect(advancePlay({ ...base, server: broken, services: services(), move: { filmId: 1 } })).rejects.toThrow(GameConfigurationError);
  });

  it("refuses to pass raw moves to a game that expects resolved ones", async () => {
    await expect(advancePlay({ ...base, server: undefined, services: services(), move: { filmId: 1 } })).rejects.toThrow(
      /no server module/,
    );
  });

  it("refuses a server module for a game without resolvedMoveSchema", async () => {
    const unresolved = { ...nameTheFilm, resolvedMoveSchema: undefined };
    await expect(advancePlay({ ...base, game: unresolved, services: services(), move: { filmId: 1 } })).rejects.toThrow(
      /no resolvedMoveSchema/,
    );
  });

  it("refuses a server module registered for another game", async () => {
    const other = { ...server, gameId: "other-game" };
    await expect(advancePlay({ ...base, server: other, services: services(), move: { filmId: 1 } })).rejects.toThrow(
      GameConfigurationError,
    );
  });

  it("passes plain moves straight through for games without a server module", async () => {
    const counter = defineGame<{ target: number }, null, { n: number }, { add: number }>({
      id: "counter",
      name: "Counter",
      tagline: "",
      rules: [],
      accent: "#000",
      emoji: "➕",
      bucket: "words",
      availability: "testing",
      puzzleSchema: z.object({ target: z.number() }),
      solutionSchema: z.null(),
      moveSchema: z.object({ add: z.number() }),
      initialState: () => ({ n: 0 }),
      applyMove: ({ state, move }) => ({ ok: true, state: { n: state.n + move.add } }),
      outcome: ({ puzzle, state }) => (state.n >= puzzle.target ? "won" : "in_progress"),
      score: ({ elapsedMs }) => ({ score: elapsedMs > 1000 ? 50 : 100, label: `${elapsedMs}ms` }),
      shareGrid: ({ state }) => `${state.n}`,
    });
    const step = await advancePlay({
      game: counter,
      server: undefined,
      services: services(),
      puzzle: { target: 3 },
      solution: null,
      state: { n: 1 },
      move: { add: 2 },
      elapsedMs: 1500,
    });
    expect(step).toEqual({ ok: true, state: { n: 3 }, outcome: "won", result: { score: 50, label: "1500ms", shareGrid: "3" } });
  });

  it("rejects scores outside 0–100", async () => {
    const generous = { ...nameTheFilm, score: () => ({ score: 101, label: "!" }) };
    const state = { guesses: [{ title: "Heat", correct: false }] };
    await expect(advancePlay({ ...base, game: generous, server: { ...server }, services: services(), state, move: { filmId: 2 } })).rejects.toThrow(
      /expected an integer 0–100/,
    );
  });
});
