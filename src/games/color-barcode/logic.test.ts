import { describe, expect, it } from "vitest";
import { referencedAssetIds } from "@/core/assets";
import type { FilmDetails } from "@/games/_movies/schemas";
import {
  colorBarcode,
  colorBarcodePuzzleSchema,
  colorBarcodeRevealSchema,
  colorBarcodeSolutionSchema,
  colorBarcodeStateSchema,
  edgeCode,
  EDGE_CODE_AFTER_MISSES,
  MAX_GUESSES,
  yearWindow,
  type Puzzle,
  type Solution,
  type State,
} from "./logic";

const answer: FilmDetails & { year: number } = {
  id: 10,
  title: "Fargo",
  year: 1996,
  genres: ["crime film", "black comedy"],
  directors: ["Joel Coen", "Ethan Coen"],
};
const films: Record<string, FilmDetails> = {
  heat: {
    id: 1,
    title: "Heat",
    year: 1995,
    genres: ["crime film", "thriller"],
    directors: ["Michael Mann"],
  },
  alien: {
    id: 2,
    title: "Alien",
    year: 1979,
    genres: ["science fiction", "horror film"],
    directors: ["Ridley Scott"],
  },
  matrix: {
    id: 3,
    title: "The Matrix",
    year: 1999,
    genres: ["science fiction", "action film"],
    directors: ["Lana Wachowski", "Lilly Wachowski"],
  },
  bigLebowski: {
    id: 4,
    title: "The Big Lebowski",
    year: 1998,
    genres: ["black comedy", "crime film"],
    directors: ["Joel Coen", "Ethan Coen"],
  },
  up: {
    id: 5,
    title: "Up",
    year: 2009,
    genres: ["animated film"],
    directors: ["Pete Docter"],
  },
  casablanca: {
    id: 6,
    title: "Casablanca",
    year: 1942,
    genres: ["drama"],
    directors: ["Michael Curtiz"],
  },
  noYear: { id: 7, title: "Lost Reel", year: null, genres: [], directors: [] },
  fargo: answer,
};

const puzzle: Puzzle = {
  fixture: false,
  maxGuesses: MAX_GUESSES,
  stripes: Array.from({ length: 48 }, (_, i) => (i % 2 ? "#1a2b3c" : "#d4c3b2")),
};
const solution: Solution = { answer };

function play(...names: (keyof typeof films)[]): State {
  let state = colorBarcode.initialState(puzzle);
  for (const name of names) {
    const result = colorBarcode.applyMove({
      puzzle,
      solution,
      state,
      move: { type: "guess", film: films[name] },
    });
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  return state;
}

const outcome = (state: State) => colorBarcode.outcome({ puzzle, solution, state });

describe("schemas", () => {
  it("accepts a well-formed puzzle and solution", () => {
    expect(colorBarcodePuzzleSchema.safeParse(puzzle).success).toBe(true);
    expect(colorBarcodeSolutionSchema.safeParse(solution).success).toBe(true);
  });

  it("rejects malformed barcodes", () => {
    const bad = (stripes: string[]) => colorBarcodePuzzleSchema.safeParse({ ...puzzle, stripes }).success;
    expect(bad(Array(23).fill("#000000"))).toBe(false);
    expect(bad(Array(2001).fill("#000000"))).toBe(false);
    expect(bad([...puzzle.stripes.slice(1), "#ABCDEF"])).toBe(false);
    expect(bad([...puzzle.stripes.slice(1), "red"])).toBe(false);
  });

  it("requires the answer's year (the edge code is built from it)", () => {
    expect(
      colorBarcodeSolutionSchema.safeParse({
        answer: { ...answer, year: null },
      }).success,
    ).toBe(false);
  });

  it("only accepts film-id guesses from the browser", () => {
    expect(colorBarcode.moveSchema.safeParse({ type: "guess", filmId: 3 }).success).toBe(true);
    expect(
      colorBarcode.moveSchema.safeParse({
        type: "guess",
        filmId: 3,
        film: answer,
      }).data,
    ).toEqual({ type: "guess", filmId: 3 });
    expect(colorBarcode.moveSchema.safeParse({ type: "guess", filmId: -1 }).success).toBe(false);
    expect(colorBarcode.moveSchema.safeParse({ type: "skip" }).success).toBe(false);
    expect(colorBarcode.moveSchema.safeParse({ type: "give-up" }).success).toBe(true);
    expect(colorBarcode.moveSchema.safeParse({ type: "give-up", filmId: 3 }).data).toEqual({ type: "give-up" });
  });
});

describe("applyMove", () => {
  it("records a wrong guess with year, decade, genre and director clues", () => {
    const state = play("heat");
    expect(state.guesses).toEqual([
      {
        film: { id: 1, title: "Heat", year: 1995 },
        correct: false,
        clues: [
          { kind: "year", guessYear: 1995, direction: "later" },
          { kind: "decade", guessDecade: 1990, match: "same" },
          { kind: "genres", shared: ["crime film"], match: "some" },
          { kind: "director", shared: [], match: "different" },
        ],
      },
    ]);
    expect(outcome(state)).toBe("in_progress");
    expect(colorBarcodeStateSchema.safeParse(state).success).toBe(true);
  });

  it("names a shared director", () => {
    const [guess] = play("bigLebowski").guesses;
    expect(guess.clues.find((c) => c.kind === "director")).toEqual({
      kind: "director",
      shared: ["Joel Coen", "Ethan Coen"],
      match: "same",
    });
  });

  it("gives unknown clues for a guess with no facts on record", () => {
    const [guess] = play("noYear").guesses;
    expect(guess.clues.map((c) => ("direction" in c ? c.direction : c.match))).toEqual(["unknown", "unknown", "unknown", "unknown"]);
  });

  it("wins on the right film, with no clues", () => {
    const state = play("heat", "fargo");
    expect(state.guesses[1]).toEqual({
      film: { id: 10, title: "Fargo", year: 1996 },
      correct: true,
      clues: [],
    });
    expect(outcome(state)).toBe("won");
  });

  it("stores only what the player may see of a guess (no genres or directors of the answer)", () => {
    const state = play("heat");
    expect(Object.keys(state.guesses[0].film).sort()).toEqual(["id", "title", "year"]);
    expect(JSON.stringify(state)).not.toContain("Fargo");
    expect(JSON.stringify(state)).not.toContain("Coen");
  });

  it("rejects a repeated guess without using a turn", () => {
    const state = play("heat");
    expect(
      colorBarcode.applyMove({
        puzzle,
        solution,
        state,
        move: { type: "guess", film: films.heat },
      }),
    ).toEqual({
      ok: false,
      error: "You already guessed Heat.",
    });
  });

  it("rejects moves once the game is over", () => {
    for (const state of [play("fargo"), play("heat", "alien", "matrix", "bigLebowski", "up", "casablanca")]) {
      const result = colorBarcode.applyMove({
        puzzle,
        solution,
        state,
        move: { type: "guess", film: films.noYear },
      });
      expect(result.ok).toBe(false);
    }
  });

  it("loses after six misses", () => {
    const state = play("heat", "alien", "matrix", "bigLebowski", "up");
    expect(outcome(state)).toBe("in_progress");
    expect(outcome(play("heat", "alien", "matrix", "bigLebowski", "up", "casablanca"))).toBe("lost");
  });

  it("ends the play as lost when the player gives up", () => {
    const state = play("heat");
    const result = colorBarcode.applyMove({
      puzzle,
      solution,
      state,
      move: { type: "give-up" },
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.state).toEqual({ ...state, gaveUp: true });
    expect(outcome(result.state)).toBe("lost");
    expect(
      colorBarcode.applyMove({
        puzzle,
        solution,
        state: result.state,
        move: { type: "give-up" },
      }).ok,
    ).toBe(false);
    expect(
      colorBarcode.applyMove({
        puzzle,
        solution,
        state: result.state,
        move: { type: "guess", film: films.fargo },
      }).ok,
    ).toBe(false);
  });

  it("is JSON-stable (state is stored as jsonb)", () => {
    const state = play("heat", "alien", "matrix");
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("the edge code", () => {
  it(`is earned at miss ${EDGE_CODE_AFTER_MISSES}, not before`, () => {
    expect(play("heat", "alien").edgeDecade).toBeNull();
    expect(edgeCode(play("heat", "alien"))).toBeNull();
    expect(play("heat", "alien", "up").edgeDecade).toBe(1990);
  });

  it("stays once earned", () => {
    expect(play("heat", "alien", "up", "casablanca").edgeDecade).toBe(1990);
  });

  it("isn't granted by a winning guess", () => {
    expect(play("heat", "alien", "fargo").edgeDecade).toBeNull();
  });

  it("marks the years the clues have ruled out", () => {
    // Heat (1995): later → 1996+. The Matrix (1999): earlier → ≤ 1998. Up (2009) earns the hint.
    const code = edgeCode(play("heat", "matrix", "up"))!;
    expect(code.decade).toBe(1990);
    expect(code.window).toEqual({ low: 1996, high: 1998 });
    expect(code.years.filter((y) => y.status === "open").map((y) => y.year)).toEqual([1996, 1997, 1998]);
    expect(code.years.find((y) => y.year === 1995)!.guesses).toEqual([1]);
    expect(code.years.find((y) => y.year === 1999)!.guesses).toEqual([2]);
  });

  it("lays the guesses on a century rule around the answer's decade", () => {
    const code = edgeCode(play("casablanca", "alien", "up"))!;
    expect(code.decades[0].decade).toBe(1920);
    expect(code.decades.at(-1)!.decade).toBe(2020);
    expect(code.decades.filter((d) => d.isAnswer).map((d) => d.decade)).toEqual([1990]);
    expect(code.decades.find((d) => d.decade === 1940)!.guesses).toEqual([1]);
    expect(code.decades.find((d) => d.decade === 1970)!.guesses).toEqual([2]);
    expect(code.decades.find((d) => d.decade === 2000)!.guesses).toEqual([3]);
  });

  it("widens the rule for very old films", () => {
    const state: State = {
      guesses: [
        {
          film: { id: 1, title: "Old", year: 1903 },
          correct: false,
          clues: [],
        },
      ],
      edgeDecade: 1990,
      gaveUp: false,
    };
    expect(edgeCode(state)!.decades[0].decade).toBe(1900);
  });
});

describe("yearWindow", () => {
  it("is open before any clue", () => {
    expect(yearWindow(colorBarcode.initialState(puzzle))).toEqual({
      low: null,
      high: null,
    });
  });

  it("narrows with year and decade clues", () => {
    expect(yearWindow(play("alien"))).toEqual({ low: 1980, high: null });
    expect(yearWindow(play("alien", "up"))).toEqual({ low: 1980, high: 2008 });
    expect(yearWindow(play("alien", "up", "heat"))).toEqual({
      low: 1996,
      high: 1999,
    });
  });
});

describe("score, share grid and reveal", () => {
  const finish = (state: State) => {
    const result = outcome(state);
    if (result === "in_progress") throw new Error("not finished");
    return { puzzle, solution, state, outcome: result, elapsedMs: 0 };
  };

  it("scores by guesses used", () => {
    expect(colorBarcode.score(finish(play("fargo")))).toEqual({
      score: 100,
      label: "1/6",
    });
    expect(colorBarcode.score(finish(play("heat", "alien", "matrix", "bigLebowski", "up", "fargo")))).toEqual({ score: 40, label: "6/6" });
    expect(colorBarcode.score(finish(play("heat", "alien", "matrix", "bigLebowski", "up", "casablanca")))).toEqual({
      score: 0,
      label: "X/6",
    });
    expect(colorBarcode.score(finish({ ...play("heat"), gaveUp: true }))).toEqual({ score: 0, label: "X/6" });
  });

  it("shares a spoiler-free grid: solved, right decade, miss", () => {
    const ctx = finish(play("heat", "alien", "fargo"));
    expect(colorBarcode.shareGrid(ctx)).toBe("🟨⬛🟩");
  });

  it("reveals the title, year and directors", () => {
    const reveal = colorBarcode.reveal!({ puzzle, solution });
    expect(reveal).toEqual({
      answer: {
        id: 10,
        title: "Fargo",
        year: 1996,
        directors: ["Joel Coen", "Ethan Coen"],
      },
    });
    expect(colorBarcodeRevealSchema.safeParse(reveal).success).toBe(true);
  });

  it("puts no assets anywhere (the barcode is drawn from the puzzle's colors)", () => {
    expect(referencedAssetIds({ puzzle, state: play("heat") }).size).toBe(0);
  });
});
