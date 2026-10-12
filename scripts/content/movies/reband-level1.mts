/**
 * Re-bands level 1 of the Fade to Color days already stored, so they match the renderer's broader
 * bands (`LEVEL1_BANDS`, 2026-10) without fetching a frame: each column of a stored level 1 is one
 * sampled frame, so averaging runs of its columns gives the bands the renderer now draws from the
 * frames themselves (`rebandLevel1` in lib/barcode-levels.mts).
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/content/movies/reband-level1.mts [options]
 *     [--bands <n>]           bands across level 1 (default 480, what the renderer draws)
 *     [--from <YYYY-MM-DD>]   first day (default tomorrow in New York; today and earlier are refused)
 *     [--days <n>]            only the days in [--from, --from + n) (default: every stored day from --from)
 *     [--dry-run]             report what would change; write nothing
 *     [--preview <dir>]       with --dry-run: level 1 before and after, as PNGs, for each day it would change
 *     [--allow-remote-read]   read a non-local database for a dry run (its client refuses every write)
 *     [--allow-remote]        write to a non-local database (owner only)
 *
 * What a day's level 1 is, and what comes from it: the image (a `puzzle_assets` row, kind
 * `barcode-level-1`, WebP) and its `{ id, width, height, average, dominant }`, stored twice: as the
 * public payload's `first` and as the solution's `levels[0]`. The film's `look` comes from the
 * thumbnails, not from level 1, and is kept. The theater's lit bands and accent (`palette.ts`) are
 * worked out in the browser from the image itself, so they follow it with nothing stored.
 *
 * Days left alone, each with its reason: today and earlier (someone may be playing; only days from
 * tomorrow on are touched), a day someone has played (never touched), a DEV FIXTURE (its generator
 * draws bands itself), a stored payload that no longer parses, and a level 1 that is banded already
 * (`detectBands`: re-banding bands only blurs them; re-render such a day from its frames instead).
 *
 * How a day is rewritten: asset ids are immutable (the sealed copy of an id is cached for a year), so
 * the re-banded level is stored as a new asset; then `replace_unplayed_puzzle` points the payload
 * and solution at it in one statement, refusing if anyone has started the day or the payload
 * changed since it was read; only then is the old asset deleted, and only if it belongs to that day
 * and no other puzzle names it. If the replace is refused, the new asset is deleted again.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { referencedAssetIds } from "@/core/assets";
import { addDays, parsePuzzleDate, today, type PuzzleDate } from "@/core/day";
import type { Json } from "@/server/database.types";
import { fadeToColor, type LevelRef, type Puzzle, type Solution } from "@/games/fade-to-color/logic";
import { toBytea } from "../lib/db.mjs";
import { encodeLevel, GAME_ID } from "./lib/barcode-day.mjs";
import { averageColor, detectBands, dominantColor, LEVEL1_BANDS, rebandLevel1, type RgbImage } from "./lib/barcode-levels.mjs";
import { newAsset, pipelineDb, positiveInt, selectAllPages, type ContentDb } from "./lib/pipeline.mjs";

const { values: args } = parseArgs({
  options: {
    bands: { type: "string", default: String(LEVEL1_BANDS) },
    from: { type: "string" },
    days: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    preview: { type: "string" },
    "allow-remote": { type: "boolean", default: false },
    "allow-remote-read": { type: "boolean", default: false },
  },
  strict: true,
});

const LEVEL_KIND = "barcode-level-1";

/** PostgREST returns bytea as "\x…" hex text. */
function fromBytea(value: string): Buffer {
  if (!/^\\x(?:[0-9a-f]{2})*$/i.test(value)) throw new Error("Unexpected bytea encoding");
  return Buffer.from(value.slice(2), "hex");
}

async function decode(bytes: Buffer): Promise<RgbImage> {
  const { data, info } = await sharp(bytes, { failOn: "error" }).removeAlpha().toColorspace("srgb").raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

const png = (image: RgbImage) => sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

interface StoredDay {
  date: PuzzleDate;
  payload: Json;
  solution: Json;
}

async function playCount(db: ContentDb, date: PuzzleDate): Promise<number> {
  const { count, error } = await db.from("plays").select("user_id", { count: "exact", head: true }).eq("game_id", GAME_ID).eq("puzzle_date", date);
  if (error) throw new Error(`Couldn't count plays for ${date}: ${error.message}`);
  return count ?? 0;
}

/** The new level 1 is in place: deletes the old asset if it is this day's and no other puzzle names it. */
async function dropOldAsset(db: ContentDb, date: PuzzleDate, oldId: string, others: readonly StoredDay[]): Promise<string> {
  const named = others.some((day) => referencedAssetIds(day.payload).has(oldId) || referencedAssetIds(day.solution).has(oldId));
  if (named) return "old asset kept (another puzzle names it)";
  const { data, error } = await db.from("puzzle_assets").delete().eq("id", oldId).eq("game_id", GAME_ID).eq("puzzle_date", date).select("id");
  if (error) return `old asset kept (couldn't delete it: ${error.message})`;
  return data.length === 1 ? "old asset deleted" : "old asset kept (it belongs to another day)";
}

async function main() {
  const dryRun = args["dry-run"];
  if (args["allow-remote-read"] && !dryRun) throw new Error("--allow-remote-read only reads: use it with --dry-run");
  if (args.preview && !dryRun) throw new Error("--preview is for --dry-run reviews");
  const bands = positiveInt(args.bands, "bands", { min: 50, max: 6000 });
  const tomorrow = addDays(today(), 1);
  const from = args.from ? parsePuzzleDate(args.from) : tomorrow;
  if (from < tomorrow) throw new Error(`--from must be tomorrow (${tomorrow}) or later: today's puzzle may be in play`);
  const until = args.days ? addDays(from, positiveInt(args.days, "days", { min: 1, max: 366 }) - 1) : null;
  const previewDir = args.preview ? path.resolve(args.preview) : null;
  if (previewDir) mkdirSync(previewDir, { recursive: true });

  const db = pipelineDb({ allowRemote: args["allow-remote"], allowRemoteRead: args["allow-remote-read"] });
  // Every stored day (past ones too): an old asset is deleted only if no other puzzle names it.
  const all: StoredDay[] = (
    await selectAllPages((a, b) => db.from("puzzles").select("puzzle_date, payload, solution").eq("game_id", GAME_ID).order("puzzle_date").range(a, b))
  ).map((row) => ({ date: row.puzzle_date as PuzzleDate, payload: row.payload, solution: row.solution }));
  const days = all.filter((day) => day.date >= from && (until === null || day.date <= until));
  const played = new Set(
    (
      await selectAllPages((a, b) =>
        db.from("plays").select("puzzle_date, user_id").eq("game_id", GAME_ID).gte("puzzle_date", from).order("puzzle_date").order("user_id").range(a, b),
      )
    ).map((row) => row.puzzle_date),
  );

  console.log(`Fade to Color level 1 → ${bands} bands: days from ${from}${until ? ` to ${until}` : " on"} (${days.length} stored)${dryRun ? ", dry run" : ""}`);
  const outcome = { changed: 0, skipped: 0 };
  for (const day of days) {
    const { date } = day;
    const skip = (why: string) => {
      outcome.skipped++;
      console.log(`${date}  ${why}, left alone`);
    };
    const puzzle = fadeToColor.puzzleSchema.safeParse(day.payload).data;
    const solution = fadeToColor.solutionSchema.safeParse(day.solution).data;
    if (!puzzle || !solution) {
      skip("stored payload or solution doesn't parse");
      continue;
    }
    const title = solution.answer.title;
    if (played.has(date)) {
      skip(`${title}: played`);
      continue;
    }
    if (puzzle.fixture) {
      skip(`${title}: DEV FIXTURE`);
      continue;
    }
    const old = puzzle.first;
    if (solution.levels[0]!.id !== old.id) {
      skip(`${title}: level 1 differs between payload and solution`);
      continue;
    }
    const { data: asset, error } = await db.from("puzzle_assets").select("id, game_id, puzzle_date, kind, mime, bytes").eq("id", old.id).maybeSingle();
    if (error) throw new Error(`Couldn't read ${date}'s level 1: ${error.message}`);
    if (!asset) {
      skip(`${title}: level 1 asset ${old.id} is missing`);
      continue;
    }
    const oldBytes = fromBytea(asset.bytes);
    const before = await decode(oldBytes);
    if (before.width !== old.width || before.height !== old.height) {
      skip(`${title}: level 1 is ${before.width}×${before.height}, the puzzle says ${old.width}×${old.height}`);
      continue;
    }
    const found = detectBands(before);
    if (found.banded) {
      skip(`${title}: level 1 is banded already (about ${found.bands} bands; inside/edge change ${found.ratio.toFixed(2)})`);
      continue;
    }

    const after = rebandLevel1(before, bands);
    const encoded = await encodeLevel(after);
    const fresh = newAsset(LEVEL_KIND, encoded);
    const ref: LevelRef = { id: fresh.id, width: fresh.width, height: fresh.height, average: averageColor(after), dominant: dominantColor(after) };
    const nextPuzzle: Puzzle = fadeToColor.puzzleSchema.parse({ ...puzzle, first: ref });
    const nextSolution: Solution = fadeToColor.solutionSchema.parse({ ...solution, levels: [ref, ...solution.levels.slice(1)] });
    console.log(
      `${date}  ${title}: ${before.width}×${before.height}, one frame per column (inside/edge change ${found.ratio.toFixed(2)}) → ${Math.min(bands, before.width)} bands; ` +
        `average ${old.average} → ${ref.average}, dominant ${old.dominant} → ${ref.dominant}; ${kb(oldBytes.length)} → ${kb(encoded.bytes.length)}`,
    );
    if (dryRun) {
      if (previewDir) {
        writeFileSync(path.join(previewDir, `${date}-level1-before.png`), await png(before));
        writeFileSync(path.join(previewDir, `${date}-level1-after.png`), await png(await decode(encoded.bytes)));
      }
      outcome.changed++;
      continue;
    }

    // Re-checked right before writing: the run may have crossed midnight, or the day been started.
    if (date <= today() || (await playCount(db, date)) > 0) {
      skip(`${title}: became today or was played during the run`);
      continue;
    }
    const { error: insertError } = await db.from("puzzle_assets").insert({
      id: fresh.id,
      game_id: GAME_ID,
      puzzle_date: date,
      kind: LEVEL_KIND,
      mime: fresh.mime,
      width: fresh.width,
      height: fresh.height,
      bytes: toBytea(fresh.bytes),
    });
    if (insertError) throw new Error(`Couldn't store ${date}'s re-banded level 1: ${insertError.message}`);
    const { data: replaced, error: replaceError } = await db.rpc("replace_unplayed_puzzle", {
      p_game_id: GAME_ID,
      p_date: date,
      p_expected_payload: day.payload,
      p_payload: nextPuzzle as unknown as Json,
      p_solution: nextSolution as unknown as Json,
    });
    if (replaceError || replaced !== "replaced") {
      // Nothing names the new asset: take it back out.
      await db.from("puzzle_assets").delete().eq("id", fresh.id).eq("game_id", GAME_ID).eq("puzzle_date", date);
      if (replaceError) throw new Error(`Couldn't rewrite ${date}: ${replaceError.message}`);
      skip(`${title}: not rewritten (${replaced})`);
      continue;
    }
    const others = all.filter((other) => other.date !== date);
    console.log(`  ✓ stored as ${fresh.id}; ${await dropOldAsset(db, date, old.id, others)}`);
    outcome.changed++;
  }
  console.log(
    `${dryRun ? "✓ dry run: nothing written; would re-band" : "✓ re-banded"} ${outcome.changed} day${outcome.changed === 1 ? "" : "s"}, left ${outcome.skipped} alone` +
      (previewDir ? `; previews in ${previewDir}` : ""),
  );
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
