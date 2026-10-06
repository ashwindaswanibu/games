import { z } from "zod";
import { defineGame } from "@/core/game";
import { attemptsScore } from "@/core/scoring";
import { computeClues, decadeOf } from "@/games/_movies/hints";
import { filmDetailsSchema, filmGuessSchema, filmIdSchema, filmRefSchema, type ClueKind, type FilmGuess } from "@/games/_movies/schemas";
import { hexColorSchema } from "./barcode";

/**
 * Color Barcode: name the film from its color barcode, every moment of the film squeezed into one
 * stripe of its average color, start to finish. The barcode is on screen from the start; there are
 * six guesses. A wrong guess earns clues (release year higher or lower, decade, shared genres, same
 * director), and from the third miss the board gains an edge code: the answer's decade on a
 * timeline, with every year the clues have ruled out marked.
 *
 * Moves are server-resolved (`./server.ts`): the browser sends a film id and the server attaches
 * the film's facts, so this logic compares facts it can trust.
 */

export const MAX_GUESSES = 6;
/** Misses before the edge code (the answer's decade on the timeline) appears. */
export const EDGE_CODE_AFTER_MISSES = 3;
/** Clues every wrong guess earns, in display order. */
export const CLUE_KINDS: readonly ClueKind[] = ["year", "decade", "genres", "director"];

/** Barcodes come from the pipeline at a few hundred stripes; these bounds only reject nonsense. */
export const MIN_STRIPES = 24;
export const MAX_STRIPES = 2000;

const yearSchema = z.number().int().min(1870).max(2100);

const puzzleSchema = z.object({
  /** True for a DEV FIXTURE: a procedurally generated stand-in barcode, not the film's real one. */
  fixture: z.boolean(),
  maxGuesses: z.number().int().min(1).max(10),
  /** The barcode, first moment to last. Public: it is the puzzle. */
  stripes: z.array(hexColorSchema).min(MIN_STRIPES).max(MAX_STRIPES),
});

const solutionSchema = z.object({
  /** A snapshot of the answer. Its year is required: the edge code is built from it. */
  answer: filmDetailsSchema.extend({ year: yearSchema }),
});

const giveUpSchema = z.object({ type: z.literal("give-up") });

const moveSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("guess"), filmId: filmIdSchema }), giveUpSchema]);

/** The move after the server has looked the guessed film up. */
const resolvedMoveSchema = z.discriminatedUnion("type", [z.object({ type: z.literal("guess"), film: filmDetailsSchema }), giveUpSchema]);

const stateSchema = z.object({
  guesses: z.array(filmGuessSchema).max(10),
  /** The answer's decade (e.g. 1990), earned at the third miss; null until then. */
  edgeDecade: yearSchema.nullable(),
  /** The player gave up: the play is lost and the answer revealed. */
  gaveUp: z.boolean(),
});

const revealSchema = z.object({
  answer: filmRefSchema.extend({ directors: z.array(z.string()) }),
});

export type Puzzle = z.infer<typeof puzzleSchema>;
export type Solution = z.infer<typeof solutionSchema>;
export type Move = z.infer<typeof moveSchema>;
export type ResolvedMove = z.infer<typeof resolvedMoveSchema>;
export type State = z.infer<typeof stateSchema>;
export type Reveal = z.infer<typeof revealSchema>;

export {
  puzzleSchema as colorBarcodePuzzleSchema,
  solutionSchema as colorBarcodeSolutionSchema,
  stateSchema as colorBarcodeStateSchema,
  revealSchema as colorBarcodeRevealSchema,
};

const missesIn = (guesses: readonly FilmGuess[]) => guesses.filter((g) => !g.correct).length;

function outcomeOf(puzzle: Puzzle, state: State) {
  if (state.guesses.at(-1)?.correct) return "won" as const;
  return state.gaveUp || state.guesses.length >= puzzle.maxGuesses ? ("lost" as const) : ("in_progress" as const);
}

export const colorBarcode = defineGame<Puzzle, Solution, State, Move, Reveal, ResolvedMove>({
  id: "color-barcode",
  name: "Color Barcode",
  tagline: "Name the film from its color barcode",
  rules: [
    "Every stripe is one moment of a film, squeezed to its average color, from the opening shot to the end credits.",
    `Name the film in ${MAX_GUESSES} guesses.`,
    "A wrong guess tells you whether the film is older or newer, its decade, shared genres and whether the director matches.",
    "After your third miss, the film's decade appears on a timeline under the barcode.",
    "Stuck? You can give up and see the answer, for no points.",
  ],
  accent: "#8c8c8c",
  emoji: "📼",
  bucket: "movies",
  availability: "testing",

  puzzleSchema,
  solutionSchema,
  moveSchema,
  resolvedMoveSchema,

  initialState: () => ({ guesses: [], edgeDecade: null, gaveUp: false }),

  applyMove({ puzzle, solution, state, move }) {
    if (outcomeOf(puzzle, state) !== "in_progress") return { ok: false, error: "Today's barcode is already finished." };
    if (move.type === "give-up") return { ok: true, state: { ...state, gaveUp: true } };
    const { film } = move;
    if (state.guesses.some((g) => g.film.id === film.id)) {
      return { ok: false, error: `You already guessed ${film.title}.` };
    }
    const { answer } = solution;
    const correct = film.id === answer.id;
    const guess: FilmGuess = {
      film: { id: film.id, title: film.title, year: film.year },
      correct,
      clues: correct ? [] : computeClues(film, answer, CLUE_KINDS),
    };
    const guesses = [...state.guesses, guess];
    const edgeDecade = state.edgeDecade ?? (!correct && missesIn(guesses) >= EDGE_CODE_AFTER_MISSES ? decadeOf(answer.year) : null);
    return { ok: true, state: { ...state, guesses, edgeDecade } };
  },

  outcome: ({ puzzle, state }) => outcomeOf(puzzle, state),

  score({ puzzle, state, outcome }) {
    const n = state.guesses.length;
    const won = outcome === "won";
    return {
      score: attemptsScore(n, puzzle.maxGuesses, won),
      label: `${won ? n : "X"}/${puzzle.maxGuesses}`,
    };
  },

  /** 🟩 solved, 🟨 a miss in the right decade, ⬛ any other miss. */
  shareGrid: ({ state }) =>
    state.guesses.map((g) => (g.correct ? "🟩" : g.clues.some((c) => c.kind === "decade" && c.match === "same") ? "🟨" : "⬛")).join(""),

  reveal: ({ solution }) => ({
    answer: {
      id: solution.answer.id,
      title: solution.answer.title,
      year: solution.answer.year,
      directors: solution.answer.directors,
    },
  }),
});

// ---------------------------------------------------------------------------------------------
// The edge code: what the clues so far say about the release year, as a timeline. Pure, so the
// UI only draws it.
// ---------------------------------------------------------------------------------------------

/** The years still possible given every clue in the state; null bounds are open. */
export function yearWindow(state: State): {
  low: number | null;
  high: number | null;
} {
  let low: number | null = null;
  let high: number | null = null;
  const atLeast = (year: number) => (low = low === null ? year : Math.max(low, year));
  const atMost = (year: number) => (high = high === null ? year : Math.min(high, year));
  for (const { clues } of state.guesses) {
    for (const clue of clues) {
      if (clue.kind === "year" && clue.guessYear !== null) {
        if (clue.direction === "later") atLeast(clue.guessYear + 1);
        else if (clue.direction === "earlier") atMost(clue.guessYear - 1);
        else if (clue.direction === "same") {
          atLeast(clue.guessYear);
          atMost(clue.guessYear);
        }
      } else if (clue.kind === "decade" && clue.match === "same" && clue.guessDecade !== null) {
        atLeast(clue.guessDecade);
        atMost(clue.guessDecade + 9);
      }
    }
  }
  if (state.edgeDecade !== null) {
    atLeast(state.edgeDecade);
    atMost(state.edgeDecade + 9);
  }
  return { low, high };
}

export type EdgeStatus = "open" | "ruled-out";

export interface EdgeCode {
  /** The answer's decade (the hint itself). */
  decade: number;
  /**
   * Decades on the century rule, oldest first. Once the hint is given every other decade is ruled
   * out, so the rule's job is context: where each guess fell relative to the answer's decade.
   */
  decades: { decade: number; isAnswer: boolean; guesses: number[] }[];
  /** The ten years of the answer's decade. `guesses` holds the 1-based numbers of guesses from that year. */
  years: { year: number; status: EdgeStatus; guesses: number[] }[];
  /** First and last year still possible, for the spoken summary. */
  window: { low: number; high: number };
}

/** First and last decade the century rule shows (widened to fit any guess or the answer). */
export const EDGE_RULE_FIRST_DECADE = 1920;
export const EDGE_RULE_LAST_DECADE = 2020;

/** The edge code for the board, or null before it has been earned. */
export function edgeCode(state: State): EdgeCode | null {
  if (state.edgeDecade === null) return null;
  const decade = state.edgeDecade;
  const window = yearWindow(state);
  const low = Math.max(decade, window.low ?? decade);
  const high = Math.min(decade + 9, window.high ?? decade + 9);

  const guessNumbersBy = (match: (year: number) => boolean) =>
    state.guesses.flatMap((g, i) => (g.film.year !== null && match(g.film.year) ? [i + 1] : []));

  const guessDecades = state.guesses.flatMap((g) => (g.film.year === null ? [] : [decadeOf(g.film.year)]));
  const first = Math.min(EDGE_RULE_FIRST_DECADE, decade, ...guessDecades);
  const last = Math.max(EDGE_RULE_LAST_DECADE, decade, ...guessDecades);
  const decades: EdgeCode["decades"] = [];
  for (let d = first; d <= last; d += 10) {
    decades.push({
      decade: d,
      isAnswer: d === decade,
      guesses: guessNumbersBy((y) => decadeOf(y) === d),
    });
  }

  const years: EdgeCode["years"] = Array.from({ length: 10 }, (_, i) => {
    const year = decade + i;
    return {
      year,
      status: year >= low && year <= high ? "open" : "ruled-out",
      guesses: guessNumbersBy((y) => y === year),
    };
  });
  return { decade, decades, years, window: { low, high } };
}
