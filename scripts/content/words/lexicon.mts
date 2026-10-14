/**
 * Daily Lexicon puzzles.
 *
 *   npm run content:words:lexicon                          today (New York) + the next 30 days
 *   npm run content:words:lexicon -- --from 2026-11-01 --days 7
 *   npm run content:words:lexicon -- --dry-run             pick and print, write nothing
 *   npm run content:words:lexicon -- --renew-unplayed      remake stored days made the old way (below)
 *
 * For each date without a puzzle: nine letters from a seed, one common nine-letter word
 * (`data/lexicon-seeds.txt`) or two common words joined (`data/lexicon-seed-parts.txt`), whose
 * dictionary holds 60–120 words, and an answer nobody has had (from `data/lexicon-answers.tsv`)
 * among them (see `lib/lexicon-day.mts`). The same nine letters never come round within a year.
 * Seeded by PUZZLE_SEED_SECRET and the date. A stored day is never overwritten. The word data is
 * built by `lexicon-data.mts` and `lexicon-seed-data.mts`.
 *
 * `--renew-unplayed` (instead of generating new days): every stored day from --from (default
 * today) whose letters were drawn at random, before seeds, is made again from a seed. A played day
 * is never touched: the write goes through `replace_unplayed_puzzle`, which refuses a day with a
 * play and one rewritten meanwhile.
 *
 * A non-local database needs `--allow-remote` to write, or `--allow-remote-read` for a dry run.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { PuzzleDate } from "@/core/day";
import { createRng } from "@/core/random";
import { perfectGuesses } from "@/games/lexicon/letters";
import { lexicon } from "@/games/lexicon/logic";
import type { LexiconPuzzle, LexiconSolution } from "@/games/lexicon/schema";
import type { Json } from "@/server/database.types";
import {
  contentSeed,
  existingPuzzleDates,
  insertPuzzleIfAbsent,
  pipelineDb,
  positiveInt,
  puzzleDateRange,
  selectAllPages,
  type ContentDb,
} from "../movies/lib/pipeline.mjs";
import { parseAnswers, pickDay, restingSeeds, type AnswerEntry, type Day, type Seed, type SeedWords } from "./lib/lexicon-day.mjs";

const GAME_ID = lexicon.id;
const DATA = new URL("./data/", import.meta.url);

const { values: args } = parseArgs({
  options: {
    from: { type: "string" },
    days: { type: "string", default: "31" },
    "renew-unplayed": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
    "allow-remote-read": { type: "boolean", default: false },
  },
});

/** Everything a day is picked from, and what the stored days have used. */
interface Generator {
  words: string[];
  answers: AnswerEntry[];
  seeds: SeedWords;
  /** Every answer ever stored, so none comes round again. */
  used: Set<string>;
  /** Each stored day's seed, so the same letters rest a year either side. */
  seedsByDate: Map<PuzzleDate, Seed>;
}

const list = (name: string) => readFileSync(new URL(name, DATA), "utf8").split("\n").filter(Boolean);

async function loadGenerator(db: ContentDb): Promise<Generator> {
  const words = list("lexicon-words.txt");
  const answers = parseAnswers(readFileSync(new URL("lexicon-answers.tsv", DATA), "utf8"));
  const seeds = { wholes: list("lexicon-seeds.txt"), parts: list("lexicon-seed-parts.txt") };
  const stored = await selectAllPages<{ puzzle_date: string; solution: Json }>((from, to) =>
    db.from("puzzles").select("puzzle_date, solution").eq("game_id", GAME_ID).order("puzzle_date").range(from, to),
  );
  const used = new Set<string>();
  const seedsByDate = new Map<PuzzleDate, Seed>();
  for (const row of stored) {
    const solution = lexicon.solutionSchema.safeParse(row.solution);
    if (!solution.success) continue;
    used.add(solution.data.answer);
    if (solution.data.seed) seedsByDate.set(row.puzzle_date as PuzzleDate, solution.data.seed);
  }
  console.log(
    `${words.length} words, ${answers.length} answers (${used.size} used), ${seeds.wholes.length} nine-letter seeds and ${seeds.parts.length} seed parts.`,
  );
  return { words, answers, seeds, used, seedsByDate };
}

/** A checked day for `date`; the generator learns its answer and seed. */
function makeDay(gen: Generator, date: PuzzleDate): Day {
  const day = pickDay(gen.seeds, gen.answers, gen.used, restingSeeds(gen.seedsByDate, date), gen.words, createRng(contentSeed(GAME_ID, date)));
  if (!day) throw new Error("no seed makes a day of the right size with an unused answer");
  return { puzzle: lexicon.puzzleSchema.parse(day.puzzle), solution: lexicon.solutionSchema.parse(day.solution) };
}

function remember(gen: Generator, date: PuzzleDate, solution: LexiconSolution) {
  gen.used.add(solution.answer);
  if (solution.seed) gen.seedsByDate.set(date, solution.seed);
}

const describe = (puzzle: LexiconPuzzle, solution: LexiconSolution) =>
  `${solution.answer.toUpperCase()} · ${(solution.seed ?? []).join(" + ").toUpperCase()} → ${puzzle.letters.toUpperCase()} · ${puzzle.total} words (perfect play ${perfectGuesses(puzzle.total)})`;

async function generateRange(db: ContentDb, gen: Generator, dates: PuzzleDate[], dryRun: boolean): Promise<{ written: number; failures: number }> {
  const existing = await existingPuzzleDates(db, GAME_ID, dates);
  let written = 0;
  let failures = 0;
  for (const date of dates) {
    if (existing.has(date)) {
      console.log(`· ${date} exists (never overwritten)`);
      continue;
    }
    try {
      const { puzzle, solution } = makeDay(gen, date);
      if (dryRun) {
        console.log(`✓ ${date} ${describe(puzzle, solution)} (dry run)`);
      } else {
        const outcome = await insertPuzzleIfAbsent(db, { gameId: GAME_ID, date, puzzle, solution });
        if (outcome === "exists") {
          console.log(`· ${date} exists (written concurrently; kept)`);
          continue;
        }
        written++;
        console.log(`✓ ${date} ${describe(puzzle, solution)}`);
      }
      remember(gen, date, solution);
    } catch (error) {
      failures++;
      console.error(`✗ ${date} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { written, failures };
}

/** `--renew-unplayed`: every stored day from `from` on made before seeds, made again (see the header). */
async function renewUnplayed(db: ContentDb, gen: Generator, from: PuzzleDate, dryRun: boolean): Promise<{ written: number; failures: number }> {
  const rows = await selectAllPages<{ puzzle_date: string; payload: Json; solution: Json }>((first, last) =>
    db.from("puzzles").select("puzzle_date, payload, solution").eq("game_id", GAME_ID).gte("puzzle_date", from).order("puzzle_date").range(first, last),
  );
  const plays = await selectAllPages<{ puzzle_date: string; user_id: string }>((first, last) =>
    db.from("plays").select("puzzle_date, user_id").eq("game_id", GAME_ID).gte("puzzle_date", from).order("puzzle_date").order("user_id").range(first, last),
  );
  const played = new Set(plays.map((row) => row.puzzle_date));
  console.log(`${rows.length} stored Lexicon days from ${from} on; ${played.size} of them played.`);
  let written = 0;
  let failures = 0;
  for (const row of rows) {
    const date = row.puzzle_date as PuzzleDate;
    const stored = lexicon.solutionSchema.safeParse(row.solution);
    if (!stored.success || !lexicon.puzzleSchema.safeParse(row.payload).success) {
      failures++;
      console.error(`✗ ${date} the stored day isn't a Lexicon day; left alone`);
      continue;
    }
    if (stored.data.seed) {
      console.log(`· ${date} made from a seed already`);
      continue;
    }
    if (played.has(date)) {
      console.log(`· ${date} played, never touched`);
      continue;
    }
    try {
      const { puzzle, solution } = makeDay(gen, date);
      if (dryRun) {
        console.log(`✓ ${date} ${describe(puzzle, solution)} (dry run)`);
      } else {
        const { data: outcome, error } = await db.rpc("replace_unplayed_puzzle", {
          p_game_id: GAME_ID,
          p_date: date,
          p_expected_payload: row.payload,
          p_payload: puzzle as unknown as Json,
          p_solution: solution as unknown as Json,
        });
        if (error) throw new Error(`Couldn't rewrite the puzzle: ${error.message}`);
        if (outcome !== "replaced") {
          const why = { played: "someone started it meanwhile", changed: "it was rewritten meanwhile", missing: "it was deleted meanwhile" }[outcome ?? "missing"];
          console.log(`· ${date} left alone: ${why}`);
          continue;
        }
        written++;
        console.log(`✓ ${date} ${describe(puzzle, solution)}`);
      }
      remember(gen, date, solution);
    } catch (error) {
      failures++;
      console.error(`✗ ${date} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { written, failures };
}

async function main() {
  const dryRun = args["dry-run"];
  const renew = args["renew-unplayed"];
  if (args["allow-remote-read"] && !args["allow-remote"] && !dryRun) {
    throw new Error("--allow-remote-read is for a --dry-run; writing to a non-local database needs --allow-remote (owner only)");
  }
  const db = pipelineDb({ allowRemote: args["allow-remote"], allowRemoteRead: args["allow-remote-read"] });
  const gen = await loadGenerator(db);
  const dates = puzzleDateRange(renew ? 1 : positiveInt(args.days, "days", { max: 366 }), args.from);
  const { written, failures } = renew ? await renewUnplayed(db, gen, dates[0]!, dryRun) : await generateRange(db, gen, dates, dryRun);
  console.log(`\n${dryRun ? "Dry run: nothing written." : `${written} puzzle(s) ${renew ? "remade" : "created"}.`}${failures ? ` ${failures} day(s) failed.` : ""}`);
  if (failures) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
