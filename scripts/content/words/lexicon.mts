/**
 * Daily Lexicon puzzles.
 *
 *   npm run content:words:lexicon                          today (New York) + the next 30 days
 *   npm run content:words:lexicon -- --from 2026-11-01 --days 7
 *   npm run content:words:lexicon -- --dry-run             pick and print, write nothing
 *
 * For each date without a puzzle: an answer nobody has had (from `data/lexicon-answers.tsv`), its
 * letters plus a few more to make nine, chosen so the day's dictionary holds 60–120 words (see
 * `lib/lexicon-day.mts`). Seeded by PUZZLE_SEED_SECRET and the date. A stored day is never
 * overwritten. The word data is built by `lexicon-data.mts`.
 *
 * A non-local database needs `--allow-remote` to write, or `--allow-remote-read` for a dry run.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createRng } from "@/core/random";
import { perfectGuesses } from "@/games/lexicon/letters";
import { lexicon } from "@/games/lexicon/logic";
import type { Json } from "@/server/database.types";
import { contentSeed, existingPuzzleDates, insertPuzzleIfAbsent, pipelineDb, positiveInt, puzzleDateRange, selectAllPages } from "../movies/lib/pipeline.mjs";
import { parseAnswers, pickDay } from "./lib/lexicon-day.mjs";

const GAME_ID = lexicon.id;
const DATA = new URL("./data/", import.meta.url);

const { values: args } = parseArgs({
  options: {
    from: { type: "string" },
    days: { type: "string", default: "31" },
    "dry-run": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
    "allow-remote-read": { type: "boolean", default: false },
  },
});

async function main() {
  const dryRun = args["dry-run"];
  if (args["allow-remote-read"] && !args["allow-remote"] && !dryRun) {
    throw new Error("--allow-remote-read is for a --dry-run; writing to a non-local database needs --allow-remote (owner only)");
  }
  const dates = puzzleDateRange(positiveInt(args.days, "days", { max: 366 }), args.from);
  const db = pipelineDb({ allowRemote: args["allow-remote"], allowRemoteRead: args["allow-remote-read"] });

  const words = readFileSync(new URL("lexicon-words.txt", DATA), "utf8").split("\n").filter(Boolean);
  const answers = parseAnswers(readFileSync(new URL("lexicon-answers.tsv", DATA), "utf8"));
  const stored = await selectAllPages<{ solution: Json }>((from, to) => db.from("puzzles").select("solution").eq("game_id", GAME_ID).order("puzzle_date").range(from, to));
  // Every answer ever stored, so none comes round again.
  const used = new Set(stored.map(({ solution }) => (solution && typeof solution === "object" && !Array.isArray(solution) ? solution.answer : null)).filter((a): a is string => typeof a === "string"));
  console.log(`${words.length} words, ${answers.length} answers, ${used.size} used.`);

  const existing = await existingPuzzleDates(db, GAME_ID, dates);
  let written = 0;
  let failures = 0;
  for (const date of dates) {
    if (existing.has(date)) {
      console.log(`· ${date} exists (never overwritten)`);
      continue;
    }
    try {
      const day = pickDay(answers, used, words, createRng(contentSeed(GAME_ID, date)));
      if (!day) throw new Error("no unused answer makes a day of the right size");
      const puzzle = lexicon.puzzleSchema.parse(day.puzzle);
      const solution = lexicon.solutionSchema.parse(day.solution);
      const line = `${date} ${solution.answer.toUpperCase()} · ${puzzle.letters.toUpperCase()} · ${puzzle.total} words (perfect play ${perfectGuesses(puzzle.total)})`;
      if (dryRun) {
        console.log(`✓ ${line} (dry run)`);
      } else {
        const outcome = await insertPuzzleIfAbsent(db, { gameId: GAME_ID, date, puzzle, solution });
        if (outcome === "exists") {
          console.log(`· ${date} exists (written concurrently; kept)`);
          continue;
        }
        written++;
        console.log(`✓ ${line}`);
      }
      used.add(solution.answer);
    } catch (error) {
      failures++;
      console.error(`✗ ${date} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`\n${dryRun ? "Dry run: nothing written." : `${written} puzzle(s) created.`}${failures ? ` ${failures} day(s) failed.` : ""}`);
  if (failures) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
