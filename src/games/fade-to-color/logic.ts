import { z } from "zod";
import { assetRefSchema } from "@/core/assets";
import { defineGame } from "@/core/game";
import { attemptsScore } from "@/core/scoring";
import { filmDetailsSchema, filmIdSchema, filmRefSchema, type FilmDetails, type FilmRef } from "@/games/_movies/schemas";

/**
 * Fade to Color: name the film from pictures of the whole film, start to finish, in ten levels.
 *
 * Level 1 is the squeezed-frame barcode: frames sampled across the film, each squeezed into one
 * thin column. Levels 2–10 are full-height strips of real frames from equal stretches of the film,
 * fewer and wider each level, cut first at the frames' edges and drifting toward their centres (so
 * faces arrive late). A wrong guess or a skip reveals the next level, which replaces the current
 * one on screen (earlier levels stay viewable). There are no clues of any kind (owner decision,
 * 2026-10-06): a wrong guess only unreels the film a little further.
 *
 * Ten attempts, one per level ("reel"). Naming the film on reel N scores 100, 90, … 10 (reel 10).
 * A wrong guess on reel 10 earns the final pick: one choice from `OPTION_COUNT` films (the answer
 * and look-alikes chosen when the puzzle was made), worth `PICK_SCORE`. Giving up on reel 10 (a
 * skip) ends the play with no pick. (Owner decisions, 2026-10-06.)
 *
 * Secrecy: the puzzle carries only level 1. Levels 2–10 and the pick's options sit in the solution,
 * and `applyMove` copies each into the state as it is earned, so `/api/assets/[id]` serves exactly
 * the unlocked levels and the options' titles reach the browser only once the pick is earned.
 * Nothing else about the answer reaches the browser until the play ends and `reveal` hands over
 * the film and every level. The pictures come from the content pipeline
 * (`scripts/content/movies/barcode-levels.mts`) or, in development, the DEV FIXTURE generator.
 */

export const LEVEL_COUNT = 10;
/** One attempt per level: a miss or skip on level N reveals level N + 1; a miss on level 10 earns the final pick. */
export const MAX_GUESSES = LEVEL_COUNT;
/** Films offered in the final pick: the answer and three look-alikes. */
export const OPTION_COUNT = 4;
/** Score for naming the film on the last reel (reel 1 is 100, each reel after it 10 less). */
export const LAST_REEL_SCORE = 10;
/** Score for choosing the answer in the final pick. */
export const PICK_SCORE = 5;

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
    /** The final pick's films, in the order they're shown: the answer and its look-alikes. */
    options: z.array(filmRefSchema).length(OPTION_COUNT),
  })
  .refine((s) => new Set(s.levels.map((l) => l.id.toLowerCase())).size === s.levels.length, "Levels must be distinct")
  .refine((s) => new Set(s.options.map((f) => f.id)).size === s.options.length, "Options must be distinct films")
  .refine((s) => s.options.some((f) => f.id === s.answer.id), "The options must include the answer");

const pickMoveSchema = z.strictObject({ type: z.literal("pick"), filmId: filmIdSchema });

const moveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("guess"), filmId: filmIdSchema }),
  z.strictObject({ type: z.literal("skip") }),
  pickMoveSchema,
]);

/**
 * A guess with the guessed film looked up in the catalog on the server (see ./server.ts). A pick
 * needs no lookup: `applyMove` checks it against the options in the state.
 */
const resolvedMoveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("guess"), film: filmRefSchema }),
  z.strictObject({ type: z.literal("skip") }),
  pickMoveSchema,
]);

const guessTurnSchema = z.strictObject({ film: filmRefSchema, correct: z.boolean() });
const skippedTurnSchema = z.strictObject({ skipped: z.literal(true) });
/** One attempt: a guess (the film and whether it was right, nothing more) or a skip. */
export const turnSchema = z.union([guessTurnSchema, skippedTurnSchema]);
const pickSchema = z.strictObject({ film: filmRefSchema, correct: z.boolean() });
const stateSchema = z
  .strictObject({
    turns: z.array(turnSchema).max(MAX_GUESSES),
    /** Levels 2… earned so far, in order. Only ever copied from the solution by `applyMove`. */
    unlocked: z.array(levelRefSchema).max(LEVEL_COUNT - 1),
    /** The final pick's films: empty until a wrong guess on the last reel copies them from the solution. */
    options: z.array(filmRefSchema),
    /** The film chosen in the final pick, and whether it was the answer. */
    pick: pickSchema.nullable(),
  })
  .refine((s) => s.options.length === 0 || s.options.length === OPTION_COUNT, `Options are none or all ${OPTION_COUNT}`)
  .refine((s) => s.pick === null || s.options.some((f) => f.id === s.pick!.film.id), "The pick must be one of the options");

export type Puzzle = z.infer<typeof puzzleSchema>;
export type Solution = z.infer<typeof solutionSchema>;
export type Move = z.infer<typeof moveSchema>;
export type ResolvedMove = z.infer<typeof resolvedMoveSchema>;
export type Turn = z.infer<typeof turnSchema>;
export type GuessTurn = z.infer<typeof guessTurnSchema>;
export type State = z.infer<typeof stateSchema>;
export type Pick = z.infer<typeof pickSchema>;

export interface Reveal {
  film: FilmDetails;
  /** All ten levels, level 1 first. */
  levels: LevelRef[];
  credit: z.infer<typeof creditSchema> | null;
}

export {
  puzzleSchema as fadeToColorPuzzleSchema,
  solutionSchema as fadeToColorSolutionSchema,
  stateSchema as fadeToColorStateSchema,
};

export function isSkip(turn: Turn): turn is { skipped: true } {
  return "skipped" in turn;
}

export function isGuess(turn: Turn): turn is GuessTurn {
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

/** True while the player has the final pick in front of them. */
export function awaitingPick(state: State): boolean {
  return state.options.length > 0 && state.pick === null;
}

function outcomeOf(state: State) {
  if (state.pick) return state.pick.correct ? ("won" as const) : ("lost" as const);
  const last = state.turns.at(-1);
  if (last && isGuess(last) && last.correct) return "won" as const;
  if (state.turns.length < MAX_GUESSES) return "in_progress" as const;
  // Every reel used: a wrong last guess earned the final pick; giving up (a skip) ends the play.
  return awaitingPick(state) ? ("in_progress" as const) : ("lost" as const);
}

const SHARE = { solved: "🟩", missed: "🟥", skipped: "⬛", picked: "🟨" } as const;

export const fadeToColor = defineGame<Puzzle, Solution, State, Move, Reveal, ResolvedMove>({
  id: "fade-to-color",
  name: "Fade to Color",
  tagline: "Name the film from its whole run, start to finish",
  rules: [
    "A whole film, every frame pressed into one strip of color.",
    "Each miss or skip unreels more of the real picture.",
    `Name it in as few reels as you can. There are ${LEVEL_COUNT}.`,
  ],
  accent: "#8c8c8c",
  emoji: "📼",
  bucket: "movies",
  availability: "testing",

  puzzleSchema,
  solutionSchema,
  moveSchema,
  resolvedMoveSchema,

  initialState: () => ({ turns: [], unlocked: [], options: [], pick: null }),

  applyMove({ solution, state, move }) {
    if (outcomeOf(state) !== "in_progress") return { ok: false, error: "Today's film is already finished." };

    if (awaitingPick(state)) {
      if (move.type !== "pick") return { ok: false, error: `Every reel is used: pick one of the ${OPTION_COUNT} films.` };
      const film = state.options.find((f) => f.id === move.filmId);
      if (!film) return { ok: false, error: `Pick one of the ${OPTION_COUNT} films.` };
      return { ok: true, state: { ...state, pick: { film, correct: film.id === solution.answer.id } } };
    }
    if (move.type === "pick") return { ok: false, error: "There's nothing to pick yet." };

    let turn: Turn;
    if (move.type === "skip") {
      turn = { skipped: true };
    } else {
      const film: FilmRef = { id: move.film.id, title: move.film.title, year: move.film.year };
      if (guessedFilmIds(state).includes(film.id)) return { ok: false, error: `You already guessed ${film.title}.` };
      turn = { film, correct: film.id === solution.answer.id };
    }

    const turns = [...state.turns, turn];
    // A miss or skip on levels 1–9 earns the next level; a wrong guess on level 10 earns the pick.
    const earned = isGuess(turn) && turn.correct ? undefined : solution.levels[turns.length];
    const unlocked = earned ? [...state.unlocked, earned] : state.unlocked;
    const options = turns.length === MAX_GUESSES && isGuess(turn) && !turn.correct ? solution.options : state.options;
    return { ok: true, state: { ...state, turns, unlocked, options } };
  },

  outcome: ({ state }) => outcomeOf(state),

  score({ state, outcome }) {
    if (state.pick?.correct) return { score: PICK_SCORE, label: "Final pick" };
    const won = outcome === "won";
    const attempts = state.turns.length;
    return {
      score: attemptsScore(attempts, MAX_GUESSES, won, LAST_REEL_SCORE),
      label: `${won ? attempts : "X"}/${MAX_GUESSES}`,
    };
  },

  /** One mark per attempt (🟩 named it, 🟥 a wrong guess, ⬛ a skip), then the final pick's, if any: 🟨 right, 🟥 wrong. */
  shareGrid: ({ state }) =>
    [
      ...state.turns.map((t) => (isSkip(t) ? SHARE.skipped : t.correct ? SHARE.solved : SHARE.missed)),
      ...(state.pick ? [state.pick.correct ? SHARE.picked : SHARE.missed] : []),
    ].join(""),

  reveal: ({ solution }) => ({ film: solution.answer, levels: solution.levels, credit: solution.credit }),
});
