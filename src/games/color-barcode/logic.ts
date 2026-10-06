import { z } from "zod";
import { assetRefSchema } from "@/core/assets";
import { defineGame } from "@/core/game";
import { attemptsScore } from "@/core/scoring";
import { computeClues } from "@/games/_movies/hints";
import { filmDetailsSchema, filmGuessSchema, filmIdSchema, type ClueKind, type FilmDetails, type FilmGuess } from "@/games/_movies/schemas";

/**
 * Color Barcode: name the film from pictures of the whole film, start to finish, in ten levels.
 *
 * Level 1 is the squeezed-frame barcode: frames sampled across the film, each squeezed into one
 * thin column. Levels 2–10 are full-height strips of real frames from equal stretches of the film,
 * fewer and wider each level, cut first at the frames' edges and drifting toward their centres (so
 * faces arrive late). A wrong guess or a skip reveals the next level, which replaces the current
 * one on screen (earlier levels stay viewable). Ten attempts; solving on attempt N scores
 * `attemptsScore(N, 10)`. Wrong guesses also earn clues: release year earlier or later, shared
 * genres, same director.
 *
 * Secrecy: the puzzle carries only level 1. Levels 2–10 sit in the solution, and `applyMove` copies
 * each into the state as it is earned, so `/api/assets/[id]` serves exactly the unlocked levels.
 * The answer reaches the browser only as clues until the play ends and `reveal` hands over the
 * film and every level. The pictures come from the content pipeline
 * (`scripts/content/movies/barcode-levels.mts`) or, in development, the DEV FIXTURE generator.
 */

export const LEVEL_COUNT = 10;
/** One attempt per level: a miss or skip on level N reveals level N + 1; a miss on level 10 ends the play. */
export const MAX_GUESSES = LEVEL_COUNT;
/** What a wrong guess tells you, in the order the chips are shown. */
export const CLUE_KINDS: readonly ClueKind[] = ["year", "genres", "director"];

/** A colour as stored: lowercase `#rrggbb`. */
export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, "Expected a lowercase #rrggbb color");
export type HexColor = z.infer<typeof hexColorSchema>;

/** One level's picture, plus colours the board may use around it (an ambient glow, a loading wash). */
export const levelRefSchema = assetRefSchema.extend({
  /** The picture's mean colour, averaged in linear light (what it blurs to). */
  average: hexColorSchema,
  /** Its most common colour (near black only when the picture mostly is). */
  dominant: hexColorSchema,
});
export type LevelRef = z.infer<typeof levelRefSchema>;

/** How colourful the film is, measured over the frames level 1 was made from. */
export const filmLookSchema = z.strictObject({
  /** Mean HSV saturation, 0–1, of the film's non-dark pixels. */
  saturation: z.number().min(0).max(1),
  /** Black and white, or as good as. */
  monochrome: z.boolean(),
});
export type FilmLook = z.infer<typeof filmLookSchema>;

/** Where the frames came from, credited in the reveal. */
export const creditSchema = z.strictObject({ source: z.string().min(1).max(80), url: z.url() });

export const PACES = ["normal", "slower", "faster"] as const;

const puzzleSchema = z.strictObject({
  /** True for DEV FIXTURE puzzles (procedural stand-in frames). */
  fixture: z.boolean(),
  maxGuesses: z.literal(MAX_GUESSES),
  /** Level 1, the squeezed-frame barcode: on screen from the start. */
  first: levelRefSchema,
  look: filmLookSchema,
});

const solutionSchema = z
  .strictObject({
    answer: filmDetailsSchema,
    /** All ten levels in order; `levels[0]` is the puzzle's `first`. Each later one is copied into the state when earned. */
    levels: z.array(levelRefSchema).length(LEVEL_COUNT),
    /** The reveal pace the levels were rendered with (provenance). */
    pace: z.enum(PACES),
    /** Null for DEV FIXTURES. */
    credit: creditSchema.nullable(),
  })
  .refine((s) => new Set(s.levels.map((l) => l.id.toLowerCase())).size === s.levels.length, "Levels must be distinct");

const moveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("guess"), filmId: filmIdSchema }),
  z.strictObject({ type: z.literal("skip") }),
]);

/** A guess with the guessed film's facts looked up on the server (see ./server.ts). */
const resolvedMoveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("guess"), film: filmDetailsSchema }),
  z.strictObject({ type: z.literal("skip") }),
]);

const skippedTurnSchema = z.strictObject({ skipped: z.literal(true) });
/** One attempt: a guess (with its clues) or a skip. Shaped like the kit's `GuessLogEntry`. */
export const turnSchema = z.union([filmGuessSchema, skippedTurnSchema]);
const stateSchema = z.strictObject({
  turns: z.array(turnSchema).max(MAX_GUESSES),
  /** Levels 2… earned so far, in order. Only ever copied from the solution by `applyMove`. */
  unlocked: z.array(levelRefSchema).max(LEVEL_COUNT - 1),
});

export type Puzzle = z.infer<typeof puzzleSchema>;
export type Solution = z.infer<typeof solutionSchema>;
export type Move = z.infer<typeof moveSchema>;
export type ResolvedMove = z.infer<typeof resolvedMoveSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type State = z.infer<typeof stateSchema>;

export interface Reveal {
  film: FilmDetails;
  /** All ten levels, level 1 first. */
  levels: LevelRef[];
  credit: z.infer<typeof creditSchema> | null;
}

export {
  puzzleSchema as colorBarcodePuzzleSchema,
  solutionSchema as colorBarcodeSolutionSchema,
  stateSchema as colorBarcodeStateSchema,
};

export function isSkip(turn: Turn): turn is { skipped: true } {
  return "skipped" in turn;
}

export function isGuess(turn: Turn): turn is FilmGuess {
  return !isSkip(turn);
}

/** Ids of the films guessed so far. */
export function guessedFilmIds(state: State): number[] {
  return state.turns.filter(isGuess).map((t) => t.film.id);
}

/** Every level the player may see right now, level 1 first. */
export function levelsInView(puzzle: Puzzle, state: State): LevelRef[] {
  return [puzzle.first, ...state.unlocked];
}

function outcomeOf(state: State) {
  const last = state.turns.at(-1);
  if (last && isGuess(last) && last.correct) return "won" as const;
  return state.turns.length >= MAX_GUESSES ? ("lost" as const) : ("in_progress" as const);
}

const SHARE = { solved: "🟩", missed: "🟥", skipped: "⬛" } as const;

export const colorBarcode = defineGame<Puzzle, Solution, State, Move, Reveal, ResolvedMove>({
  id: "color-barcode",
  name: "Color Barcode",
  tagline: "Name the film from its whole run, start to finish",
  rules: [
    "You see the whole film at once: every frame squeezed into a thin stripe, from the opening shot on the left to the end on the right.",
    `A wrong guess or a skip reveals the next level: real frames, in wider strips that move toward the middle of the picture. There are ${LEVEL_COUNT} levels.`,
    "Every wrong guess earns clues: whether the film came out earlier or later, shared genres, and whether it has the same director.",
    "The fewer levels you need, the more points you score.",
  ],
  accent: "#8c8c8c",
  emoji: "📼",
  bucket: "movies",
  availability: "testing",

  puzzleSchema,
  solutionSchema,
  moveSchema,
  resolvedMoveSchema,

  initialState: () => ({ turns: [], unlocked: [] }),

  applyMove({ solution, state, move }) {
    if (outcomeOf(state) !== "in_progress") return { ok: false, error: "Today's barcode is already finished." };

    let turn: Turn;
    if (move.type === "skip") {
      turn = { skipped: true };
    } else {
      const { film } = move;
      if (guessedFilmIds(state).includes(film.id)) return { ok: false, error: `You already guessed ${film.title}.` };
      const correct = film.id === solution.answer.id;
      turn = {
        film: { id: film.id, title: film.title, year: film.year },
        correct,
        clues: correct ? [] : computeClues(film, solution.answer, CLUE_KINDS),
      };
    }

    const turns = [...state.turns, turn];
    // A miss on levels 1–9 earns the next level; a miss on level 10 ends the play with nothing new.
    const earned = isGuess(turn) && turn.correct ? undefined : solution.levels[turns.length];
    const unlocked = earned ? [...state.unlocked, earned] : state.unlocked;
    return { ok: true, state: { turns, unlocked } };
  },

  outcome: ({ state }) => outcomeOf(state),

  score({ state, outcome }) {
    const won = outcome === "won";
    const attempts = state.turns.length;
    return {
      score: attemptsScore(attempts, MAX_GUESSES, won),
      label: `${won ? attempts : "X"}/${MAX_GUESSES}`,
    };
  },

  /** One mark per attempt: 🟩 named it, 🟥 a wrong guess, ⬛ a skip. */
  shareGrid: ({ state }) => state.turns.map((t) => (isSkip(t) ? SHARE.skipped : t.correct ? SHARE.solved : SHARE.missed)).join(""),

  reveal: ({ solution }) => ({ film: solution.answer, levels: solution.levels, credit: solution.credit }),
});
