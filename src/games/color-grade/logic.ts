import { z } from "zod";
import { assetRefSchema, type AssetRef } from "@/core/assets";
import { defineGame } from "@/core/game";
import { attemptsScore } from "@/core/scoring";
import { computeClues } from "@/games/_movies/hints";
import {
  filmDetailsSchema,
  filmGuessSchema,
  filmIdSchema,
  type ClueKind,
  type FilmDetails,
  type FilmGuess,
  type FilmRef,
} from "@/games/_movies/schemas";

/**
 * Color Grade: name the film from its look alone. Every wrong guess or skip moves to the next stage:
 *
 *   1. Palette  – the five dominant colours of one frame, weighted by how much of it they cover.
 *   2. Graded   – an ordinary neutral photo, regraded to the frame's colour (Reinhard transfer),
 *                 shown with the ungraded original for comparison.
 *   3. Blurred  – the frame itself, heavily out of focus.
 *   4. Still    – the frame.
 *   5. Final    – one last guess with everything on the table.
 *
 * Wrong guesses also earn clues (release year ↑↓, shared genres, same director). Images are secret
 * assets: only the palette is in the puzzle; each later image's ref moves from the solution into
 * the state when its stage is reached, and the rest come with the reveal.
 */

export const MAX_TRIES = 5;
export const PALETTE_SIZE = 5;

/** The stage shown on each try, in order (`STAGES[try - 1]`). */
export const STAGES = ["palette", "graded", "blurred", "still", "final"] as const;
export type Stage = (typeof STAGES)[number];

export const CLUE_KINDS: readonly ClueKind[] = ["year", "genres", "director"];

const hexSchema = z.string().regex(/^#[0-9a-f]{6}$/, "Expected a lowercase #rrggbb colour");

export const swatchSchema = z.object({
  hex: hexSchema,
  /** Fraction of the frame this colour covers. */
  share: z.number().min(0).max(1),
});
export type Swatch = z.infer<typeof swatchSchema>;

const puzzleSchema = z.object({
  /** A DEV FIXTURE puzzle (procedural images), labelled as such in the UI. */
  fixture: z.boolean(),
  /** Largest share first. Public from the start: it is stage 1. */
  palette: z
    .array(swatchSchema)
    .length(PALETTE_SIZE)
    .refine((palette) => Math.abs(palette.reduce((sum, s) => sum + s.share, 0) - 1) < 0.01, "Palette shares must sum to 1"),
});

const solutionSchema = z.object({
  answer: filmDetailsSchema,
  /** The neutral photo before grading (shown beside the graded one from stage 2). */
  neutral: assetRefSchema,
  graded: assetRefSchema,
  blurred: assetRefSchema,
  still: assetRefSchema,
});

const moveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("guess"), filmId: filmIdSchema }),
  z.object({ type: z.literal("skip") }),
]);

/** What `applyMove` receives: the server swaps the guessed id for the film's catalog facts. */
const resolvedMoveSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("guess"), film: filmDetailsSchema }),
  z.object({ type: z.literal("skip") }),
]);

/** One try: a guess with its verdict and clues, or a skip. */
export const turnSchema = z.union([filmGuessSchema, z.object({ skipped: z.literal(true) })]);
export type Turn = FilmGuess | { skipped: true };

export const unlockedSchema = z.object({
  neutral: assetRefSchema.nullable(),
  graded: assetRefSchema.nullable(),
  blurred: assetRefSchema.nullable(),
  still: assetRefSchema.nullable(),
});
export type Unlocked = z.infer<typeof unlockedSchema>;

export const stateSchema = z.object({
  turns: z.array(turnSchema).max(MAX_TRIES),
  /** Images earned so far. Only refs in here (or the puzzle, or the reveal) can be fetched. */
  unlocked: unlockedSchema,
});

export const revealSchema = z.object({
  answer: filmDetailsSchema,
  neutral: assetRefSchema,
  graded: assetRefSchema,
  blurred: assetRefSchema,
  still: assetRefSchema,
});

export type Puzzle = z.infer<typeof puzzleSchema>;
export type Solution = z.infer<typeof solutionSchema>;
export type Move = z.infer<typeof moveSchema>;
export type ResolvedMove = z.infer<typeof resolvedMoveSchema>;
export type State = z.infer<typeof stateSchema>;
export type Reveal = z.infer<typeof revealSchema>;

const NOTHING_UNLOCKED: Unlocked = { neutral: null, graded: null, blurred: null, still: null };

/** The images that become visible on reaching the stage of try `tryNumber` (1-based). */
function unlocksFor(tryNumber: number, solution: Solution): Partial<Record<keyof Unlocked, AssetRef>> {
  switch (STAGES[tryNumber - 1]) {
    case "graded":
      return { neutral: solution.neutral, graded: solution.graded };
    case "blurred":
      return { blurred: solution.blurred };
    case "still":
      return { still: solution.still };
    default:
      return {};
  }
}

export function isSolved(state: State): boolean {
  const last = state.turns.at(-1);
  return last !== undefined && !("skipped" in last) && last.correct;
}

export function isFinished(state: State): boolean {
  return isSolved(state) || state.turns.length >= MAX_TRIES;
}

/** The try being played (1-based), or null once the play is over. */
export function currentTry(state: State): number | null {
  return isFinished(state) ? null : state.turns.length + 1;
}

export function guessedFilmIds(state: State): number[] {
  return state.turns.flatMap((turn) => ("skipped" in turn ? [] : [turn.film.id]));
}

const toRef = (film: FilmDetails): FilmRef => ({ id: film.id, title: film.title, year: film.year });

const TURN_EMOJI = { solved: "🟩", missed: "🟥", skipped: "⬛", unused: "⬜" } as const;

export const colorGrade = defineGame<Puzzle, Solution, State, Move, Reveal, ResolvedMove>({
  id: "color-grade",
  name: "Color Grade",
  tagline: "Name the film from its colors alone",
  rules: [
    "Name today's film from its look: first its color palette, then an ordinary photo graded like the film, then a blurred frame, then the frame itself.",
    `You have ${MAX_TRIES} tries. A wrong guess or a skip moves to the next stage.`,
    "Wrong guesses also tell you whether the film is older or newer, which genres it shares and whether it has the same director.",
    "Fewer tries, more points.",
  ],
  accent: "#efa51c",
  emoji: "🎨",
  bucket: "movies",
  availability: "testing",

  puzzleSchema,
  solutionSchema,
  moveSchema,
  resolvedMoveSchema,

  initialState: () => ({ turns: [], unlocked: NOTHING_UNLOCKED }),

  applyMove({ solution, state, move }) {
    if (isFinished(state)) return { ok: false, error: "This puzzle is already finished." };

    let turn: Turn;
    if (move.type === "skip") {
      turn = { skipped: true };
    } else {
      if (guessedFilmIds(state).includes(move.film.id)) {
        return { ok: false, error: `You already guessed ${move.film.title}.` };
      }
      const correct = move.film.id === solution.answer.id;
      turn = { film: toRef(move.film), correct, clues: correct ? [] : computeClues(move.film, solution.answer, CLUE_KINDS) };
    }

    const turns = [...state.turns, turn];
    const next = { turns, unlocked: state.unlocked };
    // A miss on any try but the last opens the next stage.
    if (!isFinished(next)) next.unlocked = { ...state.unlocked, ...unlocksFor(turns.length + 1, solution) };
    return { ok: true, state: next };
  },

  outcome({ state }) {
    if (isSolved(state)) return "won";
    return state.turns.length >= MAX_TRIES ? "lost" : "in_progress";
  },

  score({ state, outcome }) {
    const tries = state.turns.length;
    const won = outcome === "won";
    return { score: attemptsScore(tries, MAX_TRIES, won), label: `${won ? tries : "X"}/${MAX_TRIES}` };
  },

  shareGrid({ state }) {
    const cells: string[] = state.turns.map((turn) => ("skipped" in turn ? TURN_EMOJI.skipped : turn.correct ? TURN_EMOJI.solved : TURN_EMOJI.missed));
    while (cells.length < MAX_TRIES) cells.push(TURN_EMOJI.unused);
    return cells.join("");
  },

  reveal: ({ solution }) => ({
    answer: solution.answer,
    neutral: solution.neutral,
    graded: solution.graded,
    blurred: solution.blurred,
    still: solution.still,
  }),
});

