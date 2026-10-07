/**
 * Re-checks the four stored with each Fade to Color day from tomorrow on against today's rules and
 * catalog, and re-picks only the ones that break them: a look-alike of another kind (animated,
 * live-action/animated hybrid, live action, per Wikidata), two films of one series or by one
 * director (Wikidata's series too, since 2026-10-07), or a film now hidden as adult
 * (`fourProblems`). The four are visible from reel 1, so a mixed four would give the answer away.
 *
 *   npm run content:movies:recheck-fours -- [--dry-run] [--allow-remote-read | --allow-remote]
 *
 * A day someone has played is never touched. Today is left out, so no one can play a day while it
 * is being re-checked (everyone who stops on a day must see the same four): review today's by hand.
 * `--allow-remote-read` reads a non-local database for a dry run (its client refuses every write).
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { addDays, today, type PuzzleDate } from "@/core/day";
import { fadeToColor } from "@/games/fade-to-color/logic";
import { finalPickOptions, fourProblems, type FourFilm } from "./lib/decoys.mjs";
import { pipelineDb, selectAllPages } from "./lib/pipeline.mjs";
import { filmKinds } from "./lib/wikidata-kind.mjs";

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "allow-remote": { type: "boolean", default: false },
    "allow-remote-read": { type: "boolean", default: false },
  },
  strict: true,
});

const storedSchema = z.object({ answer: z.object({ id: z.number(), title: z.string() }), options: z.array(z.object({ id: z.number(), title: z.string(), year: z.number().nullable() })) });

async function main() {
  if (args["allow-remote-read"] && !args["dry-run"]) throw new Error("--allow-remote-read only reads: use it with --dry-run");
  const db = pipelineDb({ allowRemote: args["allow-remote"], allowRemoteRead: args["allow-remote-read"] });
  const from = addDays(today(), 1);
  const rows = await selectAllPages((a, b) => db.from("puzzles").select("puzzle_date, solution").eq("game_id", fadeToColor.id).gte("puzzle_date", from).order("puzzle_date").range(a, b));
  for (const row of rows) {
    const date = row.puzzle_date as PuzzleDate;
    const { count, error: countError } = await db.from("plays").select("user_id", { count: "exact", head: true }).eq("game_id", fadeToColor.id).eq("puzzle_date", date);
    if (countError) throw new Error(`Couldn't count plays for ${date}: ${countError.message}`);
    const solution = storedSchema.safeParse(row.solution).data;
    if (!solution) {
      console.log(`${date}  skipped: no four stored`);
      continue;
    }
    if ((count ?? 0) > 0) {
      console.log(`${date}  ${solution.answer.title}: played, left alone`);
      continue;
    }
    const ids = solution.options.map((o) => o.id);
    const { data, error } = await db.from("movie_films").select("id, title, year, genres, directors, popularity, series_qids, wikidata_id, is_adult").in("id", ids);
    if (error) throw new Error(`Couldn't read the four of ${date}: ${error.message}`);
    const films: FourFilm[] = data.map((f) => ({ ...f, series: f.series_qids, isAdult: f.is_adult }));
    const qidOf = new Map(data.map((f) => [f.id, f.wikidata_id]));
    const kinds = await filmKinds(data.flatMap((f) => (f.wikidata_id ? [f.wikidata_id] : [])));
    const problems = fourProblems(films, solution.answer.id, (f) => kinds.get(qidOf.get(f.id) ?? "") ?? "live");
    if (problems.length === 0) {
      console.log(`${date}  ${solution.answer.title}: the four follow today's rules, kept`);
      continue;
    }
    const options = await finalPickOptions(db, solution.answer.id, date);
    console.log(`${date}  ${solution.answer.title}: ${problems.join("; ")} → ${options.map((o) => o.title).join(" · ")}`);
    if (args["dry-run"]) continue;
    const { error: updateError } = await db.from("puzzles").update({ solution: { ...(row.solution as object), options } }).eq("game_id", fadeToColor.id).eq("puzzle_date", date);
    if (updateError) throw new Error(`Couldn't update ${date}: ${updateError.message}`);
  }
  console.log(args["dry-run"] ? "✓ dry run: nothing written" : "✓ done");
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
