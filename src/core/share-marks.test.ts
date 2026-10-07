import { describe, expect, it } from "vitest";
import type { FilmDetails, FilmRef } from "@/games/_movies/schemas";
import { degrees } from "@/games/degrees/logic";
import { fadeToColor, LEVEL_COUNT } from "@/games/fade-to-color/logic";
import { frameByFrame } from "@/games/frame-by-frame/logic";
import { numberHunt } from "@/games/number-hunt/logic";
import type { GameDefinition } from "./game";
import { shareMarkKind, shareMarkRow, shareMarks } from "./share-marks";

/** Plays `moves` through the game's own pure logic and returns its real share grid. */
function playOut<P, S, St, M, R, RM>(game: GameDefinition<P, S, St, M, R, RM>, puzzle: P, solution: S, moves: readonly RM[]): string {
  let state = game.initialState(puzzle);
  for (const move of moves) {
    const result = game.applyMove({ puzzle, solution, state, move });
    if (!result.ok) throw new Error(`move rejected: ${result.error}`);
    state = result.state;
  }
  const outcome = game.outcome({ puzzle, solution, state });
  if (outcome === "in_progress") throw new Error(`${game.id} is not finished after these moves`);
  return game.shareGrid({ puzzle, state, outcome });
}

const film = (id: number, title: string, year: number): FilmDetails => ({ id, title, year, genres: ["Crime"], directors: ["Michael Mann"] });
const HEAT = film(1, "Heat", 1995);
const COLLATERAL = film(2, "Collateral", 2004);
const THIEF = film(3, "Thief", 1981);
const DRIVE = film(4, "Drive", 2011);
const NIGHTCRAWLER = film(5, "Nightcrawler", 2014);
const filmRef = ({ id, title, year }: FilmDetails): FilmRef => ({ id, title, year });
const asset = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, width: 1280, height: 720 });

describe("shareMarks on real share grids", () => {
  it("number-hunt: arrows with variation selectors are single marks, then the tick", () => {
    const puzzle = { min: 1, max: 100, maxGuesses: 7 };
    const grid = playOut(numberHunt, puzzle, { secret: 42 }, [{ guess: 50 }, { guess: 25 }, { guess: 42 }]);
    expect(grid).toBe("⬇️⬆️✅");
    expect(shareMarks(grid)).toEqual([["down", "up", "hit"]]);

    const lost = playOut(numberHunt, puzzle, { secret: 100 }, [1, 2, 3, 4, 5, 6, 7].map((guess) => ({ guess })));
    expect(shareMarks(lost)).toEqual([Array(7).fill("up")]);
  });

  it("degrees: film links then a star, or a flag when the player gave up", () => {
    const pacino = { id: 1, name: "Al Pacino" };
    const deNiro = { id: 2, name: "Robert De Niro" };
    const hopkins = { id: 4, name: "Anthony Hopkins" };
    const puzzle = { start: pacino, end: hopkins, par: 2 };
    const solution = { path: [{ film: filmRef(HEAT), person: deNiro }, { film: filmRef(THIEF), person: hopkins }] };

    const won = playOut(degrees, puzzle, solution, [
      { type: "link", fromPersonId: pacino.id, film: filmRef(HEAT), person: deNiro },
      { type: "link", fromPersonId: deNiro.id, film: filmRef(THIEF), person: hopkins },
    ]);
    expect(shareMarks(won)).toEqual([["link", "link", "win"]]);

    const gaveUp = playOut(degrees, puzzle, solution, [
      { type: "link", fromPersonId: pacino.id, film: filmRef(HEAT), person: deNiro },
      { type: "give-up" },
    ]);
    expect(gaveUp).toBe("🎞🏳️");
    expect(shareMarks(gaveUp)).toEqual([["link", "flag"]]);
  });

  it("frame-by-frame: solved, missed, skipped and unused frames", () => {
    const frames = [1, 2, 3, 4, 5, 6].map(asset);
    const grid = playOut(frameByFrame, { fixture: false, first: frames[0] }, { answer: COLLATERAL, later: frames.slice(1) }, [
      { type: "guess", film: HEAT },
      { type: "skip" },
      { type: "guess", film: COLLATERAL },
    ]);
    expect(grid).toBe("🟥⬛🟩⬜⬜⬜");
    expect(shareMarks(grid)).toEqual([["miss", "skip", "hit", "unused", "unused", "unused"]]);
  });

  describe("fade-to-color", () => {
    const level = (n: number) => ({ ...asset(n), width: 2400, height: 800, average: "#3a2f28", dominant: "#8a6a4f" });
    const levels = Array.from({ length: LEVEL_COUNT }, (_, i) => level(i + 1));
    const puzzle = { fixture: false, maxGuesses: LEVEL_COUNT, first: levels[0], look: { saturation: 0.3, monochrome: false } } as const;
    const solution = {
      answer: COLLATERAL,
      levels,
      pace: "normal" as const,
      credit: null,
      options: [DRIVE, COLLATERAL, NIGHTCRAWLER, THIEF].map(filmRef),
    };
    const guess = (f: FilmDetails) => ({ type: "guess" as const, film: filmRef(f) });
    const skip = { type: "skip" as const };
    const skips = (n: number) => Array.from({ length: n }, () => skip);
    const play = (moves: Parameters<typeof fadeToColor.applyMove>[0]["move"][]) => playOut(fadeToColor, puzzle, solution, moves);

    it("named on reel 3: a miss, a skip, the hit", () => {
      const grid = play([guess(HEAT), skip, guess(COLLATERAL)]);
      expect(grid).toBe("🟥⬛🟩");
      expect(shareMarks(grid)).toEqual([["miss", "skip", "hit"]]);
    });

    it("named on the final pick: ten reels, then 🟨 as the eleventh mark (near)", () => {
      const grid = play([...skips(LEVEL_COUNT - 1), guess(HEAT), { type: "pick", filmId: COLLATERAL.id }]);
      const row = shareMarkRow(grid);
      expect(row).toHaveLength(LEVEL_COUNT + 1);
      expect(row.at(-1)).toBe("near");
      expect(row.slice(0, LEVEL_COUNT)).toEqual([...Array(LEVEL_COUNT - 1).fill("skip"), "miss"]);
    });

    it("missed the final pick: eleven marks ending in a miss", () => {
      const grid = play([guess(HEAT), ...skips(LEVEL_COUNT - 2), guess(THIEF), { type: "pick", filmId: DRIVE.id }]);
      expect(shareMarkRow(grid)).toEqual(["miss", ...Array(LEVEL_COUNT - 2).fill("skip"), "miss", "miss"]);
    });

    it("gave up on reel 10: ten marks, no pick", () => {
      const grid = play(skips(LEVEL_COUNT));
      expect(shareMarkRow(grid)).toEqual(Array(LEVEL_COUNT).fill("skip"));
    });
  });
});

describe("shareMarks parsing", () => {
  it("returns no rows for an empty or blank grid", () => {
    expect(shareMarks("")).toEqual([]);
    expect(shareMarks("  \n \n")).toEqual([]);
    expect(shareMarkRow("")).toEqual([]);
  });

  it("keeps one row per non-blank line and trims around them", () => {
    expect(shareMarks("\n 🟩🟨\r\n\n🟥⬛ \n")).toEqual([
      ["hit", "near"],
      ["miss", "skip"],
    ]);
    expect(shareMarkRow("🟩🟨\n🟥⬛")).toEqual(["hit", "near", "miss", "skip"]);
  });

  it("accepts emoji with or without the variation selector", () => {
    expect(shareMarks("⬆⬆️⬇⬇️🎞🎞️🏳🏳️⭐⭐️✅✅️⬛⬛️⬜⬜️")).toEqual([
      ["up", "up", "down", "down", "link", "link", "flag", "flag", "win", "win", "hit", "hit", "skip", "skip", "unused", "unused"],
    ]);
  });

  it("never drops a symbol: unknown graphemes, including multi-code-point ones, are `other`", () => {
    expect(shareMarks("🟩x👍🏽🟦⭐")).toEqual([["hit", "other", "other", "other", "win"]]);
    expect(shareMarkKind("🎯")).toBe("other");
  });
});
