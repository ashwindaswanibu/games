import { z } from "zod";
import { assetRefSchema, type AssetRef } from "@/core/assets";
import { defineGame } from "@/core/game";
import { attemptsScore } from "@/core/scoring";
import { computeClues } from "@/games/_movies/hints";
import { filmDetailsSchema, filmGuessSchema, filmIdSchema, type ClueKind, type FilmDetails, type FilmGuess } from "@/games/_movies/schemas";

/**
 * Frame by Frame: name the film from a single frame. Six frames are revealed from hardest to
 * easiest; a wrong guess or a skip reveals the next one, and a wrong guess also earns clues about
 * the answer (release year earlier or later, shared genres, same director).
 *
 * Secrecy: the puzzle carries only the first frame. Frames 2–6 sit in the solution, and
 * `applyMove` copies each into the state as it is earned, so `/api/assets/[id]` serves exactly the
 * frames the player has unlocked. The answer's facts reach the browser only as clues until the
 * play ends and `reveal` hands over the film and every frame.
 */

export const FRAME_COUNT = 6;
/** What a wrong guess tells you, in the order the chips are shown. */
export const CLUE_KINDS: readonly ClueKind[] = ["year", "genres", "director"];

const puzzleSchema = z.strictObject({
  /** True for DEV FIXTURE puzzles (procedural stand-in frames). */
  fixture: z.boolean(),
  /** Frame 1, the hardest: on screen from the start. */
  first: assetRefSchema,
});

const solutionSchema = z
  .strictObject({
    answer: filmDetailsSchema,
    /** Frames 2–6, hardest to easiest. Each is copied into the state when it is earned. */
    later: z.array(assetRefSchema).length(FRAME_COUNT - 1),
  })
  .refine((s) => new Set(s.later.map((f) => f.id.toLowerCase())).size === s.later.length, "Frames must be distinct");

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
/** One turn: a guess (with its clues) or a skip. Shaped like the kit's `GuessLogEntry`. */
export const turnSchema = z.union([filmGuessSchema, skippedTurnSchema]);
export const stateSchema = z.strictObject({
  turns: z.array(turnSchema).max(FRAME_COUNT),
  /** Frames 2… earned so far, in order. Only ever copied from the solution by `applyMove`. */
  unlocked: z.array(assetRefSchema).max(FRAME_COUNT - 1),
});

export type Puzzle = z.infer<typeof puzzleSchema>;
export type Solution = z.infer<typeof solutionSchema>;
export type Move = z.infer<typeof moveSchema>;
export type ResolvedMove = z.infer<typeof resolvedMoveSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type State = z.infer<typeof stateSchema>;

export interface Reveal {
  film: FilmDetails;
  /** All six frames, hardest first. */
  frames: AssetRef[];
}

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

/** Every frame the player may see right now, hardest first: frame 1 plus those earned. */
export function framesInView(puzzle: Puzzle, state: State): AssetRef[] {
  return [puzzle.first, ...state.unlocked];
}

function solved(state: State): boolean {
  const last = state.turns.at(-1);
  return last !== undefined && isGuess(last) && last.correct;
}

function outcomeOf(state: State) {
  if (solved(state)) return "won" as const;
  return state.turns.length >= FRAME_COUNT ? ("lost" as const) : ("in_progress" as const);
}

const SHARE: Record<"solved" | "missed" | "skipped" | "unused", string> = { solved: "🟩", missed: "🟥", skipped: "⬛", unused: "⬜" };

export const frameByFrame = defineGame<Puzzle, Solution, State, Move, Reveal, ResolvedMove>({
  id: "frame-by-frame",
  name: "Frame by Frame",
  tagline: "Name the film from a single frame",
  rules: [
    "You get one frame from a film. Name the film.",
    `A wrong guess or a skip reveals the next frame. There are ${FRAME_COUNT}, each easier than the last.`,
    "Every wrong guess earns clues: whether the film came out earlier or later, shared genres, and whether it has the same director.",
    "The fewer frames you need, the more points you score.",
  ],
  accent: "#e9a31e",
  emoji: "🖼️",
  bucket: "movies",
  availability: "testing",

  puzzleSchema,
  solutionSchema,
  moveSchema,
  resolvedMoveSchema,

  initialState: () => ({ turns: [], unlocked: [] }),

  applyMove({ solution, state, move }) {
    if (outcomeOf(state) !== "in_progress") return { ok: false, error: "This puzzle is already finished." };

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
    const earned = isGuess(turn) && turn.correct ? null : solution.later[turns.length - 1];
    // A miss on frames 1–5 earns the next frame; a miss on frame 6 ends the play with nothing new.
    const unlocked = earned ? [...state.unlocked, earned] : state.unlocked;
    return { ok: true, state: { turns, unlocked } };
  },

  outcome: ({ state }) => outcomeOf(state),

  score({ state, outcome }) {
    const won = outcome === "won";
    const frames = state.turns.length;
    return {
      score: attemptsScore(frames, FRAME_COUNT, won),
      label: `${won ? frames : "X"}/${FRAME_COUNT}`,
    };
  },

  shareGrid({ state }) {
    const cells = state.turns.map((t) => (isSkip(t) ? SHARE.skipped : t.correct ? SHARE.solved : SHARE.missed));
    while (cells.length < FRAME_COUNT) cells.push(SHARE.unused);
    return cells.join("");
  },

  home: {
    form: { kind: "frames", count: FRAME_COUNT, aspect: "4:3", finalPick: false },
    // One mark per frame used, padded with unused frames: the frames seen are the marks before the padding.
    line: ({ outcome, marks }) => {
      const frames = marks.filter((m) => m !== "unused").length;
      return outcome === "won" ? `Named on frame ${frames}` : `Not named in ${frames} frames`;
    },
  },

  reveal: ({ puzzle, solution }) => ({ film: solution.answer, frames: [puzzle.first, ...solution.later] }),
});
